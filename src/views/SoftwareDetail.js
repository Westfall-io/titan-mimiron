import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import { relativeTime, repoLink, trackerLink } from '../util.js';

export default {
  props: { name: { type: String, required: true } },
  setup(props) {
    const route = useRoute();
    const sw = ref(null);
    const contracts = ref([]);
    const loading = ref(false);
    const error = ref(null);

    const stamp = computed(() =>
      sw.value ? extractStamp(sw.value.markdown) : { kind: null, version: null, body: '' }
    );
    const renderedBody = computed(() =>
      stamp.value.body ? renderMarkdown(stamp.value.body) : ''
    );

    async function load(name) {
      loading.value = true;
      error.value = null;
      sw.value = null;
      contracts.value = [];
      try {
        const [s, c] = await Promise.all([
          api.getSoftware(name),
          api.listSoftwareContracts(name),
        ]);
        sw.value = s;
        contracts.value = c.results;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(props.name));
    watch(() => props.name, (newName) => { if (newName) load(newName); });

    function direction(c) { return c.owner === route.params.name ? 'out' : 'in'; }
    function other(c) { return c.owner === route.params.name ? c.counterparty : c.owner; }

    return {
      sw, contracts, loading, error, stamp, renderedBody,
      relativeTime, repoLink, trackerLink, direction, other,
    };
  },
  template: /* html */ `
    <div class="detail-content">
      <div v-if="loading && !sw" class="detail-loading">Loading…</div>
      <div v-else-if="error" class="detail-error">
        <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
        <div class="detail-error-detail">{{ error.detail || error.message }}</div>
      </div>
      <template v-else-if="sw">
        <div class="detail-topbar">
          <div class="topbar-row">
            <span class="type-badge type-software">software</span>
            <span class="topbar-name">{{ sw.name }}</span>
          </div>
          <div class="topbar-row chips">
            <span class="version-chip">v{{ sw.version }}</span>
            <span v-if="stamp.version" class="template-chip" title="Template version">tpl {{ stamp.kind }}@{{ stamp.version }}</span>
            <span class="updated-chip" :title="sw.updated_at">{{ relativeTime(sw.updated_at) }}</span>
          </div>
          <div class="topbar-row links">
            <a :href="repoLink(sw.repo_uri)" target="_blank" rel="noopener" class="link-pill">repo</a>
            <a :href="trackerLink(sw)" target="_blank" rel="noopener" class="link-pill">issues</a>
            <span v-if="sw.aliases.length" class="alias-group">
              aliases:
              <span v-for="a in sw.aliases" :key="a" class="alias-chip">{{ a }}</span>
            </span>
          </div>
        </div>
        <div class="detail-body markdown-body" v-html="renderedBody"></div>
        <div class="detail-section">
          <h2 class="section-title">
            Contracts <span class="section-count">{{ contracts.length }}</span>
          </h2>
          <div class="contracts-list">
            <div v-if="contracts.length === 0" class="detail-empty-inline">no contracts</div>
            <router-link
              v-for="c in contracts"
              :key="c.contract_id"
              :to="'/contracts/' + encodeURIComponent(c.contract_id)"
              class="contract-row"
            >
              <span class="direction-chip" :class="'dir-' + direction(c)">{{ direction(c) }}</span>
              <span class="contract-other">{{ other(c) }}</span>
              <span class="contract-meta">v{{ c.version }} · {{ relativeTime(c.updated_at) }}</span>
            </router-link>
          </div>
        </div>
      </template>
    </div>
  `,
};
