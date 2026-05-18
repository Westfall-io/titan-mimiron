import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import cytoscape from 'cytoscape';
import dagre from 'dagre';
import * as api from '../api.js';
import { retryNonce, search, project } from '../store.js';

// Lifecycle tier ranks: K8s runtime objects at the top of a TB layout (or
// left in LR), then compose / build tier, then image, then software at the
// bottom/right. Edges in the catalog flow inconsistently across these tiers
// (software→image builds-from, image→container instantiates, container→
// software runs, container→compose member-of, service→deployment selects,
// ingress→service routes-to), so the natural dagre ranking by edge
// direction produces visually scrambled tiers. Pinning the rank per node
// forces the canonical lifecycle reading order in both LR and TB.
//
// Negative-extension scheme (per archaedas#9 lock-in): K8s subtypes occupy
// negative tiers so the existing compose/build/image/software positions
// don't shift in the graph users already read.
const TIER = {
  // K8s runtime (M-A / archaedas#9)
  ingress:     -2,
  service:     -1,
  deployment:   0,
  statefulset:  0,
  job:          0,
  // Existing compose/build/image/software (unchanged)
  compose: 0,
  pod: 1,
  container: 1,
  image: 2,
  software: 3,
};

// Same id mangling carried from the Mermaid era so the route → graph-node
// mapping stays consistent. Cytoscape doesn't actually need the prefix — any
// string is a valid id — but keeping it lets the focus / selection wiring
// translate without renaming anything in the route layer.
const slug = (name) => 'p_' + name.replace(/-/g, '_');

// Per-part-subtype color: matches the catalog chip palette so the same part
// reads the same in both panes. Cytoscape canvas styling can't pull from
// CSS variables, so the values are duplicated here.
const SUBTYPE_COLOR = {
  // Existing (build/compose tier)
  software:    '#5b8def',
  container:   '#e08a3d',
  image:       '#a07ce5',
  pod:         '#3dc18a',
  compose:     '#d65a8e',
  // K8s runtime (M-A / archaedas#9)
  deployment:  '#4ecdc4',  // teal
  statefulset: '#26a69a',  // deep teal (close cousin to deployment)
  job:         '#ffd166',  // amber
  service:     '#118ab2',  // mid-blue
  ingress:     '#06d6a0',  // mint
  secret:      '#ef476f',  // red — signals "handle with care"
  configmap:   '#9b8eb5',  // muted lavender
};

// Tab ids are stable (used as localStorage keys); labels can shift without
// resetting user state. The 'devops' id was kept after the 'DevOps' →
// 'Runtime' rename in M-B (archaedas#9) so existing localStorage values
// keep resolving.
const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'software', label: 'Software' },
  { id: 'devops', label: 'Runtime' },
];

// Software is parts-driven (every contract between software parts shows up,
// regardless of subtype/connection_type); Runtime is edge-driven (binding +
// connection contracts pull in their endpoints so cross-stage edges still
// render). The Runtime view unions compose and K8s subtypes since
// WatcherVault is the coexistence case — one project, two runtime layers.
const VIEW_FILTERS = {
  software: { mode: 'parts', parts: new Set(['software']) },
  devops: {
    mode: 'edge',
    parts: new Set([
      // Compose / build (existing)
      'container', 'image', 'pod', 'compose',
      // K8s runtime (M-B / archaedas#9)
      'deployment', 'statefulset', 'job',
      'service', 'ingress',
      'secret', 'configmap',
    ]),
    contracts: new Set(['binding', 'connection']),
  },
};

function filterForView(view, allParts, allContracts) {
  if (view === 'all') return { parts: allParts, contracts: allContracts };
  const f = VIEW_FILTERS[view];
  if (!f) return { parts: allParts, contracts: allContracts };
  if (f.mode === 'parts') {
    const parts = allParts.filter((p) => f.parts.has(p.subtype));
    const kept = new Set(parts.map((p) => p.name));
    const contracts = allContracts.filter((c) => kept.has(c.owner) && kept.has(c.counterparty));
    return { parts, contracts };
  }
  const contracts = allContracts.filter((c) => f.contracts.has(c.subtype));
  const endpoints = new Set();
  for (const c of contracts) {
    endpoints.add(c.owner);
    endpoints.add(c.counterparty);
  }
  const parts = allParts.filter((p) => f.parts.has(p.subtype) || endpoints.has(p.name));
  return { parts, contracts };
}

