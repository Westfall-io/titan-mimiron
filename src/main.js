import * as api from './api.js';
import * as router from './router.js';
import * as catalog from './views/catalog.js';
import * as software from './views/software.js';
import * as contract from './views/contract.js';
import { esc } from './util.js';

const search = document.getElementById('search');
const errorBanner = document.getElementById('error-banner');
const healthDot = document.getElementById('health-dot');
const apiVersion = document.getElementById('api-version');
const empty = document.getElementById('detail-empty');
const content = document.getElementById('detail-content');

let searchTimer = null;

async function start() {
  try {
    await api.loadConfig();
  } catch (e) {
    showFatal(`Failed to load config.json: ${e.message}`);
    return;
  }

  router.route('/', () => {
    empty.hidden = false;
    content.hidden = true;
    catalog.highlightActive();
  });
  router.route('/software/:name', ({ name }) => {
    software.show(name);
    catalog.highlightActive();
  });
  router.route('/contracts/:id', ({ id }) => {
    contract.show(id);
    catalog.highlightActive();
  });
  router.startRouter();

  catalog.load();
  bindSearch();
  startHealthProbe();
}

function bindSearch() {
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => catalog.load(search.value.trim()), 300);
  });
}

async function probeHealth() {
  try {
    const h = await api.health();
    const ok = h.status === 'ok' && h.db === 'reachable';
    healthDot.className = `health-dot health-${ok ? 'ok' : 'degraded'}`;
    healthDot.title = `API ${h.version} · status ${h.status} · db ${h.db}`;
    apiVersion.textContent = `tyr ${h.version}`;
    errorBanner.hidden = true;
  } catch (e) {
    healthDot.className = 'health-dot health-down';
    healthDot.title = `health probe failed: ${e.detail || e.message}`;
    apiVersion.textContent = '';
    showFatal(`titan-tyr unreachable at ${api.getConfig().tyrBaseUrl} — ${e.detail || e.message}`);
  }
}

function startHealthProbe() {
  probeHealth();
  setInterval(probeHealth, 30000);
}

function showFatal(msg) {
  errorBanner.innerHTML = `<span>${esc(msg)}</span><button id="retry-btn" class="retry-btn">Retry</button>`;
  errorBanner.hidden = false;
  document.getElementById('retry-btn').addEventListener('click', () => {
    errorBanner.hidden = true;
    probeHealth();
    catalog.load(search.value.trim());
  });
}

start();
