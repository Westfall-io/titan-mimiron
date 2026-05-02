import { createApp, watch } from 'vue';
import App from './App.js';
import router from './router.js';
import * as api from './api.js';
import { health, fatal, retryNonce } from './store.js';

async function start() {
  try {
    await api.loadConfig();
  } catch (e) {
    fatal.value = `Failed to load config.json: ${e.message}`;
  }

  createApp(App).use(router).mount('#app');

  async function probeHealth() {
    try {
      health.value = await api.health();
      if (fatal.value && fatal.value.startsWith('titan-tyr unreachable')) fatal.value = null;
    } catch (e) {
      health.value = { status: 'down', version: '', db: '' };
      fatal.value = `titan-tyr unreachable at ${api.getConfig().tyrBaseUrl} — ${e.detail || e.message}`;
    }
  }

  probeHealth();
  setInterval(probeHealth, 30000);
  watch(retryNonce, probeHealth);
}

start();