const VIEW_LS_KEY = 'mimiron.graph.view';
function loadView() {
  try {
    const v = localStorage.getItem(VIEW_LS_KEY);
    return VIEWS.some((t) => t.id === v) ? v : 'all';
  } catch {
    return 'all';
  }
}
function saveView(v) {
  try { localStorage.setItem(VIEW_LS_KEY, v); } catch { /* storage disabled */ }
}

const ORIENT_LS_KEY = 'mimiron.graph.orientation';
function loadOrientation() {
  try {
    const v = localStorage.getItem(ORIENT_LS_KEY);
    return v === 'TB' ? 'TB' : 'LR';
  } catch {
    return 'LR';
  }
}
function saveOrientation(v) {
  try { localStorage.setItem(ORIENT_LS_KEY, v); } catch { /* storage disabled */ }
}

// Drive dagre directly so we can pin per-node tier ranks. dagre v0.8's
// `rank` field on a node doesn't actually constrain ranking (it's the
// algorithm's *output*, not its input); the canonical way to constrain
// ranks is the Sugiyama "anchor chain" trick:
//
//   1. Add one zero-size anchor node per tier (compose → … → software),
//      chained anchor[t] → anchor[t+1] with minlen=1 and high weight.
//      This forces dagre to allocate ranks 0..N for the tiers in order.
//   2. Sandwich each real node between its tier's anchor and the next:
//      anchor[T] → node (minlen=0) and node → anchor[T+1] (minlen=1),
//      both with high weight. The first says "rank ≥ T", the second
//      "rank ≤ T", so the node lands exactly on rank T.
//   3. Real edges go in with low weight + minlen=0 — they only influence
//      within-tier ordering (cross-minimization), not tier assignment.
//
// dagre's cycle-removal step honors edge weight, so the heavy pin edges
// keep their direction and any conflicting real edge gets reversed for
// layout (we don't care about the layout-side direction; cytoscape draws
// the edge from the real owner → counterparty regardless).
function computeDagrePositions(parts, contracts, orientation) {
  const g = new dagre.graphlib.Graph();
  // Use BT/RL under the hood so tier 0 (compose) lands at the *far* end of
  // the canvas (bottom in TB-toggle, right in LR-toggle) and software
  // (tier 3) sits where the user starts reading. The toggle button label
  // (TB/LR) reflects the conceptual orientation; the physical flip stays
  // an implementation detail of dagre's anchor-chain direction.
  g.setGraph({
    rankdir: orientation === 'TB' ? 'BT' : 'RL',
    nodesep: 60,
    ranksep: 110,
    edgesep: 20,
    ranker: 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Anchor chain — one dummy node per tier, plus a sentinel beyond the
  // last so every real node has an "upper bound" anchor to point at.
  const NUM_TIERS = 4;
  const anchors = [];
  for (let i = 0; i <= NUM_TIERS; i++) {
    const id = `__anchor_${i}__`;
    anchors.push(id);
    g.setNode(id, { width: 0.0001, height: 0.0001 });
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    g.setEdge(anchors[i], anchors[i + 1], { minlen: 1, weight: 1000 });
  }

  for (const p of parts) {
    const id = slug(p.name);
    g.setNode(id, { width: 160, height: 44 });
    const tier = TIER[p.subtype];
    if (tier !== undefined) {
      g.setEdge(anchors[tier], id, { minlen: 0, weight: 1000 });
      g.setEdge(id, anchors[tier + 1], { minlen: 1, weight: 1000 });
    }
  }

  for (const c of contracts) {
    g.setEdge(slug(c.owner), slug(c.counterparty), { minlen: 0, weight: 1 });
  }

  dagre.layout(g);

  // Drop the anchor positions; only real nodes go back to cytoscape.
  const positions = {};
  for (const p of parts) {
    const id = slug(p.name);
    const n = g.node(id);
    if (n) positions[id] = { x: n.x, y: n.y };
  }
  return positions;
}

function buildElements(parts, contracts, positions) {
  const elements = [];
  for (const p of parts) {
    const node = {
      group: 'nodes',
      data: { id: slug(p.name), label: p.name, name: p.name, subtype: p.subtype },
      classes: 'subtype-' + p.subtype,
    };
    const pos = positions && positions[slug(p.name)];
    if (pos) node.position = pos;
    elements.push(node);
  }
  contracts.forEach((c, i) => {
    // Edge label carries the contract subtype + connection_type when present.
    // Cytoscape's text-rotation 'autorotate' keeps it readable on diagonal edges.
    const ctype = c.connection_type ? `${c.subtype}/${c.connection_type}` : c.subtype;
    const classes = ['edge-' + c.subtype];
    if (c.connection_type) classes.push('ct-' + c.connection_type);
    elements.push({
      group: 'edges',
      data: {
        id: 'e_' + c.contract_id,
        source: slug(c.owner),
        target: slug(c.counterparty),
        label: `${ctype} v${c.version}`,
        subtype: c.subtype,
        connectionType: c.connection_type || '',
        contractId: c.contract_id,
        index: i,
      },
      classes: classes.join(' '),
    });
  });
  return elements;
}

// Cytoscape stylesheet. Selectors compose, so e.g. `edge.edge-binding` extends
// the base `edge` rules with thicker width. Selection / focus / dimming each
// have a class flipped on/off via the apply* helpers below.
const CY_STYLE = [
  // Nodes — base
  { selector: 'node', style: {
    'background-color': '#1e2026',
    'border-color': '#363a44',
    'border-width': 1,
    'shape': 'round-rectangle',
    'label': 'data(label)',
    'color': '#e2e4ea',
    'text-valign': 'center',
    'text-halign': 'center',
    'font-family': 'IBM Plex Mono, ui-monospace, monospace',
    'font-size': 11,
    'padding': '14px',
    'width': 'label',
    'height': 'label',
    'text-wrap': 'wrap',
  }},
  // Per-subtype border tint (the catalog chip palette).
  { selector: 'node.subtype-software', style: { 'border-color': SUBTYPE_COLOR.software, 'border-width': 2 }},
  { selector: 'node.subtype-container', style: { 'border-color': SUBTYPE_COLOR.container, 'border-width': 2 }},
  { selector: 'node.subtype-image', style: { 'border-color': SUBTYPE_COLOR.image, 'border-width': 2 }},
  { selector: 'node.subtype-pod', style: { 'border-color': SUBTYPE_COLOR.pod, 'border-width': 2 }},
  { selector: 'node.subtype-compose', style: { 'border-color': SUBTYPE_COLOR.compose, 'border-width': 2 }},
  { selector: 'node.subtype-deployment', style: { 'border-color': SUBTYPE_COLOR.deployment, 'border-width': 2 }},
  { selector: 'node.subtype-statefulset', style: { 'border-color': SUBTYPE_COLOR.statefulset, 'border-width': 2 }},
  { selector: 'node.subtype-job', style: { 'border-color': SUBTYPE_COLOR.job, 'border-width': 2 }},
  { selector: 'node.subtype-service', style: { 'border-color': SUBTYPE_COLOR.service, 'border-width': 2 }},
  { selector: 'node.subtype-ingress', style: { 'border-color': SUBTYPE_COLOR.ingress, 'border-width': 2 }},
  { selector: 'node.subtype-secret', style: { 'border-color': SUBTYPE_COLOR.secret, 'border-width': 2 }},
  { selector: 'node.subtype-configmap', style: { 'border-color': SUBTYPE_COLOR.configmap, 'border-width': 2 }},
  // Selection (route says "you're on this part") — gold outline. !important via
  // higher specificity, since selected wins over focus / dim / subtype tint.
  { selector: 'node.selected', style: {
    'border-color': '#f0b400',
    'border-width': 3,
  }},
  { selector: 'node.dim', style: { 'opacity': 0.25 }},
  { selector: 'node.hidden', style: { 'display': 'none' }},

  // Edges — base
  { selector: 'edge', style: {
    'curve-style': 'bezier',
    'target-arrow-shape': 'triangle',
    'arrow-scale': 0.8,
    'line-color': '#555b6a',
    'target-arrow-color': '#555b6a',
    'width': 1.4,
    'label': 'data(label)',
    'color': '#9aa0ac',
    'font-family': 'IBM Plex Mono, ui-monospace, monospace',
    'font-size': 9,
    'text-rotation': 'autorotate',
    'text-margin-y': -8,
    // Solid background pill behind each edge label so it stays readable
    // when an edge crosses other edges or nodes.
    'text-background-color': '#0e0f11',
    'text-background-opacity': 1,
    'text-background-padding': 2,
  }},
  { selector: 'edge.edge-binding', style: { 'width': 2.6 }},
  { selector: 'edge.edge-connection', style: { 'line-style': 'dashed' }},
  { selector: 'edge.selected', style: {
    'line-color': '#f0b400',
    'target-arrow-color': '#f0b400',
    'width': 3,
  }},
  { selector: 'edge.dim', style: { 'opacity': 0.2 }},
  { selector: 'edge.hidden', style: { 'display': 'none' }},
];

export default {
  setup() {
    const router = useRouter();
    const route = useRoute();
    const status = ref('loading');
    const error = ref(null);
    const counts = ref({ parts: 0, contracts: 0, bySubtype: { interaction: 0, binding: 0, connection: 0 } });
    const containerRef = ref(null);
    // Focus = click-driven view filter. null = full graph; otherwise we hide
    // every node/edge that isn't part of the focused subgraph. Same shape as
    // the Mermaid build so the route watcher logic translates 1:1.
    const focus = ref(null);   // null | { kind: 'node'|'edge', id: string }
    const view = ref(loadView());
    const orientation = ref(loadOrientation());

    let cy = null;
    // partList / contractList hold the *currently rendered* (filtered) sets.
    // search dimming + focus subgraph computation index into them.
    let partList = [];
    let contractList = [];
    let allParts = [];
    let allContracts = [];

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
      if (!cy) return;
      const set = new Set(selected.value);
      cy.batch(() => {
        cy.nodes().forEach((n) => n.toggleClass('selected', set.has(n.id())));
        // For contract routes, also outline the matching edge.
        if (route.name === 'contract' && route.params.id) {
          cy.edges().forEach((e) =>
            e.toggleClass('selected', e.data('contractId') === route.params.id)
          );
        } else {
          cy.edges().removeClass('selected');
        }
      });
    }
    watch(selected, applySelection);

    // Compute the subgraph that should remain visible for the current focus.
    // Same shape as the Mermaid build; we substitute cy element ids for the
    // DOM-class side effects. Node focus pulls every neighbour edge + its
    // far endpoint; edge focus pulls just the two endpoints + the edge.
    function computeSubgraph(f) {
      if (!f) return null;
      const visibleNodes = new Set();
      const visibleContracts = new Set();   // by contract_id
      if (f.kind === 'node') {
        visibleNodes.add(f.id);
        contractList.forEach((c) => {
          const o = slug(c.owner);
          const cp = slug(c.counterparty);
          if (o === f.id || cp === f.id) {
            visibleNodes.add(o);
            visibleNodes.add(cp);
            visibleContracts.add(c.contract_id);
          }
        });
      } else if (f.kind === 'edge') {
        contractList.forEach((c) => {
          if (c.contract_id === f.id) {
            visibleNodes.add(slug(c.owner));
            visibleNodes.add(slug(c.counterparty));
            visibleContracts.add(c.contract_id);
          }
        });
      }
      return { visibleNodes, visibleContracts };
    }

    function applyFocus() {
      if (!cy) return;
      const sub = computeSubgraph(focus.value);
      cy.batch(() => {
        if (!sub) {
          cy.elements().removeClass('hidden');
          return;
        }
        cy.nodes().forEach((n) => n.toggleClass('hidden', !sub.visibleNodes.has(n.id())));
        cy.edges().forEach((e) =>
          e.toggleClass('hidden', !sub.visibleContracts.has(e.data('contractId')))
        );
      });
    }
    watch(focus, applyFocus);

    // Keep focus following the route. The graph click handlers set focus
    // *before* calling router.push, so the immediately-following watcher
    // tick is a no-op on those (the new route's entity is the focus center).
    // The watcher matters for navigations that DIDN'T originate in the
    // graph — catalog row, header search, browser back, contract row in
    // PartDetail, etc.
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

    function clearFocus() {
      focus.value = null;
      if (route.name !== 'home') router.push('/');
    }

    function onKeydown(e) {
      if (e.key === 'Escape' && focus.value) clearFocus();
    }
    onMounted(() => window.addEventListener('keydown', onKeydown));
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      if (cy) { cy.destroy(); cy = null; }
    });

    // Search-dimming: nodes whose name/aliases don't substring-match the
    // current search drop to low opacity; edges where neither endpoint
    // matches dim too. Same rule as the catalog's `?match=`.
    function applyDimming() {
      if (!cy) return;
      const q = (search.value || '').trim().toLowerCase();
      cy.batch(() => {
        if (!q) {
          cy.elements().removeClass('dim');
          return;
        }
        const matchingSlugs = new Set();
        for (const p of partList) {
          const hay = [p.name, ...(p.aliases || [])].map((s) => s.toLowerCase());
          if (hay.some((h) => h.includes(q))) matchingSlugs.add(slug(p.name));
        }
        cy.nodes().forEach((n) => n.toggleClass('dim', !matchingSlugs.has(n.id())));
        cy.edges().forEach((e) => {
          const dim = !matchingSlugs.has(e.source().id()) && !matchingSlugs.has(e.target().id());
          e.toggleClass('dim', dim);
        });
      });
    }
    watch(search, applyDimming);

    async function render() {
      status.value = 'loading';
      error.value = null;
      try {
        if (allParts.length === 0) {
          // Server-side `?project=` filter mirrors the catalog pane so both
          // surfaces show the same scoped subset.
          const opts = project.value ? { project: project.value } : {};
          const [p, c] = await Promise.all([
            api.fetchAll(api.listParts, opts),
            api.fetchAll(api.listContracts, opts),
          ]);
          allParts = p;
          allContracts = c;
        }

        const { parts, contracts } = filterForView(view.value, allParts, allContracts);
        const bySubtype = { interaction: 0, binding: 0, connection: 0 };
        for (const c of contracts) if (c.subtype in bySubtype) bySubtype[c.subtype]++;
        counts.value = { parts: parts.length, contracts: contracts.length, bySubtype };

        if (allParts.length === 0) {
          status.value = 'empty';
          return;
        }
        if (parts.length === 0) {
          status.value = 'empty-view';
          return;
        }

        partList = parts;
        contractList = contracts;

        // Show the container BEFORE creating cy, otherwise the v-show:none
        // means cytoscape sees a 0×0 box and the layout never settles.
        status.value = 'ready';
        // Wait one tick for v-show=true to apply.
        await new Promise((r) => requestAnimationFrame(r));

        if (cy) { cy.destroy(); cy = null; }
        // Compute positions via dagre with per-node rank constraints, then
        // hand cytoscape a preset layout so the canonical tier order is
        // honored regardless of edge direction.
        const positions = computeDagrePositions(parts, contracts, orientation.value);
        cy = cytoscape({
          container: containerRef.value,
          elements: buildElements(parts, contracts, positions),
          style: CY_STYLE,
          layout: { name: 'preset', fit: true, padding: 30 },
          wheelSensitivity: 0.2,
          autoungrabify: true,
          minZoom: 0.3,
          maxZoom: 2.5,
        });

        cy.on('tap', 'node', (e) => {
          const node = e.target;
          focus.value = { kind: 'node', id: node.id() };
          router.push(`/parts/${encodeURIComponent(node.data('name'))}`);
        });
        cy.on('tap', 'edge', (e) => {
          const edge = e.target;
          focus.value = { kind: 'edge', id: edge.data('contractId') };
          router.push(`/contracts/${encodeURIComponent(edge.data('contractId'))}`);
        });
        cy.on('tap', (e) => {
          // Tap on the canvas background (target === cy) clears focus.
          if (e.target === cy && focus.value) clearFocus();
        });

        applySelection();
        applyDimming();
        applyFocus();
      } catch (e) {
        error.value = e;
        status.value = 'error';
      }
    }

    onMounted(render);
    watch(retryNonce, () => { allParts = []; allContracts = []; render(); });
    watch(project, () => { allParts = []; allContracts = []; focus.value = null; render(); });
    watch(view, () => {
      saveView(view.value);
      focus.value = null;
      render();
    });
    watch(orientation, () => {
      saveOrientation(orientation.value);
      render();
    });

    function setView(id) { view.value = id; }
    function toggleOrientation() {
      orientation.value = orientation.value === 'LR' ? 'TB' : 'LR';
    }

    return {
      status, error, counts, containerRef, focus, clearFocus,
      view, views: VIEWS, setView, orientation, toggleOrientation,
    };
  },
  template: /* html */ `
    <section class="pane graph-pane" aria-label="architecture graph">
      <div class="graph-tabs" role="tablist" aria-label="graph view">
        <button
          v-for="t in views"
          :key="t.id"
          type="button"
          role="tab"
          :aria-selected="view === t.id"
          class="graph-tab"
          :class="{ active: view === t.id }"
          @click="setView(t.id)"
        >{{ t.label }}</button>
        <span class="graph-tabs-spacer"></span>
        <button
          type="button"
          class="graph-orient-toggle"
          :title="'switch to ' + (orientation === 'LR' ? 'top-to-bottom' : 'left-to-right') + ' layout'"
          @click="toggleOrientation"
        >{{ orientation }}</button>
      </div>
      <div class="graph-stage">
        <div v-if="status === 'loading'" class="graph-loading">loading graph…</div>
        <div v-else-if="status === 'empty'" class="graph-empty">no parts registered</div>
        <div v-else-if="status === 'empty-view'" class="graph-empty">no parts in this view — switch tabs or register parts of the matching subtype</div>
        <div v-else-if="status === 'error'" class="graph-error">
          <div class="graph-error-status">graph load failed</div>
          <div class="graph-error-detail">{{ error.detail || error.message }}</div>
        </div>
        <div
          ref="containerRef"
          v-show="status === 'ready'"
          class="graph-container"
        ></div>
      </div>
      <div class="graph-legend">
        <span class="legend-item"><span class="legend-swatch swatch-node"></span>{{ counts.parts }} parts</span>
        <span class="legend-item" title="interaction (request/response)"><span class="legend-swatch swatch-edge edge-interaction"></span>▷ {{ counts.bySubtype.interaction }}</span>
        <span class="legend-item" title="binding (structural composition)"><span class="legend-swatch swatch-edge edge-binding"></span>▣ {{ counts.bySubtype.binding }}</span>
        <span class="legend-item" title="connection (runtime link)"><span class="legend-swatch swatch-edge edge-connection"></span>┄ {{ counts.bySubtype.connection }}</span>
        <span class="legend-spacer"></span>
        <button v-if="focus" type="button" class="legend-link" @click="clearFocus" title="ESC, or click empty graph background">clear focus</button>
        <span v-else class="legend-hint">click a node or edge label to focus</span>
      </div>
    </section>
  `,
};
