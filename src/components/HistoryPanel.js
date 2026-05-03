import { ref, watch } from 'vue';
import * as api from '../api.js';
import { relativeTime } from '../util.js';

// Collapsible "Version history" panel, mounted below the markdown body in
// SoftwareDetail and ContractDetail. Lazy-loads on first expand (per the
// consumer obligation in mimiron↔tyr contract `1.2.0-rc1`).
//
// Pending titan-tyr#20 — until that ships, the API returns 404 and we
// surface a "history endpoint not yet available" message inline rather
// than treating it as a real error.
export default {
  props: {
    kind: { type: String, required: true, validator: (v) => v === 'software' || v === 'contract' },
    id: { type: String, required: true },
  },
  setup(props) {
    const expanded = ref(false);
    const entries = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const fetched = ref(false);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        const fn = props.kind === 'software' ? api.listSoftwareHistory : api.listContractHistory;
        const data = await fn(props.id);
        entries.value = data.results || [];
        fetched.value = true;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    function toggle() {
      expanded.value = !expanded.value;
      if (expanded.value && !fetched.value && !loading.value) load();
    }

    // Reset when the route id changes underneath the panel (e.g. catalog
    // navigation while a panel is expanded). The component instance is
    // typically reused across same-component route changes.
    watch(
      () => props.id,
      () => {
        expanded.value = false;
        entries.value = [];
        error.value = null;
        fetched.value = false;
        loading.value = false;
      }
    );

    return { expanded, entries, loading, error, fetched, toggle, relativeTime };
  },
  template: /* html */ `
    <div class="detail-section history-panel">
      <button
        type="button"
        class="history-toggle"
        :aria-expanded="expanded"
        @click="toggle"
      >
        <span class="chevron" :class="{ open: expanded }">▸</span>
        <span class="history-title">Version history</span>
        <span v-if="fetched" class="section-count">{{ entries.length }}</span>
      </button>
      <div v-if="expanded" class="history-body">
        <div v-if="loading" class="detail-loading">loading…</div>
        <div v-else-if="error && error.status === 404" class="history-pending">
          version history endpoint not yet available —
          pending <a href="https://github.com/Westfall-io/titan-tyr/issues/20" target="_blank" rel="noopener noreferrer">titan-tyr#20</a>
        </div>
        <div v-else-if="error" class="detail-error">
          <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
          <div class="detail-error-detail">{{ error.detail || error.message }}</div>
        </div>
        <div v-else-if="entries.length === 0" class="detail-empty-inline">no history</div>
        <div v-else class="history-list">
          <div v-for="(e, i) in entries" :key="e.version" class="history-row">
            <span class="version-chip">v{{ e.version }}</span>
            <span v-if="i === 0" class="current-marker">current</span>
            <span class="updated-chip" :title="e.updated_at">{{ relativeTime(e.updated_at) }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
};
