import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import mermaid from 'mermaid';
import * as api from '../api.js';
import { retryNonce } from '../store.js';

// Mermaid `click ID call fn(arg)` resolves `fn` against `window`. Scoped to
// this component's lifetime — set in onMounted, cleared in onUnmounted.
const NAV_FN = '__mimironGraphNav';

// Mermaid IDs must be alphanumeric/underscore. Software names are slug-shaped
// — replace hyphens with underscores and prefix to guarantee an alpha leading char.
const slug = (name) => 's_' + name.replace(/-/g, '_');

function buildSource(software, contracts) {
  const lines = ['graph LR'];
  for (const sw of software) {
    lines.push(`  ${slug(sw.name)}["${sw.name}"]`);
    lines.push(`  click ${slug(sw.name)} call ${NAV_FN}("${sw.name}")`);
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
    const counts = ref({ software: 0, contracts: 0 });
    const containerRef = ref(null);
    let nodeMap = {};

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
      if (route.name === 'software') return [slug(route.params.name)];
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

    async function render() {
      status.value = 'loading';
      error.value = null;
      try {
        const [software, contracts] = await Promise.all([
          api.fetchAll(api.listSoftware),
          api.fetchAll(api.listContracts),
        ]);
        counts.value = { software: software.length, contracts: contracts.length };

        if (software.length === 0) {
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
          // 'loose' enables the `click ID call fn()` callback syntax. Software
          // names are slug-validated server-side, so node labels are safe.
          securityLevel: 'loose',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            padding: 20,
            nodeSpacing: 50,
            rankSpacing: 80,
            curve: 'basis',
          },
        });

        const source = buildSource(software, contracts);
        const { svg } = await mermaid.render('mimiron-graph', source);
        containerRef.value.innerHTML = svg;

        nodeMap = {};
        const nodeEls = containerRef.value.querySelectorAll('.node');
        for (const el of nodeEls) {
          const m = el.id.match(/-(s_[a-z0-9_]+)-\d+$/);
          if (m) nodeMap[m[1]] = el;
        }
        applySelection();

        status.value = 'ready';
      } catch (e) {
        error.value = e;
        status.value = 'error';
      }
    }

    onMounted(() => {
      window[NAV_FN] = (name) =>
        router.push(`/software/${encodeURIComponent(name)}`);
      render();
    });

    onUnmounted(() => {
      delete window[NAV_FN];
    });

    watch(retryNonce, render);

    return { status, error, counts, containerRef };
  },
  template: /* html */ `
    <section class="pane graph-pane" aria-label="architecture graph">
      <div class="graph-stage">
        <div v-if="status === 'loading'" class="graph-loading">loading graph…</div>
        <div v-else-if="status === 'empty'" class="graph-empty">no software registered</div>
        <div v-else-if="status === 'error'" class="graph-error">
          <div class="graph-error-status">graph load failed</div>
          <div class="graph-error-detail">{{ error.detail || error.message }}</div>
        </div>
        <div ref="containerRef" v-show="status === 'ready'" class="graph-container"></div>
      </div>
      <div class="graph-legend">
        <span class="legend-item"><span class="legend-swatch swatch-node"></span>{{ counts.software }} software</span>
        <span class="legend-item"><span class="legend-swatch swatch-edge"></span>{{ counts.contracts }} contracts</span>
        <span class="legend-spacer"></span>
        <span class="legend-hint">click a node to inspect</span>
      </div>
    </section>
  `,
};
