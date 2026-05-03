import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '../api.js';

// Left-pane index for /templates*. Loads each known template kind's
// `proposals` summary in parallel on mount — gives us active_version and
// pending proposal count per row without hitting the body endpoint.
export default {
  setup() {
    const route = useRoute();
    const rows = ref([]);
    const loading = ref(false);
    const error = ref(null);

    const activeKind = computed(() =>
      route.name === 'template' ? route.params.kind : null
    );

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        rows.value = await Promise.all(
          api.TEMPLATE_KINDS.map(async (kind) => {
            try {
              const p = await api.getTemplateProposals(kind);
              return { kind, active_version: p.active_version, proposalCount: (p.proposals || []).length, error: null };
            } catch (e) {
              return { kind, active_version: null, proposalCount: 0, error: e };
            }
          })
        );
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(load);

    return { rows, loading, error, activeKind };
  },
  template: /* html */ `
    <section class="pane templates-index" aria-label="templates">
      <div class="catalog-list">
        <div v-if="error" class="catalog-error">{{ error.detail || error.message }}</div>
        <div v-else-if="loading && rows.length === 0" class="catalog-empty">loading…</div>
        <router-link
          v-for="r in rows"
          :key="r.kind"
          :to="'/templates/' + r.kind"
          class="catalog-row"
          :class="{ active: r.kind === activeKind }"
        >
          <div class="row-name">
            <span class="subtype-chip subtype-mini" :class="'subtype-' + r.kind">{{ r.kind }}</span>
          </div>
          <div class="row-meta">
            <span v-if="r.active_version" class="version-chip">v{{ r.active_version }}</span>
            <span v-else-if="r.error" class="catalog-error-inline">unavailable</span>
            <span v-if="r.proposalCount > 0" class="proposal-chip" :title="r.proposalCount + ' pending proposal(s)'">{{ r.proposalCount }} rc</span>
          </div>
        </router-link>
      </div>
    </section>
  `,
};
