# titan-mimiron — Developer Brief
## WatcherVault Web UI

**Repository:** titan-mimiron
**Capability:** WatcherVault
**Role:** Frontend — navigable graph visualisation and markdown rendering of architecture contracts

---

## Purpose

titan-mimiron is the human-facing interface to WatcherVault. It allows engineers, architects, and teams to navigate the WatcherVault software architecture by browsing a force-directed graph of architectural elements and reading the raw markdown contract for any selected element in a document panel alongside it.

The UI is a document reader with graph-based navigation. It is not a database viewer, a form renderer, or a dashboard. Every element in the graph — whether a software service, a Docker image, a running container, or an interface contract — has a markdown contract file. Selecting any element loads and renders that file exactly as written. The graph is the navigation mechanism; the markdown document is the content.

---

## Architectural Context

titan-mimiron consumes data exclusively from titan-tyr (the WatcherVault REST API). It has no direct access to the titan-norganon Git repository. All contract files, index data, version information, and commit history are fetched from titan-tyr at runtime.

```
titan-norganon (Git repo)
        ↓ cloned and served by
titan-tyr (REST API)
        ↓ consumed by
titan-mimiron (Web UI)
```

The titan-tyr base URL must be configurable via environment variable (`TYR_BASE_URL`). The application must function correctly when pointed at any running titan-tyr instance — local development, staging, or production — without code changes.

---

## The WatcherVault Data Model

titan-mimiron must understand the four WatcherVault concepts to render the graph and sidebar correctly.

**Part** — a structural element with a defined boundary. Everything in the architecture is a Part. Subtypes: SoftwarePart (a git repository), ImagePart (a Docker image), ContainerPart (a running container), ComposePart (a docker-compose stack), PodPart (a Kubernetes pod). Part contracts are knowledge documents — they describe what something is.

**Port** — an interaction point on the surface of a Part. Ports are described within Part contracts rather than as separate files. They have a direction (`in` or `out`) and reference an Interface.

**Interface** — something that flows across a Port. Two subtypes: Interaction Interface (data and schema flowing between two SoftwareParts, environment-agnostic) and Binding Interface (address components flowing from a ContainerPart to a SoftwarePart, environment-specific). Interface contracts are binding agreements.

**Connection** — a structural binding between two Parts where nothing flows. Used for build-chain relationships (SoftwarePart → ImagePart → ContainerPart → ComposePart) and git submodule dependencies. Connection contracts are binding agreements.

### Environment Model

The architecture is organised into environments. Switching environment changes which elements appear in the graph:

- `instances/common/` — environment-agnostic (SoftwareParts, ImageParts, Interaction Interfaces — appear in all environments)
- `instances/local/` — local development (ContainerParts, ComposeParts, Binding Interfaces with compose addresses)
- `instances/staging/` — staging environment
- `instances/production/` — production (PodParts, Binding Interfaces with Kubernetes DNS addresses)

---

## Layout

