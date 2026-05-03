import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
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
    // Focus = click-driven view filter. null = full graph; otherwise we hide
    // every node/edge that isn't part of the focused subgraph. Set on graph
    // click, cleared by the legend link, ESC, or empty-background click.
    // The route watcher below keeps focus following the route — landing on a
    // node outside the current subgraph re-focuses around the new node so the
    // walk-the-graph use-case keeps working even after a catalog/header nav.
    const focus = ref(null);   // null | { kind: 'node'|'edge', id: string }
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

    // Compute the subgraph that should remain visible for the current focus.
    // Node focus: the node itself + every node one hop away + every edge that
    // touches it. Edge focus: just the two endpoints + that single edge.
    function computeSubgraph(f) {
      if (!f) return null;
      const visibleNodes = new Set();
      const visibleContracts = new Set();   // by contractList index
      if (f.kind === 'node') {
        visibleNodes.add(f.id);
        contractList.forEach((c, i) => {
          const o = slug(c.owner);
          const cp = slug(c.counterparty);
          if (o === f.id || cp === f.id) {
            visibleNodes.add(o);
            visibleNodes.add(cp);
            visibleContracts.add(i);
          }
        });
      } else if (f.kind === 'edge') {
        contractList.forEach((c, i) => {
          if (c.contract_id === f.id) {
            visibleNodes.add(slug(c.owner));
            visibleNodes.add(slug(c.counterparty));
            visibleContracts.add(i);
          }
        });
      }
      return { visibleNodes, visibleContracts };
    }

    function applyFocus() {
      const sub = computeSubgraph(focus.value);
      if (!sub) {
        for (const el of Object.values(nodeMap)) el.classList.remove('node-hidden');
        for (const el of edgePathEls) el?.classList.remove('edge-hidden');
        for (const el of edgeLabelEls) el?.classList.remove('edge-hidden');
        return;
      }
      for (const [s, el] of Object.entries(nodeMap)) {
        el.classList.toggle('node-hidden', !sub.visibleNodes.has(s));
      }
      edgePathEls.forEach((el, i) =>
        el?.classList.toggle('edge-hidden', !sub.visibleContracts.has(i))
      );
      edgeLabelEls.forEach((el, i) =>
        el?.classList.toggle('edge-hidden', !sub.visibleContracts.has(i))
      );
    }
    watch(focus, applyFocus);

    // Keep focus following the route. The graph click handlers set focus
    // *before* calling router.push, so the immediately-following watcher
    // tick is a no-op on those (the new route's entity is the focus center).
    // The watcher matters for navigations that DIDN'T originate in the
    // graph — catalog row, header search, browser back, contract row in
    // PartDetail, etc. While focus is active, those navs re-focus the graph
    // around the new entity so the walk-the-graph mental model holds. With
    // no focus active, the watcher is inert.
    watch(
      () => [route.name, route.params.name, route.params.id],
      ([name, partName, contractId]) => {
        if (!focus.value) return;
        if (name === 'part' && partName) {
          focus.value = { kind: 'node', id: slug(partName) };
        } else if (name === 'contract' && contractId) {
          focus.value = { kind: 'edge', id: contractId };
        } else if (name === 'home') {
          focus.value = null;
        }
      }
    );

    // Clear-focus is a full reset: drop the focus filter AND deselect the
    // current route. The user reads "clear focus" as "show me everything
    // again" — leaving the markdown body + .node-selected highlight up
    // would be a half-clear. Route push to '/' fires the route watcher,
    // which clears focus.value (idempotent — we already nulled it here),
    // and updates `selected` (computed from route) so applySelection
    // removes the highlight.
    function clearFocus() {
      focus.value = null;
      if (route.name !== 'home') router.push('/');
    }

    // ESC clears focus (when focus is active). Window-level so it works
    // regardless of where focus is in the page — the graph filter is a
    // viewport mode, not a focused-input.
    function onKeydown(e) {
      if (e.key === 'Escape' && focus.value) clearFocus();
    }
    onMounted(() => window.addEventListener('keydown', onKeydown));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

    // Click on the graph background (anywhere that isn't a node or edge)
    // clears focus. Node/edge handlers stopPropagation to keep their click
    // from also triggering this clear.
    function onContainerClick(e) {
      if (!focus.value) return;
      if (e.target.closest('.node, .edgePath, g.edgePath, .edgeLabel, g.edgeLabel')) return;
      clearFocus();
    }

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
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          focus.value = { kind: 'node', id: slug(part.name) };
          router.push(`/parts/${encodeURIComponent(part.name)}`);
        });
      }

      // Edges — Mermaid renders edges in source order, with each edge as a
      // direct child of `.edgePaths` (the path) and `.edgeLabels` (the label
      // group). The path's class set varies across Mermaid versions
      // (`.flowchart-link`, `.edge-thickness-normal`, `LS-…`/`LE-…`) and
      // notably does NOT include `.edgePath` in 11.x — so we match by parent
      // (`.edgePaths > *`) instead, which is stable across versions. Labels
      // similarly are direct children of `.edgeLabels`. We iterate in
      // source-order index and bind both to the corresponding contract id.
      edgePathEls = Array.from(root.querySelectorAll('.edgePaths > *'));
      edgeLabelEls = Array.from(root.querySelectorAll('.edgeLabels > *'));
      contracts.forEach((c, i) => {
        const handler = (e) => {
          e.stopPropagation();
          focus.value = { kind: 'edge', id: c.contract_id };
          router.push(`/contracts/${encodeURIComponent(c.contract_id)}`);
        };
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
        applyFocus();

        status.value = 'ready';
      } catch (e) {
        error.value = e;
        status.value = 'error';
      }
    }

    onMounted(render);
    watch(retryNonce, render);

    return { status, error, counts, containerRef, focus, clearFocus, onContainerClick };
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
        <div
          ref="containerRef"
          v-show="status === 'ready'"
          class="graph-container"
          @click="onContainerClick"
        ></div>
      </div>
      <div class="graph-legend">
        <span class="legend-item"><span class="legend-swatch swatch-node"></span>{{ counts.parts }} parts</span>
        <span class="legend-item"><span class="legend-swatch swatch-edge"></span>{{ counts.contracts }} contracts</span>
        <span class="legend-spacer"></span>
        <button v-if="focus" type="button" class="legend-link" @click="clearFocus" title="ESC, or click empty graph background">clear focus</button>
        <span v-else class="legend-hint">click a node or edge label to focus</span>
      </div>
    </section>
  `,
};
