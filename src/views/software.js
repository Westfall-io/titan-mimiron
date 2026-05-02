import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import { esc, relativeTime, repoLink, trackerLink } from '../util.js';

const empty = document.getElementById('detail-empty');
const content = document.getElementById('detail-content');

export async function show(name) {
  empty.hidden = true;
  content.hidden = false;
  content.innerHTML = '<div class="detail-loading">Loading…</div>';
  try {
    const [sw, contracts] = await Promise.all([
      api.getSoftware(name),
      api.listSoftwareContracts(name)
    ]);
    render(sw, contracts);
  } catch (e) {
    content.innerHTML = `<div class="detail-error">
      <div class="detail-error-status">HTTP ${esc(String(e.status || '?'))}</div>
      <div class="detail-error-detail">${esc(e.detail || e.message)}</div>
    </div>`;
  }
}

function render(sw, contracts) {
  const stamp = extractStamp(sw.markdown);
  content.innerHTML = `
    <div class="detail-topbar">
      <div class="topbar-row">
        <span class="type-badge type-software">software</span>
        <span class="topbar-name">${esc(sw.name)}</span>
      </div>
      <div class="topbar-row chips">
        <span class="version-chip">v${esc(sw.version)}</span>
        ${stamp.version ? `<span class="template-chip" title="Template version">tpl ${esc(stamp.kind)}@${esc(stamp.version)}</span>` : ''}
        <span class="updated-chip" title="${esc(sw.updated_at)}">${esc(relativeTime(sw.updated_at))}</span>
      </div>
      <div class="topbar-row links">
        <a href="${esc(repoLink(sw.repo_uri))}" target="_blank" rel="noopener" class="link-pill">repo</a>
        <a href="${esc(trackerLink(sw))}" target="_blank" rel="noopener" class="link-pill">issues</a>
        ${sw.aliases.length ? `<span class="alias-group">aliases: ${sw.aliases.map(a => `<span class="alias-chip">${esc(a)}</span>`).join('')}</span>` : ''}
      </div>
    </div>
    <div class="detail-body markdown-body">${renderMarkdown(stamp.body)}</div>
    <div class="detail-section">
      <h2 class="section-title">Contracts <span class="section-count">${contracts.results.length}</span></h2>
      <div class="contracts-list">${
        contracts.results.length
          ? contracts.results.map(c => contractRow(c, sw.name)).join('')
          : '<div class="detail-empty-inline">no contracts</div>'
      }</div>
    </div>
  `;
}

function contractRow(c, currentName) {
  const direction = c.owner === currentName ? 'out' : 'in';
  const other = c.owner === currentName ? c.counterparty : c.owner;
  return `<a class="contract-row" href="#/contracts/${encodeURIComponent(c.contract_id)}">
    <span class="direction-chip dir-${direction}" title="${direction === 'out' ? 'this software owns the contract' : 'this software is the counterparty'}">${direction}</span>
    <span class="contract-other">${esc(other)}</span>
    <span class="contract-meta">v${esc(c.version)} · ${esc(relativeTime(c.updated_at))}</span>
  </a>`;
}