The application is a single page with four regions:

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER — logo, environment switcher, view tabs, search         │
├──────────┬──────────────────────────────────┬───────────────────┤
│          │                                  │                   │
│ SIDEBAR  │        GRAPH CANVAS              │  DETAIL PANEL     │
│          │                                  │                   │
│ nav tree │   Mermaid.js force-directed      │  markdown         │
│ by type  │   graph of architecture          │  document         │
│          │                                  │  reader           │
│          │                                  │                   │
│          ├──────────────────────────────────┤                   │
│          │  LEGEND                          │                   │
└──────────┴──────────────────────────────────┴───────────────────┘
```

**Header** — fixed at the top. Contains the WatcherVault wordmark, an environment dropdown, four view tab buttons (Full Graph, Software, DevOps, Interfaces), and a search input.

**Sidebar** — fixed width (~210px), scrollable, left of the graph. Lists all elements grouped by type in collapsible sections. Each item is a single row: a colour-coded type dot and the element name. Clicking any item selects it, highlights it in the graph, and loads its contract in the detail panel. The active item is indicated with a left-edge accent border.

**Graph canvas** — fills the remaining centre space. Renders the Mermaid diagram. Clicking any node selects that element identically to clicking in the sidebar. Clicking the canvas background deselects.

**Legend** — a small fixed overlay at the bottom of the graph canvas listing node colours by Part type and edge styles by relationship type.

**Detail panel** — fixed width (~380px), right of the graph. Contains a topbar and a scrollable markdown rendering area. When nothing is selected, shows an empty state with a subtle prompt.

---

## Graph Visualisation

The graph is rendered using **Mermaid.js** with `flowchart LR` (left-to-right flowchart). The diagram source is generated dynamically from the API index response — it is never hardcoded.

### Generating the Mermaid Source

The `GET /api/index?env={env}` response returns an array of elements, each with an `id`, `type`, `name`, `layer`, and `connections` array. Build the diagram source by iterating this array:

1. Declare each element as a node: `ID["name\nType"]`
2. Apply a `classDef` for each type (see colour table below)
3. Assign each node its class: `class ID typename`
4. Declare each connection as an edge using the appropriate arrow syntax

Edge syntax by type:
- `interaction-interface`: `A -->|"label"| B` (solid arrow)
- `binding-interface`: `A -->|"label"| B` (solid arrow, different colour via linkStyle)
- `connection`: `A -.->|"label"| B` (dashed arrow)

Wrap nodes in Mermaid `subgraph` blocks by layer — `"Software Layer"` for SoftwareParts, `"DevOps Layer"` for all deployment-level Parts.

### Node Colours

Applied via Mermaid `classDef` and `class` declarations:

| Part type | Fill | Stroke | Label |
|---|---|---|---|
| SoftwarePart | #1a2a4a | #4a9eff | #e2e4ea |
| ImagePart | #2d1f5a | #9b72e8 | #e2e4ea |
| ContainerPart | #0f3535 | #2ec4b6 | #e2e4ea |
| ComposePart | #3d2a00 | #e8a83a | #e2e4ea |
| PodPart | #0f3535 | #2ec4b6 | #e2e4ea |
| ExternalSystem | #1e2026 | #555b6a | #8b909e |

### Graph Views

Four view tabs each generate a different filtered diagram from the same index data:

**Full Graph** — all elements and all edge types, with `subgraph` grouping for Software and DevOps layers.

**Software** — only SoftwareParts and Interaction Interface edges. External systems shown as distinct grey nodes.

**DevOps** — build chain only. SoftwarePart → ImagePart → ContainerPart → ComposePart/PodPart Connection edges plus Binding Interface edges. No Interaction Interface edges.

**Interfaces** — only Interface edges, labelled with type and version. Nodes shown as simplified boxes.

### Making Graph Nodes Clickable

After Mermaid renders the SVG, query all `.node` elements. Extract the node ID from each element's `id` attribute (strip the `flowchart-` prefix and trailing `-N` suffix). Map the cleaned ID to the element's data ID and attach a click event listener that calls the selection function.

---

## Sidebar

Generated from the API index response on load and on environment change. Sections:

- Software Parts
- Image Parts
- Container Parts / Pod Parts
- Compose Parts
- Interfaces → Interaction Interfaces
- Interfaces → Binding Interfaces
- Connections

Each section is collapsible. Collapsed/expanded state persists in `localStorage`. Items within each section are sorted alphabetically by name.

Each item row: `[colour dot] [element name]`

The colour dot is 7px diameter, circular, filled with the type colour (matching the graph node stroke colour for that type).

---

## Detail Panel

### Topbar

A narrow bar at the top of the panel, always visible. Contains:

**File path** — monospaced, muted colour, e.g. `instances/common/interfaces/iface-orders-payments.md`. Truncates with ellipsis if too long.

**Type badge** — a small pill label (e.g. `SoftwarePart`, `Interaction Interface`). Background and text colour match the element type using tinted versions of the type colour.

**Version chips** (shown when an element is selected) — three small monospaced chips:
- Semantic version: `v1.2.0` (from `X-Contract-Version` response header)
- Git SHA: `a1b2c3d4` (first 8 chars of `X-Git-SHA` response header)
- Last modified: relative date e.g. `3 days ago` (from `X-Git-Last-Modified`), full ISO date shown on hover

### Markdown Rendering

The scrollable body of the detail panel renders the raw markdown returned by `GET /api/files/{path}` using **marked.js**.

Markdown element styling:

| Element | Rendering |
|---|---|
| `# Heading` | Large (17px), medium weight, `--text` colour, bottom border in `--border` |
| `## Heading` | Small caps (9px), monospaced, `--text3` colour, bottom border — used for contract section titles |
| `### Heading` | 13px, medium weight, `--text` colour — subsection titles |
| `p` | 12px, `--text2` colour, 1.6 line height |
| `strong` | `--text` colour, weight 500 |
| `table` | Full width, `--border` row borders, `--text3` header row in monospaced 9px, hover highlight in `--bg3` |
| `code` (inline) | `--mono` font, 11px, `--teal` colour, `--bg3` background, `--border` border, 3px radius |
| `pre code` | `--mono` font, 11px, `--text2` colour, `--bg3` background, `--border` border, 12px padding |
| `ul li` | Em dash (`—`) list marker in `--text3`, 12px text |
| `blockquote` | 3px left border in `--amber`, `--bg3` background — used for Open Proposals entries |
| `hr` | 1px `--border` line |
| `a` | `--accent` colour, no underline, underline on hover |

### In-App Link Interception

Attach a click handler to the rendered markdown container. When any `<a>` tag is clicked, inspect the `href`. If the href is a relative path to a contract file (e.g. `../interfaces/iface-orders-payments.md`), resolve it against the current file's path to derive the target element ID, then trigger selection of that element rather than navigating the browser. If the href is an external URL, open in a new tab.

### History Panel

A collapsible section below the markdown body, collapsed by default, triggered by a "Version History" toggle. When expanded, fetches `GET /api/history/{path}` and renders each commit as a row:

