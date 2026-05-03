import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import { relativeTime, repoLink, trackerLink } from '../util.js';
import HistoryPanel from '../components/HistoryPanel.js';

export default {
  components: { HistoryPanel },
  props: { name: { type: String, required: true } },
  setup(props) {
    const route = useRoute();
    const part = ref(null);
    const contracts = ref([]);
    const loading = ref(false);
    const error = ref(null);

    const stamp = computed(() =>
      part.value ? extractStamp(part.value.markdown) : { kind: null, version: null, body: '' }
    );
    const renderedBody = computed(() =>
      stamp.value.body ? renderMarkdown(stamp.value.body) : ''
    );

    async function load(name) {
      loading.value = true;
      error.value = null;
      part.value = null;
      contracts.value = [];
      try {
        const [p, c] = await Promise.all([
          api.getPart(name),
          api.listPartContracts(name),
        ]);
        part.value = p;
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
      part, contracts, loading, error, stamp, renderedBody,
      relativeTime, repoLink, trackerLink, direction, other,
    };
  },
  template: /* html */ `
    <div class="detail-content">
      <div v-if="loading && !part" class="detail-loading">Loading…</div>
      <div v-else-if="error" class="detail-error">
        <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
        <div class="detail-error-detail">{{ error.detail || error.message }}</div>
      </div>
      <template v-else-if="part">
        <div class="detail-topbar">
          <div class="topbar-row">
            <span class="type-badge type-part">part</span>
            <span class="subtype-chip" :class="'subtype-' + part.subtype">{{ part.subtype }}</span>
            <span class="topbar-name">{{ part.name }}</span>
          </div>
          <div class="topbar-row chips">
            <span class="version-chip">v{{ part.version }}</span>
            <router-link v-if="stamp.version" :to="'/templates/' + stamp.kind" class="template-chip" title="View template">tpl {{ stamp.kind }}@{{ stamp.version }}</router-link>
            <span class="updated-chip" :title="part.updated_at">{{ relativeTime(part.updated_at) }}</span>
          </div>
          <div class="topbar-row links">
            <a :href="repoLink(part.repo_uri)" target="_blank" rel="noopener" class="link-pill">repo</a>
            <a :href="trackerLink(part)" target="_blank" rel="noopener" class="link-pill">issues</a>
            <span v-if="part.aliases.length" class="alias-group">
              aliases:
              <span v-for="a in part.aliases" :key="a" class="alias-chip">{{ a }}</span>
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
              <span v-if="c.subtype" class="subtype-chip subtype-mini" :class="'subtype-' + c.subtype">{{ c.subtype }}</span>
              <span v-if="c.connection_type" class="connection-type-chip connection-type-mini" :title="'connection_type: ' + c.connection_type">{{ c.connection_type }}</span>
              <span class="contract-other">{{ other(c) }}</span>
              <span class="contract-meta">v{{ c.version }} · {{ relativeTime(c.updated_at) }}</span>
            </router-link>
          </div>
        </div>
        <history-panel kind="part" :id="part.name" />
      </template>
    </div>
  `,
};
