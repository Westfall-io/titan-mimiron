import { ref, computed, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import mermaid from 'mermaid';
import * as api from '../api.js';
import { retryNonce, search } from '../store.js';

// Mermaid IDs must be alphanumeric/underscore. Part names are slug-shaped
// — replace hyphens with underscores and prefix to guarantee an alpha leading char.
const slug = (name) => 'p_' + name.replace(/-/g, '_');

function buildSource(parts, contracts) {
  const lines = ['graph LR'];
  for (const p of parts) {
    lines.push(`  ${slug(p.name)}["${p.name}"]`);
  }
  for (const c of contracts) {
    lines.push(
      `  ${slug(c.owner)} -->|"v${c.version}"| ${slug(c.counterparty)}`
    );
  }
  return lines.join('\n');
}

export default {
  setup() {
    const router = useRouter();
    const route = useRoute();
    const status = ref('loading');
    const error = ref(null);
    const counts = ref({ parts: 0, contracts: 0 });
    const containerRef = ref(null);
    let nodeMap = {};
    // Parts + contracts + edge-element refs survive past render() so the
    // search-dimming watcher can recompute against fresh data without a
    // graph re-render.
    let partList = [];
    let contractList = [];
    let edgePathEls = [];
    let edgeLabelEls = [];

    // For contract routes we need owner+counterparty; fetch the contract
    // to learn them, then highlight both endpoints.
    const contractEndpoints = ref([]);
    watch(
      () => [route.name, route.params.id],
      async ([name, id]) => {
        if (name !== 'contract' || !id) {
          contractEndpoints.value = [];
          return;
        }
        try {
          const c = await api.getContract(id);
          contractEndpoints.value = [slug(c.owner), slug(c.counterparty)];
        } catch {
          contractEndpoints.value = [];
        }
      },
      { immediate: true }
    );

    const selected = computed(() => {
      if (route.name === 'part') return [slug(route.params.name)];
      if (route.name === 'contract') return contractEndpoints.value;
      return [];
    });

    function applySelection() {
      const set = new Set(selected.value);
      for (const [s, el] of Object.entries(nodeMap)) {
        el.classList.toggle('node-selected', set.has(s));
      }
    }
    watch(selected, applySelection);

    // Search-dimming: nodes whose name/aliases don't substring-match the
    // current search drop to low opacity; edges where neither endpoint
    // matches dim too. Mirrors the catalog's `?match=` rule (substring,
    // case-insensitive, name + aliases).
    function applyDimming() {
      const q = (search.value || '').trim().toLowerCase();
      if (!q) {
        for (const el of Object.values(nodeMap)) el.classList.remove('node-dim');
        for (const el of edgePathEls) el?.classList.remove('edge-dim');
        for (const el of edgeLabelEls) el?.classList.remove('edge-dim');
        return;
      }
      const matchingSlugs = new Set();
      for (const p of partList) {
        const hay = [p.name, ...(p.aliases || [])].map((s) => s.toLowerCase());
        if (hay.some((h) => h.includes(q))) matchingSlugs.add(slug(p.name));
      }
      for (const [s, el] of Object.entries(nodeMap)) {
        el.classList.toggle('node-dim', !matchingSlugs.has(s));
      }
      contractList.forEach((c, i) => {
        const dim =
          !matchingSlugs.has(slug(c.owner)) &&
          !matchingSlugs.has(slug(c.counterparty));
        edgePathEls[i]?.classList.toggle('edge-dim', dim);
        edgeLabelEls[i]?.classList.toggle('edge-dim', dim);
      });
    }
    watch(search, applyDimming);

    // Wire post-render click handlers for nodes and edges. We don't use
    // Mermaid's `click ID call fn()` DSL because it relies on a global window
    // function and is fragile across Mermaid versions; direct DOM listeners
    // also let us make edges clickable (Mermaid has no edge-click DSL).
    function wireClicks(parts, contracts) {
      const root = containerRef.value;
      if (!root) return;

      // Nodes — match Mermaid's flowchart node id pattern: `flowchart-<slug>-<n>`.
      // Build slug→element map for both selection and click wiring.
      nodeMap = {};
      for (const el of root.querySelectorAll('.node')) {
        const m = el.id.match(/-(p_[a-z0-9_]+)-\d+$/);
        if (!m) continue;
        const part = parts.find((p) => slug(p.name) === m[1]);
        if (!part) continue;
        nodeMap[m[1]] = el;
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          router.push(`/parts/${encodeURIComponent(part.name)}`);
        });
      }

      // Edges — Mermaid renders edges in source order, both as <path class="flowchart-link">
      // (or `.edgePath`) and as <g class="edgeLabel">. We iterate by source-order index
      // and bind both to the corresponding contract id. The label is the friendlier
      // click target; the path is a thin hit area but useful as a fallback.
      edgePathEls = Array.from(root.querySelectorAll('.edgePaths .edgePath, g.edgePath'));
      edgeLabelEls = Array.from(root.querySelectorAll('.edgeLabels .edgeLabel, g.edgeLabel'));
      contracts.forEach((c, i) => {
        const handler = () =>
          router.push(`/contracts/${encodeURIComponent(c.contract_id)}`);
        const ep = edgePathEls[i];
        if (ep) {
          ep.classList.add('edge-clickable');
          ep.addEventListener('click', handler);
        }
        const el = edgeLabelEls[i];
        if (el) {
          el.classList.add('edge-label-clickable');
          el.addEventListener('click', handler);
        }
      });
    }

    async function render() {
      status.value = 'loading';
      error.value = null;
      try {
        const [parts, contracts] = await Promise.all([
          api.fetchAll(api.listParts),
          api.fetchAll(api.listContracts),
        ]);
        counts.value = { parts: parts.length, contracts: contracts.length };

        if (parts.length === 0) {
          status.value = 'empty';
          return;
        }

        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            background: '#0e0f11',
            primaryColor: '#1e2026',
            primaryTextColor: '#e2e4ea',
            primaryBorderColor: '#363a44',
            secondaryColor: '#16181c',
            tertiaryColor: '#16181c',
            lineColor: '#555b6a',
            edgeLabelBackground: '#16181c',
            fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
            fontSize: '11px',
          },
          // We bind clicks ourselves post-render — no need for 'loose'.
          securityLevel: 'strict',
          flowchart: {
            // useMaxWidth: false renders the SVG at its intrinsic dimensions
            // and lets the surrounding .graph-stage scroll if it overflows.
            // useMaxWidth: true caused the entire graph to re-scale (nodes
            // visibly moving) on any container width change — even subtle
            // ones from sibling-pane layout shifts (mimiron#14).
            useMaxWidth: false,
            htmlLabels: true,
            padding: 20,
            nodeSpacing: 50,
            rankSpacing: 80,
            curve: 'basis',
          },
        });

        const source = buildSource(parts, contracts);
        const { svg } = await mermaid.render('mimiron-graph', source);
        containerRef.value.innerHTML = svg;

        partList = parts;
        contractList = contracts;
        wireClicks(parts, contracts);
        applySelection();
        applyDimming();

        status.value = 'ready';
      } catch (e) {
        error.value = e;
        status.value = 'error';
      }
    }

    onMounted(render);
    watch(retryNonce, render);

    return { status, error, counts, containerRef };
  },
  template: /* html */ `
    <section class="pane graph-pane" aria-label="architecture graph">
      <div class="graph-stage">
        <div v-if="status === 'loading'" class="graph-loading">loading graph…</div>
        <div v-else-if="status === 'empty'" class="graph-empty">no parts registered</div>
        <div v-else-if="status === 'error'" class="graph-error">
          <div class="graph-error-status">graph load failed</div>
          <div class="graph-error-detail">{{ error.detail || error.message }}</div>
        </div>
        <div ref="containerRef" v-show="status === 'ready'" class="graph-container"></div>
      </div>
      <div class="graph-legend">
        <span class="legend-item"><span class="legend-swatch swatch-node"></span>{{ counts.parts }} parts</span>
        <span class="legend-item"><span class="legend-swatch swatch-edge"></span>{{ counts.contracts }} contracts</span>
        <span class="legend-spacer"></span>
        <span class="legend-hint">click a node or edge label to inspect</span>
      </div>
    </section>
  `,
};
