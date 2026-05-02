import { marked } from 'marked';
import DOMPurify from 'dompurify';

const STAMP_RE = /^<!--\s*template:\s*([a-z]+)@(\d+\.\d+\.\d+(?:-rc\d+)?)\s*-->\s*\n?/;

export function extractStamp(md) {
  const m = (md || '').match(STAMP_RE);
  if (!m) return { kind: null, version: null, body: md || '' };
  return { kind: m[1], version: m[2], body: md.slice(m[0].length) };
}

marked.setOptions({ gfm: true, breaks: false });

// markdown bodies are user-controllable (anyone who can register software
// can put arbitrary markdown in their record), so sanitize the rendered
// HTML before handing it to v-html.
export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md));
}
