import { ref, watch } from 'vue';
import { PROJECT_NONE } from './api.js';

export const search = ref('');
export const health = ref({ status: 'unknown', version: '', db: '' });
export const fatal = ref(null);
export const retryNonce = ref(0);

export function retry() {
  fatal.value = null;
  retryNonce.value++;
}

// Project filter (provider v0.18.0+, mimiron 0.18.x). Three states:
//   null              → All projects (no filter — matches pre-2.5.0 behavior)
//   PROJECT_NONE      → Unprojected only (rows with NULL project_id)
//   '<slug>'          → A specific project's rows
//
// Persistence is via the URL query string (`?project=<slug|__none__>`) rather
// than localStorage so the filter is shareable, survives reloads, and stays
// in sync if the user opens multiple tabs. Hash-mode router puts query
// params after the hash (`#/parts/foo?project=bar`) so we look there first.
function readFromUrl() {
  // Try the hash query first (router operates in hash mode), then fall back
  // to the document query for direct deep-link cases.
  const sources = [];
  const hash = window.location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex >= 0) sources.push(new URLSearchParams(hash.slice(qIndex + 1)));
  if (window.location.search) sources.push(new URLSearchParams(window.location.search));
  for (const s of sources) {
    const v = s.get('project');
    if (v) return v;
  }
  return null;
}

export const project = ref(readFromUrl());

// Mirror project state into the URL query so reloads + share-links keep the
// filter. Hash-mode means we rewrite the hash itself; we replace history
// (not push) to avoid filling the back-stack on every change.
watch(project, (v) => {
  const hash = window.location.hash || '#/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  if (v) params.set('project', v);
  else params.delete('project');
  const qs = params.toString();
  const next = qs ? `${path}?${qs}` : path;
  if (next !== hash) {
    history.replaceState(null, '', next);
  }
});

// Re-read on hash navigation so back/forward through the route stack also
// updates the picker. The hashchange event is the lowest-common-denominator
// signal for hash-mode routing; vue-router fires before this so by the time
// we read, the URL is settled.
window.addEventListener('hashchange', () => {
  const v = readFromUrl();
  if (v !== project.value) project.value = v;
});

export { PROJECT_NONE };
