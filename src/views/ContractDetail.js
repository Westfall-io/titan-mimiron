import { ref, computed, watch, onMounted } from 'vue';
import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import { relativeTime } from '../util.js';
import HistoryPanel from '../components/HistoryPanel.js';
import OpenShiftsPanel from '../components/OpenShiftsPanel.js';

export default {
  components: { HistoryPanel, OpenShiftsPanel },
  props: { id: { type: String, required: true } },
  setup(props) {
    const contract = ref(null);
    const ownerPart = ref(null);          // for cross-project comparison
    const counterpartyPart = ref(null);   // for cross-project comparison
    const loading = ref(false);
    const error = ref(null);

    const stamp = computed(() =>
      contract.value ? extractStamp(contract.value.markdown) : { kind: null, version: null, body: '' }
    );
    const renderedBody = computed(() =>
      stamp.value.body ? renderMarkdown(stamp.value.body) : ''
    );

    // Cross-project boundary: a contract is "cross-project" when its own
    // project differs from one or both endpoints'. Per the 2.5.0 design,
    // contracts carry whichever project owns the *relationship* and don't
    // auto-inherit from endpoints — so a non-null mismatch is meaningful.
    // Pre-v0.18.0 rows are all-null; treat null as "unprojected" for the
    // comparison (matches PROJECT_NONE filter semantics on the picker).
    const crossProject = computed(() => {
      if (!contract.value || !ownerPart.value || !counterpartyPart.value) return null;
      const cp = contract.value.project || null;
      const op = ownerPart.value.project || null;
      const np = counterpartyPart.value.project || null;
      if (cp === op && cp === np) return null;   // aligned
      return { contract: cp, owner: op, counterparty: np };
    });

    async function load(id) {
      loading.value = true;
      error.value = null;
      contract.value = null;
      ownerPart.value = null;
      counterpartyPart.value = null;
      try {
        const c = await api.getContract(id);
        contract.value = c;
        // Endpoint parts in parallel — needed only for cross-project check;
        // failures here downgrade gracefully (cross-project banner just
        // doesn't render). Not surfacing as a fatal error.
        const [op, np] = await Promise.all([
          api.getPart(c.owner).catch(() => null),
          api.getPart(c.counterparty).catch(() => null),
        ]);
        ownerPart.value = op;
        counterpartyPart.value = np;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(props.id));
    watch(() => props.id, (newId) => { if (newId) load(newId); });

    return { contract, loading, error, stamp, renderedBody, crossProject, relativeTime };
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
            <span v-if="contract.connection_type" class="connection-type-chip" :title="'connection_type: ' + contract.connection_type">{{ contract.connection_type }}</span>
            <router-link v-if="contract.project" :to="'/projects/' + encodeURIComponent(contract.project)" class="project-chip" :title="'project: ' + contract.project">{{ contract.project }}</router-link>
            <span v-else class="project-chip project-none" title="unprojected (no project tag)">— unprojected —</span>
            <span class="topbar-name">{{ contract.owner }} → {{ contract.counterparty }}</span>
          </div>
          <div class="topbar-row chips">
            <span class="version-chip">v{{ contract.version }}</span>
            <router-link v-if="stamp.version" :to="'/templates/' + stamp.kind" class="template-chip" title="View template">tpl {{ stamp.kind }}@{{ stamp.version }}</router-link>
            <span class="updated-chip" :title="contract.updated_at">{{ relativeTime(contract.updated_at) }}</span>
            <span v-if="contract.created_by_actor" class="actor-chip" :title="'X-Actor at registration time'">registered by {{ contract.created_by_actor }}</span>
            <span v-else class="actor-chip actor-anon" title="No X-Actor recorded — pre-v0.16.0 row or registered without attribution">registered: anonymous (legacy)</span>
          </div>
          <div class="topbar-row links">
            <router-link :to="'/parts/' + encodeURIComponent(contract.owner)" class="link-pill">owner: {{ contract.owner }}</router-link>
            <router-link :to="'/parts/' + encodeURIComponent(contract.counterparty)" class="link-pill">counterparty: {{ contract.counterparty }}</router-link>
          </div>
          <div v-if="crossProject" class="cross-project-banner" title="The contract's project differs from one or both endpoints' projects. Cross-project contracts are allowed by design — the contract carries whichever project owns the relationship rather than inheriting from the owner.">
            <span class="cross-project-glyph">⤫</span>
            <span class="cross-project-label">cross-project boundary:</span>
            <span class="cross-project-detail">
              contract <span class="cross-project-slug">{{ crossProject.contract || '— unprojected —' }}</span>
              · owner <span class="cross-project-slug">{{ crossProject.owner || '— unprojected —' }}</span>
              · counterparty <span class="cross-project-slug">{{ crossProject.counterparty || '— unprojected —' }}</span>
            </span>
          </div>
        </div>
        <div class="detail-body markdown-body" v-html="renderedBody"></div>
        <open-shifts-panel kind="contract" :id="contract.contract_id" />
        <history-panel kind="contract" :id="contract.contract_id" />
      </template>
    </div>
  `,
};
