import * as api from '../api.js';
import { esc } from '../util.js';

const listEl = document.getElementById('catalog-list');
const moreBtn = document.getElementById('load-more');

let state = { results: [], next: null, query: '', loading: false, error: null };

moreBtn.addEventListener('click', loadMore);

export async function load(query = '') {
  state = { results: [], next: null, query, loading: true, error: null };
  render();
  try {
    const data = await api.listSoftware({ match: query || null });
    state.results = data.results;
    state.next = data.next;
  } catch (e) {
    state.error = e;
  } finally {
    state.loading = false;
    render();
  }
}

async function loadMore() {
  if (!state.next || state.loading) return;
  state.loading = true;
  render();
  try {
    const data = await api.listSoftware({ match: state.query || null, after: state.next });
    state.results = [...state.results, ...data.results];
    state.next = data.next;
  } catch (e) {
    state.error = e;
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  listEl.innerHTML = '';

  if (state.error) {
    const err = document.createElement('div');
    err.className = 'catalog-error';
    err.textContent = state.error.detail || state.error.message;
    listEl.appendChild(err);
  } else if (state.results.length === 0 && !state.loading) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.textContent = state.query ? 'no matches' : 'no software registered';
    listEl.appendChild(empty);
  } else {
    for (const sw of state.results) listEl.appendChild(renderRow(sw));
  }

  moreBtn.hidden = !state.next;
  moreBtn.textContent = state.loading && state.results.length > 0 ? 'Loading…' : 'Load more';
  moreBtn.disabled = state.loading;
  highlightActive();
}

function renderRow(sw) {
  const row = document.createElement('a');
  row.className = 'catalog-row';
  row.href = `#/software/${encodeURIComponent(sw.name)}`;
  row.dataset.name = sw.name;
  row.innerHTML = `
    <div class="row-name">${esc(sw.name)}</div>
    <div class="row-meta">
      <span class="version-chip">v${esc(sw.version)}</span>
      ${sw.aliases.map(a => `<span class="alias-chip">${esc(a)}</span>`).join('')}
    </div>
  `;
  return row;
}

export function highlightActive() {
  const m = location.hash.match(/^#\/software\/([^/]+)$/);
  const active = m ? decodeURIComponent(m[1]) : null;
  for (const row of listEl.querySelectorAll('.catalog-row')) {
    row.classList.toggle('active', row.dataset.name === active);
  }
}
