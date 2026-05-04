import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '../api.js';
import { search, retryNonce, project } from '../store.js';

// Catalog: collapsible sections grouped by subtype, parts above contracts.
// Sections appear only if they contain at least one entry — empty sections
// would be clutter, and sections appear automatically as the catalog grows.
//
// Compute is fully client-side (fetchAll on mount). Pagination is dropped
// in favor of grouping — paginating per-section breaks the alphabetical
// model, and a paginated *across-section* sort is incoherent. If the
// catalog grows large enough to feel slow, follow-up is a server-side
// `GET /catalog/grouped` aggregate; not worth the complexity yet.
//
// Search is client-side too. The contract's `?match=` lookup only exists on
// parts (per mimiron↔tyr 2.2.0); contracts have no equivalent. Filtering
// against in-memory rows gives consistent UX across both — search hides
// non-matching rows; sections with zero remaining matches collapse out.
//
// Section ordering follows api.TEMPLATE_KINDS so source/runtime/contract
// chains read top-to-bottom: software → image → container → pod → compose
// → interaction → binding → connection.

// localStorage key prefix. One key per section, boolean value (true = collapsed).
const LS_PREFIX = 'mimiron.catalog.section.';

function loadCollapsed(kind) {
  try {
    return localStorage.getItem(LS_PREFIX + kind) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(kind, collapsed) {
  try {
    localStorage.setItem(LS_PREFIX + kind, collapsed ? '1' : '0');
  } catch {
    /* localStorage disabled — collapse state is session-only, no-op */
  }
}

export default {
  setup() {
    const route = useRoute();
    const parts = ref([]);
    const contracts = ref([]);
    const loading = ref(false);
    const error = ref(null);
    // Per-section collapse map, hydrated from localStorage on first read.
    // Sections that haven't been toggled yet default to expanded.
    const collapsed = ref(Object.fromEntries(
      api.TEMPLATE_KINDS.map((k) => [k, loadCollapsed(k)])
    ));

    const activePartName = computed(() =>
      route.name === 'part' ? route.params.name : null
    );
    const activeContractId = computed(() =>
      route.name === 'contract' ? route.params.id : null
    );

    function matchesSearch(p, q) {
      if (!q) return true;
      const hay = [p.name, ...(p.aliases || [])].join(' ').toLowerCase();
      return hay.includes(q);
    }
    function contractMatchesSearch(c, q) {
      if (!q) return true;
      const hay = `${c.owner} ${c.counterparty} ${c.connection_type || ''}`.toLowerCase();
      return hay.includes(q);
    }

    // Sections returned in TEMPLATE_KINDS order. Each = { kind, isPart, rows }.
    // Empty sections are filtered out at render time.
    const sections = computed(() => {
      const q = (search.value || '').trim().toLowerCase();
      const partsBy = new Map();
      for (const p of parts.value) {
        if (!matchesSearch(p, q)) continue;
        if (!partsBy.has(p.subtype)) partsBy.set(p.subtype, []);
        partsBy.get(p.subtype).push(p);
      }
      const contractsBy = new Map();
      for (const c of contracts.value) {
        if (!contractMatchesSearch(c, q)) continue;
        if (!contractsBy.has(c.subtype)) contractsBy.set(c.subtype, []);
        contractsBy.get(c.subtype).push(c);
      }
      const out = [];
      for (const kind of api.TEMPLATE_KINDS) {
        const isPart = api.PART_SUBTYPES.includes(kind);
        const rows = isPart ? (partsBy.get(kind) || []) : (contractsBy.get(kind) || []);
        if (rows.length === 0) continue;
        // Stable alphabetical sort within each section. Parts by name,
        // contracts by "owner→counterparty" composite.
        const sorted = [...rows].sort(isPart
          ? (a, b) => a.name.localeCompare(b.name)
          : (a, b) => `${a.owner}→${a.counterparty}`.localeCompare(`${b.owner}→${b.counterparty}`));
        out.push({ kind, isPart, rows: sorted });
      }
      return out;
    });

    const totalCount = computed(() =>
      sections.value.reduce((n, s) => n + s.rows.length, 0)
    );
    const isFiltered = computed(() => (search.value || '').trim().length > 0);

    function toggle(kind) {
      collapsed.value = { ...collapsed.value, [kind]: !collapsed.value[kind] };
      saveCollapsed(kind, collapsed.value[kind]);
    }

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        // Server-side `?project=` filter when the picker is set; null = all
        // (no param). Re-fetches whenever the project picker changes so the
        // filter source-of-truth is the provider, not a client-side prune.
        const opts = project.value ? { project: project.value } : {};
        const [p, c] = await Promise.all([
          api.fetchAll(api.listParts, opts),
          api.fetchAll(api.listContracts, opts),
        ]);
        parts.value = p;
        contracts.value = c;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(load);
    watch(retryNonce, load);
    watch(project, load);

    return {
      loading, error, sections, collapsed, toggle,
      activePartName, activeContractId, totalCount, isFiltered, search,
    };
  },
  template: /* html */ `
    <section class="pane catalog-pane" aria-label="catalog">
      <div class="catalog-list">
        <div v-if="error" class="catalog-error">{{ error.detail || error.message }}</div>
        <div v-else-if="loading && sections.length === 0" class="catalog-empty">loading…</div>
        <div v-else-if="sections.length === 0 && isFiltered" class="catalog-empty">no matches</div>
        <div v-else-if="sections.length === 0" class="catalog-empty">catalog is empty</div>

        <div v-for="s in sections" :key="s.kind" class="catalog-section">
          <button
            type="button"
            class="section-header"
            :aria-expanded="!collapsed[s.kind]"
            @click="toggle(s.kind)"
          >
            <span class="chevron" :class="{ open: !collapsed[s.kind] }">▸</span>
            <span class="subtype-chip subtype-mini" :class="'subtype-' + s.kind">{{ s.kind }}</span>
            <span class="section-spacer"></span>
            <span class="section-count">{{ s.rows.length }}</span>
          </button>
          <div v-if="!collapsed[s.kind]" class="section-rows">
            <template v-if="s.isPart">
              <router-link
                v-for="p in s.rows"
                :key="p.name"
                :to="'/parts/' + encodeURIComponent(p.name)"
                class="catalog-row"
                :class="{ active: p.name === activePartName }"
              >
                <div class="row-name">{{ p.name }}</div>
                <div class="row-meta">
                  <span class="version-chip">v{{ p.version }}</span>
                  <router-link v-if="p.project" :to="'/projects/' + encodeURIComponent(p.project)" class="project-chip" @click.stop :title="'project: ' + p.project">{{ p.project }}</router-link>
                  <span v-else class="project-chip project-none" title="unprojected (no project tag)">— unprojected —</span>
                  <span v-for="a in p.aliases || []" :key="a" class="alias-chip">{{ a }}</span>
                </div>
              </router-link>
            </template>
            <template v-else>
              <router-link
                v-for="c in s.rows"
                :key="c.contract_id"
                :to="'/contracts/' + encodeURIComponent(c.contract_id)"
                class="catalog-row"
                :class="{ active: c.contract_id === activeContractId }"
              >
                <div class="row-name">
                  <span class="contract-pair">{{ c.owner }} → {{ c.counterparty }}</span>
                  <span v-if="c.connection_type" class="connection-type-chip connection-type-mini">{{ c.connection_type }}</span>
                </div>
                <div class="row-meta">
                  <span class="version-chip">v{{ c.version }}</span>
                  <router-link v-if="c.project" :to="'/projects/' + encodeURIComponent(c.project)" class="project-chip" @click.stop :title="'project: ' + c.project">{{ c.project }}</router-link>
                  <span v-else class="project-chip project-none" title="unprojected (no project tag)">— unprojected —</span>
                </div>
              </router-link>
            </template>
          </div>
        </div>
      </div>
    </section>
  `,
};
