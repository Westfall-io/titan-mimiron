import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { search, health } from '../store.js';
import ProjectPicker from './ProjectPicker.js';

export default {
  components: { ProjectPicker },
  setup() {
    const route = useRoute();
    const isTemplatesRoute = computed(() =>
      route.name === 'templates' || route.name === 'template'
    );
    const isPartsRoute = computed(() => !isTemplatesRoute.value);

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

    return { search, health, dotClass, dotTitle, isTemplatesRoute, isPartsRoute };
  },
  template: /* html */ `
    <header id="app-header">
      <div class="wordmark">WatcherVault</div>
      <nav class="header-nav" aria-label="primary">
        <router-link to="/" class="header-link" :class="{ active: isPartsRoute }">Parts</router-link>
        <router-link to="/templates" class="header-link" :class="{ active: isTemplatesRoute }">Templates</router-link>
      </nav>
      <input
        v-if="!isTemplatesRoute"
        v-model="search"
        id="search"
        type="search"
        placeholder="Search parts…"
        autocomplete="off"
        spellcheck="false"
      />
      <project-picker v-if="!isTemplatesRoute" />
      <div class="header-meta">
        <span v-if="health.version" class="api-version">tyr {{ health.version }}</span>
        <span class="health-dot" :class="dotClass" :title="dotTitle"></span>
      </div>
    </header>
  `,
};
