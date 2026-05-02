import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import mermaid from 'mermaid';
import * as api from '../api.js';

// Mermaid `click ID call fn(arg)` resolves `fn` against `window`. We keep
// the registration scoped to the component lifetime — set in onMounted,
// cleared in onUnmounted — to avoid leaking globals between view mounts.
const NAV_FN = '__mimironGraphNav';

// Mermaid IDs must be alphanumeric/underscore. Software names are slug-shaped
// (lowercase a-z, digits, hyphens) — replace hyphens with underscores and
// prefix to guarantee an alpha leading char.
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
    const status = ref('loading');
    const error = ref(null);
    const counts = ref({ software: 0, contracts: 0 });
    const containerRef = ref(null);

    async function render() {
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
          theme: 'dark',
          // 'loose' enables the `click ID call fn()` callback syntax.
          // Software names are slug-validated server-side (titan-tyr enforces
          // ^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$), so node labels are safe.
          securityLevel: 'loose',
          flowchart: { useMaxWidth: true, htmlLabels: true, padding: 16 },
        });

        const source = buildSource(software, contracts);
        const { svg } = await mermaid.render('mimiron-graph', source);
        containerRef.value.innerHTML = svg;
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

    return { status, error, counts, containerRef };
  },
  template: /* html */ `
    <div class="detail-content">
      <div class="detail-topbar">
        <div class="topbar-row">
          <span class="type-badge type-graph">graph</span>
          <span class="topbar-name">all software · all contracts</span>
        </div>
        <div class="topbar-row chips">
          <span class="version-chip">{{ counts.software }} nodes</span>
          <span class="version-chip">{{ counts.contracts }} edges</span>
        </div>
      </div>
      <div v-if="status === 'loading'" class="detail-loading">Loading graph…</div>
      <div v-else-if="status === 'empty'" class="detail-empty-inline">no software registered</div>
      <div v-else-if="status === 'error'" class="detail-error">
        <div class="detail-error-status">graph load failed</div>
        <div class="detail-error-detail">{{ error.detail || error.message }}</div>
      </div>
      <div ref="containerRef" v-show="status === 'ready'" class="graph-container"></div>
    </div>
  `,
};
