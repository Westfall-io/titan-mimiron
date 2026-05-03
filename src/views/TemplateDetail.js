import { ref, computed, watch, onMounted } from 'vue';
import * as api from '../api.js';
import { renderMarkdown, extractStamp } from '../markdown.js';
import HistoryPanel from '../components/HistoryPanel.js';
import UsageSection from '../components/UsageSection.js';

// Detail page for a single template kind. The body is the active template
// markdown as served by `GET /templates/{kind}`. The first line of that body
// is itself a literal stamp (`<!-- template: kind@X.Y.Z -->`) — surface it
// as a chip alongside the active version we already learned from the
// proposals endpoint.
//
// 404 path: legacy stamps (e.g. `contract` from before the v0.10.0 rename
// to `interaction`) won't resolve. Render a "template not found" state with
// a hint rather than a generic error. The kind list mirrors api.TEMPLATE_KINDS;
// `connection` was added alongside titan-tyr v0.11.0.
export default {
  components: { HistoryPanel, UsageSection },
  props: { kind: { type: String, required: true } },
  setup(props) {
    const body = ref(null);
    const proposals = ref(null);   // { kind, active_version, proposals: [] }
    const loading = ref(false);
    const error = ref(null);

    const stamp = computed(() =>
      body.value ? extractStamp(body.value) : { kind: null, version: null, body: '' }
    );
    const renderedBody = computed(() =>
      stamp.value.body ? renderMarkdown(stamp.value.body) : ''
    );

    async function load(kind) {
      loading.value = true;
      error.value = null;
      body.value = null;
      proposals.value = null;
      try {
        const [b, p] = await Promise.all([
          api.getTemplate(kind),
          api.getTemplateProposals(kind),
        ]);
        body.value = b;
        proposals.value = p;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(props.kind));
    watch(() => props.kind, (newKind) => { if (newKind) load(newKind); });

    return { kind: () => props.kind, body, proposals, loading, error, stamp, renderedBody };
  },
  template: /* html */ `
    <div class="detail-content">
      <div v-if="loading && !body" class="detail-loading">Loading…</div>
      <div v-else-if="error && error.status === 404" class="detail-error">
        <div class="detail-error-status">no template named <code>{{ $route.params.kind }}</code></div>
        <div class="detail-error-detail">
          The current template kinds are <code>software</code>, <code>image</code>,
          <code>container</code>, <code>pod</code>, <code>compose</code>,
          <code>interaction</code>, <code>binding</code>, and <code>connection</code>.
          Legacy stamps (e.g. <code>contract</code> before the v0.10.0 rename to
          <code>interaction</code>) won't resolve — the body that linked here was
          likely stamped before the rename.
        </div>
      </div>
      <div v-else-if="error" class="detail-error">
        <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
        <div class="detail-error-detail">{{ error.detail || error.message }}</div>
      </div>
      <template v-else-if="body && proposals">
        <div class="detail-topbar">
          <div class="topbar-row">
            <span class="type-badge type-template">template</span>
            <span class="topbar-name">{{ proposals.kind }}</span>
          </div>
          <div class="topbar-row chips">
            <span class="version-chip">v{{ proposals.active_version }}</span>
            <span v-if="stamp.version" class="template-chip" title="Stamp on the active body">stamp {{ stamp.kind }}@{{ stamp.version }}</span>
          </div>
        </div>
        <div class="detail-body markdown-body" v-html="renderedBody"></div>
        <history-panel kind="template" :id="proposals.kind" />
        <usage-section :kind="proposals.kind" :active-version="proposals.active_version" />
      </template>
    </div>
  `,
};
