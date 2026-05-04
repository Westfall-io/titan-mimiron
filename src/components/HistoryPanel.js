import { ref, watch } from 'vue';
import * as api from '../api.js';
import { relativeTime } from '../util.js';

// Collapsible "Version history" panel, mounted below the markdown body in
// PartDetail, ContractDetail, and TemplateDetail. Lazy-loads on first
// expand (per the consumer obligation in mimiron↔tyr contract `2.0.0`).
//
// Three kinds today:
//   • 'part'     → GET /parts/{name}/history     → { results: [{ version, updated_at }] }
//   • 'contract' → GET /contracts/{id}/history   → { results: [{ version, updated_at }] }
//   • 'template' → GET /templates/{kind}/proposals → { kind, active_version, proposals: [] }
//
// Templates have no per-version history endpoint — the API only surfaces
// the active version + currently-pending RC proposals. We render that as:
// a single `current` row for the active version, then one row per pending
// proposal with a `proposal` status chip. No `updated_at` on template rows
// because the API doesn't expose it (yet).
//
// Pending titan-tyr#20 — until that ships, the part/contract endpoints
// return 404 and we surface a "history endpoint not yet available" message
// inline rather than treating it as a real error.
export default {
  props: {
    kind: {
      type: String,
      required: true,
      validator: (v) => v === 'part' || v === 'contract' || v === 'template',
    },
    id: { type: String, required: true },
  },
  setup(props) {
    const expanded = ref(false);
    const entries = ref([]);
    const activeVersion = ref(null);  // template-only
    const loading = ref(false);
    const error = ref(null);
    const fetched = ref(false);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        if (props.kind === 'template') {
          const data = await api.getTemplateProposals(props.id);
          activeVersion.value = data.active_version || null;
          // Provider v0.16.0+ adds proposer_actor / acceptor_actor /
          // single_operator_override to each proposal. Forward them so the
          // template history rows surface the same attribution as content
          // proposals on contracts.
          entries.value = (data.proposals || []).map((p) => ({
            version: p.version,
            updated_at: p.proposed_at || p.updated_at || null,
            status: p.status || 'proposal',
            proposer_actor: p.proposer_actor ?? null,
            acceptor_actor: p.acceptor_actor ?? null,
            single_operator_override: p.single_operator_override ?? false,
          }));
        } else {
          const fn = props.kind === 'part' ? api.listPartHistory : api.listContractHistory;
          const data = await fn(props.id);
          activeVersion.value = null;
          // Provider v0.15.0+ tags each entry with `kind` (body_bump |
          // subtype_shift). Pre-v0.15.0 responses lack the field — default
          // to body_bump per the contract's backwards-compat clause so a
          // brief window of provider-old / consumer-new round-trips still
          // renders correctly. v0.16.0+ extends each row with
          // proposer_actor / acceptor_actor / single_operator_override
          // (null/false on pre-v0.16.0 rows).
          entries.value = (data.results || []).map((e) => ({
            ...e,
            status: null,
            entryKind: e.kind || 'body_bump',
            proposer_actor: e.proposer_actor ?? null,
            acceptor_actor: e.acceptor_actor ?? null,
            single_operator_override: e.single_operator_override ?? false,
          }));
        }
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
        activeVersion.value = null;
        error.value = null;
        fetched.value = false;
        loading.value = false;
      }
    );

    return { expanded, entries, activeVersion, loading, error, fetched, toggle, relativeTime };
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
        <span v-if="fetched" class="section-count">{{ entries.length + (activeVersion ? 1 : 0) }}</span>
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
        <div v-else-if="!activeVersion && entries.length === 0" class="detail-empty-inline">no history</div>
        <div v-else class="history-list">
          <div v-if="activeVersion" class="history-row">
            <span class="version-chip">v{{ activeVersion }}</span>
            <span class="current-marker">current</span>
          </div>
          <div v-for="(e, i) in entries" :key="(e.entryKind || 'x') + '-' + e.version + '-' + (e.updated_at || i)" class="history-row" :class="'history-row-' + (e.entryKind || 'body_bump')">
            <span v-if="e.entryKind === 'subtype_shift'" class="kind-glyph kind-shift" title="subtype shift — accepted via /accept-…-subtype-shift skill">↻</span>
            <span v-else-if="e.entryKind === 'body_bump'" class="kind-glyph kind-bump" title="body bump — accepted content proposal">●</span>
            <span class="version-chip">v{{ e.version }}</span>
            <span v-if="e.entryKind === 'subtype_shift'" class="kind-label">subtype shift</span>
            <span v-if="e.status" class="proposal-chip">{{ e.status }}</span>
            <span v-else-if="i === 0 && !activeVersion && e.entryKind !== 'subtype_shift'" class="current-marker">current</span>
            <span v-if="e.updated_at" class="updated-chip" :title="e.updated_at">{{ relativeTime(e.updated_at) }}</span>
            <span v-if="e.single_operator_override" class="override-chip" title="Accepted under single-operator override (?single_operator=true) — bypassed the proposer-doesn't-accept rule. Visible by design so the bypass is auditable.">⚠ single-operator override</span>
            <span v-if="e.proposer_actor" class="actor-chip actor-chip-mini" :title="'X-Actor when this version was proposed'">prop {{ e.proposer_actor }}</span>
            <span v-else-if="e.entryKind === 'body_bump' || e.status" class="actor-chip actor-chip-mini actor-anon" title="No X-Actor at propose time — two-party rule unenforceable on this entry">prop anonymous</span>
            <span v-if="e.acceptor_actor" class="actor-chip actor-chip-mini" :title="'X-Actor at accept time'">acc {{ e.acceptor_actor }}</span>
            <span v-else-if="(e.entryKind === 'body_bump' && !e.status) || (e.status === 'accepted')" class="actor-chip actor-chip-mini actor-anon" title="No X-Actor recorded at accept time">acc anonymous</span>
          </div>
        </div>
      </div>
    </div>
  `,
};
