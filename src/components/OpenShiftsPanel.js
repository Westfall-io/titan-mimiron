import { ref, watch } from 'vue';
import * as api from '../api.js';
import { relativeTime } from '../util.js';

// Read-only "Open subtype shifts" panel. Lists pending shift proposals on a
// part or contract. Mimiron does not propose or accept shifts — those are
// driven by the canonical Claude Code skills (propose-…-subtype-shift,
// accept-…-subtype-shift, plus accept-contract-proposal which auto-branches
// between content + shift). This panel exists so humans can SEE what agents
// are negotiating without having to drop into curl. Each row surfaces the
// canonical skill name to invoke for acceptance.
//
// Same lazy-load pattern as HistoryPanel: nothing fetched until the user
// expands the section. Backwards-compat with pre-v0.15.0 providers: the
// fetch returns 404, surfaced as a small "endpoint not yet available" hint
// inline rather than a fatal error.
export default {
  props: {
    kind: {
      type: String,
      required: true,
      validator: (v) => v === 'part' || v === 'contract',
    },
    id: { type: String, required: true },
  },
  setup(props) {
    const expanded = ref(false);
    const proposals = ref([]);   // filtered to status==='proposal' only
    const loading = ref(false);
    const error = ref(null);
    const fetched = ref(false);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        const fn = props.kind === 'part'
          ? api.listPartSubtypeProposals
          : api.listContractSubtypeProposals;
        const data = await fn(props.id);
        proposals.value = (data.proposals || []).filter((p) => p.status === 'proposal');
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

    watch(
      () => props.id,
      () => {
        expanded.value = false;
        proposals.value = [];
        error.value = null;
        fetched.value = false;
        loading.value = false;
      }
    );

    // Skill name to invoke when accepting a pending shift. accept-contract-
    // proposal handles both content and shift acceptance for contracts; parts
    // have a dedicated accept skill since they don't share the content
    // proposal endpoint.
    const acceptSkill = props.kind === 'part'
      ? '/accept-part-subtype-shift'
      : '/accept-contract-proposal';

    return { expanded, proposals, loading, error, fetched, toggle, acceptSkill, relativeTime };
  },
  template: /* html */ `
    <div class="detail-section shifts-panel">
      <button
        type="button"
        class="history-toggle"
        :aria-expanded="expanded"
        @click="toggle"
      >
        <span class="chevron" :class="{ open: expanded }">▸</span>
        <span class="history-title">Open subtype shifts</span>
        <span v-if="fetched" class="section-count">{{ proposals.length }}</span>
      </button>
      <div v-if="expanded" class="shifts-body">
        <div v-if="loading" class="detail-loading">loading…</div>
        <div v-else-if="error && error.status === 404" class="history-pending">
          subtype-shift endpoint not yet available — provider needs titan-tyr v0.15.0+
        </div>
        <div v-else-if="error" class="detail-error">
          <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
          <div class="detail-error-detail">{{ error.detail || error.message }}</div>
        </div>
        <div v-else-if="proposals.length === 0" class="detail-empty-inline">no open shift proposals</div>
        <div v-else class="shifts-list">
          <div v-for="p in proposals" :key="p.proposal_id" class="shift-row">
            <div class="shift-shift">
              <span class="subtype-chip subtype-mini" :class="'subtype-' + p.current_subtype">{{ p.current_subtype }}</span>
              <span v-if="p.current_connection_type" class="connection-type-chip connection-type-mini">{{ p.current_connection_type }}</span>
              <span class="shift-arrow">→</span>
              <span class="subtype-chip subtype-mini" :class="'subtype-' + p.new_subtype">{{ p.new_subtype }}</span>
              <span v-if="p.new_connection_type" class="connection-type-chip connection-type-mini">{{ p.new_connection_type }}</span>
            </div>
            <div class="shift-meta">
              <span class="shift-actor" :title="p.proposer_actor ? 'X-Actor at propose time' : 'no X-Actor passed — two-party rule unenforceable on this proposal'">
                <template v-if="p.proposer_actor">by {{ p.proposer_actor }}</template>
                <template v-else><span class="shift-anon">⚠ anonymous proposer</span></template>
              </span>
              <span v-if="p.single_operator_override" class="override-chip" title="Accepted under single-operator override (?single_operator=true) — bypassed the proposer-doesn't-accept rule. Visible by design so the bypass is auditable.">⚠ single-operator override</span>
              <span v-if="p.created_at" class="updated-chip" :title="p.created_at">{{ relativeTime(p.created_at) }}</span>
            </div>
            <div v-if="p.rationale" class="shift-rationale">{{ p.rationale }}</div>
            <div v-if="p.impact" class="shift-impact">
              <div v-if="p.impact.body_realign_required" class="impact-banner">
                After acceptance, file a content proposal that re-stamps the body to
                <code>{{ p.new_subtype }}@&lt;active-template-version&gt;</code>.
              </div>
              <div v-if="p.impact.source_target_validation === 'fail'" class="impact-fail">
                source/target rule fails against current endpoint parts (would have been rejected at propose time)
              </div>
              <div v-if="p.impact.related_rows_potentially_affected && p.impact.related_rows_potentially_affected.length > 0" class="impact-rows">
                <div class="impact-rows-title">{{ p.impact.related_rows_potentially_affected.length }} related row(s) may become structurally invalid:</div>
                <div v-for="r in p.impact.related_rows_potentially_affected" :key="r.contract_id" class="impact-row">
                  <router-link :to="'/contracts/' + encodeURIComponent(r.contract_id)" class="impact-row-link">
                    {{ r.owner }} → {{ r.counterparty }} <span class="subtype-chip subtype-mini" :class="'subtype-' + r.subtype">{{ r.subtype }}</span>
                  </router-link>
                  <div class="impact-reason">{{ r.reason }}</div>
                </div>
              </div>
            </div>
            <div class="shift-accept-hint">
              accept via <code>{{ acceptSkill }}</code> from a Claude Code session
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
