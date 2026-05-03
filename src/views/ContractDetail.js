import { ref, computed, watch, onMounted } from 'vue';
import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import { relativeTime } from '../util.js';
import HistoryPanel from '../components/HistoryPanel.js';

export default {
  components: { HistoryPanel },
  props: { id: { type: String, required: true } },
  setup(props) {
    const contract = ref(null);
    const loading = ref(false);
    const error = ref(null);

    const stamp = computed(() =>
      contract.value ? extractStamp(contract.value.markdown) : { kind: null, version: null, body: '' }
    );
    const renderedBody = computed(() =>
      stamp.value.body ? renderMarkdown(stamp.value.body) : ''
    );

    async function load(id) {
      loading.value = true;
      error.value = null;
      contract.value = null;
      try {
        contract.value = await api.getContract(id);
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(props.id));
    watch(() => props.id, (newId) => { if (newId) load(newId); });

    return { contract, loading, error, stamp, renderedBody, relativeTime };
  },
  template: /* html */ `
    <div class="detail-content">
      <div v-if="loading && !contract" class="detail-loading">Loading…</div>
      <div v-else-if="error" class="detail-error">
        <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
        <div class="detail-error-detail">{{ error.detail || error.message }}</div>
      </div>
      <template v-else-if="contract">
        <div class="detail-topbar">
          <div class="topbar-row">
            <span class="type-badge type-contract">contract</span>
            <span v-if="contract.subtype" class="subtype-chip" :class="'subtype-' + contract.subtype">{{ contract.subtype }}</span>
            <span class="topbar-name">{{ contract.owner }} → {{ contract.counterparty }}</span>
          </div>
          <div class="topbar-row chips">
            <span class="version-chip">v{{ contract.version }}</span>
            <router-link v-if="stamp.version" :to="'/templates/' + stamp.kind" class="template-chip" title="View template">tpl {{ stamp.kind }}@{{ stamp.version }}</router-link>
            <span class="updated-chip" :title="contract.updated_at">{{ relativeTime(contract.updated_at) }}</span>
          </div>
          <div class="topbar-row links">
            <router-link :to="'/parts/' + encodeURIComponent(contract.owner)" class="link-pill">owner: {{ contract.owner }}</router-link>
            <router-link :to="'/parts/' + encodeURIComponent(contract.counterparty)" class="link-pill">counterparty: {{ contract.counterparty }}</router-link>
          </div>
        </div>
        <div class="detail-body markdown-body" v-html="renderedBody"></div>
        <history-panel kind="contract" :id="contract.contract_id" />
      </template>
    </div>
  `,
};
