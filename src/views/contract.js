import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import { esc, relativeTime } from '../util.js';

const empty = document.getElementById('detail-empty');
const content = document.getElementById('detail-content');

export async function show(id) {
  empty.hidden = true;
  content.hidden = false;
  content.innerHTML = '<div class="detail-loading">Loading…</div>';
  try {
    const c = await api.getContract(id);
    render(c);
  } catch (e) {
    content.innerHTML = `<div class="detail-error">
      <div class="detail-error-status">HTTP ${esc(String(e.status || '?'))}</div>
      <div class="detail-error-detail">${esc(e.detail || e.message)}</div>
    </div>`;
  }
}

function render(c) {
  const stamp = extractStamp(c.markdown);
  content.innerHTML = `
    <div class="detail-topbar">
      <div class="topbar-row">
        <span class="type-badge type-contract">contract</span>
        <span class="topbar-name">${esc(c.owner)} → ${esc(c.counterparty)}</span>
      </div>
      <div class="topbar-row chips">
        <span class="version-chip">v${esc(c.version)}</span>
        ${stamp.version ? `<span class="template-chip" title="Template version">tpl ${esc(stamp.kind)}@${esc(stamp.version)}</span>` : ''}
        <span class="updated-chip" title="${esc(c.updated_at)}">${esc(relativeTime(c.updated_at))}</span>
      </div>
      <div class="topbar-row links">
        <a href="#/software/${encodeURIComponent(c.owner)}" class="link-pill">owner: ${esc(c.owner)}</a>
        <a href="#/software/${encodeURIComponent(c.counterparty)}" class="link-pill">counterparty: ${esc(c.counterparty)}</a>
      </div>
    </div>
    <div class="detail-body markdown-body">${renderMarkdown(stamp.body)}</div>
  `;
}
