import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12/lib/marked.esm.js';

const STAMP_RE = /^<!--\s*template:\s*([a-z]+)@(\d+\.\d+\.\d+(?:-rc\d+)?)\s*-->\s*\n?/;

export function extractStamp(md) {
  const m = (md || '').match(STAMP_RE);
  if (!m) return { kind: null, version: null, body: md || '' };
  return { kind: m[1], version: m[2], body: md.slice(m[0].length) };
}

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md) {
  return marked.parse(md);
}
