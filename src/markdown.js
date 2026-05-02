import { marked } from 'marked';
import DOMPurify from 'dompurify';

const STAMP_RE = /^<!--\s*template:\s*([a-z]+)@(\d+\.\d+\.\d+(?:-rc\d+)?)\s*-->\s*\n?/;

export function extractStamp(md) {
  const m = (md || '').match(STAMP_RE);
  if (!m) return { kind: null, version: null, body: md || '' };
  return { kind: m[1], version: m[2], body: md.slice(m[0].length) };
}

// In-app link interception. Contract/software markdown bodies cross-reference
// other catalog entries — by software name (slug) or contract id (UUID). We
// rewrite these hrefs at parse time to hash routes (#/software/:name,
// #/contracts/:id), so vue-router picks them up via hashchange and navigates
// inside the app rather than the browser following the link out.
//
// Heuristics (checked in order):
//   #...                     → passthrough (in-page anchor or pre-formed hash route)
//   scheme: or //host        → external link, open in new tab
//   UUID-shaped              → /contracts/:id
//   slug-shaped              → /software/:name (matches tyr's name regex)
//   anything else            → marked .md-link-broken; left as-is
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEME_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function classifyHref(href) {
  if (!href) return { href: '', kind: 'broken' };
  if (href.startsWith('#')) return { href, kind: 'passthrough' };
  if (SCHEME_RE.test(href)) return { href, kind: 'external' };
  if (UUID_RE.test(href)) return { href: `#/contracts/${href}`, kind: 'in-app' };
  if (SLUG_RE.test(href)) return { href: `#/software/${href}`, kind: 'in-app' };
  return { href, kind: 'broken' };
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

marked.setOptions({ gfm: true, breaks: false });

// marked v12 calls renderer.link(href, title, text) with `text` already
// rendered as HTML — not the v13 object form.
marked.use({
  renderer: {
    link(href, title, text) {
      const r = classifyHref(href);
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      const hrefAttr = ` href="${escapeAttr(r.href)}"`;
      if (r.kind === 'external') {
        return `<a${hrefAttr} target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      }
      if (r.kind === 'broken') {
        const t = titleAttr || ' title="broken in-app reference"';
        return `<a${hrefAttr} class="md-link-broken"${t}>${text}</a>`;
      }
      return `<a${hrefAttr}${titleAttr}>${text}</a>`;
    },
  },
});

// markdown bodies are user-controllable (anyone who can register software
// can put arbitrary markdown in their record), so sanitize the rendered
// HTML before handing it to v-html. ADD_ATTR keeps the target/rel we set
// on external links — DOMPurify's defaults strip them.
export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md), {
    ADD_ATTR: ['target', 'rel'],
  });
}