- Commit message (13px, `--text`, most prominent)
- Author name (11px, `--text2`)
- Relative date (monospaced, 10px, `--text3`) with full ISO timestamp on hover
- SHA first 8 chars (monospaced, 9px, `--text3`)

---

## Environment Switcher

On load, call `GET /api/environments` to populate the dropdown with available environment names. The currently active environment is shown as the selected option.

On environment change:
1. Re-fetch `GET /api/index?env={newEnv}`
2. Rebuild the sidebar
3. Regenerate the active graph view
4. If the selected element exists in the new model, reload its contract; otherwise deselect
5. Persist the selected environment to `localStorage`

---

## Search

Text input in the header. Debounced 300ms. On input, call `GET /api/search?q={query}&env={env}`.

On results:
- Sidebar items matching the query remain at full opacity; non-matching items dim to 30% opacity
- Graph nodes matching the query remain at full opacity; non-matching nodes dim
- Detail panel is not affected

Clearing the input restores all elements to full opacity.

---

## Empty and Error States

| State | Where | What to show |
|---|---|---|
| Nothing selected | Detail panel body | Centred glyph and text: "select a node or edge" |
| Loading contract | Detail panel body | Topbar populated, body shows a subtle loading indicator |
| Contract not found (404) | Detail panel body | File path and note: "contract not yet written" |
| API unreachable | Graph canvas | Full-width error banner with `TYR_BASE_URL` value and retry button |
| Empty search results | Sidebar | All items dimmed, note below search input: "no matches" |

---

## Design Language

### Colour Variables

```css
--bg: #0e0f11
--bg2: #16181c
--bg3: #1e2026
--border: #2a2d35
--border2: #363a44
--text: #e2e4ea
--text2: #8b909e
--text3: #555b6a
--accent: #4a9eff
--accent2: #1a4a7a
--green: #3dba7a
--amber: #e8a83a
--coral: #e05a4e
--purple: #9b72e8
--teal: #2ec4b6
```

No hardcoded hex values in components. All colours reference CSS variables.

### Typography

- **UI and body text:** IBM Plex Sans — weights 300, 400, 500 (Google Fonts)
- **Monospaced (paths, version chips, code):** IBM Plex Mono — weights 400, 500 (Google Fonts)

### Interaction Patterns

- Hover on interactive elements: border colour shifts to `--accent`
- Active/selected state: `--accent2` background, 2px left border in `--accent`
- Sidebar sections: collapsible with a subtle chevron indicator
- Scrollbars: 4px width, `--border2` thumb, transparent track, rounded

---

## Technology

No framework is required. Vanilla JavaScript with ES modules is sufficient for this scope. If a framework is introduced, agree with the team before starting.

**Required libraries:**

| Library | Version | Purpose |
|---|---|---|
| Mermaid.js | 11.x | Graph diagram rendering |
| marked.js | 12.x | Markdown to HTML |
| IBM Plex Sans/Mono | — | Typography (Google Fonts) |

No build step is required for v1. CDN imports from `esm.sh`, `cdn.jsdelivr.net`, or `cdnjs.cloudflare.com` are acceptable.

**Important:** All event listeners that reference functions defined inside ES module `<script type="module">` blocks must be attached programmatically using `addEventListener` inside the module. Inline `onclick` attributes in HTML cannot reach module-scoped functions and will throw `ReferenceError` at runtime.

---

## API Calls Summary

| When | Endpoint | Purpose |
|---|---|---|
| On load | `GET /api/environments` | Populate environment switcher |
| On load / env change | `GET /api/index?env={env}` | Build sidebar and generate graph |
| On element select | `GET /api/files/{path}` | Load and render contract markdown |
| On history expand | `GET /api/history/{path}` | Load commit history |
| On search input | `GET /api/search?q={q}&env={env}` | Filter sidebar and dim graph nodes |

All calls use `TYR_BASE_URL` as the base. All calls handle errors and show appropriate empty/error states.

---

## .mcp.json and CLAUDE.md

**`.mcp.json`** — committed to the repo root. Points to titan-algalon. Gives every developer working in this repo automatic access to WatcherVault architecture tools in Claude Code.

```json
{
  "mcpServers": {
    "watchervault": {
      "type": "http",
      "url": "${WATCHERVAULT_MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${WATCHERVAULT_TOKEN}"
      }
    }
  }
}
```

**`CLAUDE.md`** — instructs Claude Code agents to consult WatcherVault contracts before modifying any call to a titan-tyr endpoint (read the Interaction Interface contract first) or changing any environment variable name (check the Binding Interface contracts for all environments).

---

## Open Questions to Resolve Before Starting

1. **Framework decision** — vanilla JS or introduce a framework? Confirm before starting — this affects all subsequent decisions.
2. **`/api/index` response shape** — agree the exact JSON structure with the titan-tyr developer before building the sidebar or graph generator. This is the primary data contract between the two repos.
3. **Authentication** — does titan-mimiron authenticate against titan-tyr, or is it behind a network boundary with no auth?
4. **`TYR_BASE_URL` delivery** — how is this provided per environment: injected at build time, a runtime config file served at `/config.json`, or a `window.__ENV__` object?
