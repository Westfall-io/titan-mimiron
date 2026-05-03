import { computed } from 'vue';
import { search, health } from '../store.js';

export default {
  setup() {
    const dotClass = computed(() => {
      const h = health.value;
      if (h.status === 'unknown') return 'health-unknown';
      if (h.status === 'down') return 'health-down';
      if (h.status === 'ok' && h.db === 'reachable') return 'health-ok';
      return 'health-degraded';
    });

    const dotTitle = computed(() => {
      const h = health.value;
      if (h.status === 'unknown') return 'API health: unknown';
      if (h.status === 'down') return 'API unreachable';
      return `API ${h.version} · status ${h.status} · db ${h.db}`;
    });

    return { search, health, dotClass, dotTitle };
  },
  template: /* html */ `
    <header id="app-header">
      <div class="wordmark">WatcherVault</div>
      <input
        v-model="search"
        id="search"
        type="search"
        placeholder="Search parts…"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="header-meta">
        <span v-if="health.version" class="api-version">tyr {{ health.version }}</span>
        <span class="health-dot" :class="dotClass" :title="dotTitle"></span>
      </div>
    </header>
  `,
};
