# titan-mimiron — MVP Developer Brief

**Status:** v1 / MVP. Reconciled against titan-tyr **v0.10.0** and the API team's "titan-tyr UI MVP — endpoint guide." (Originally written against v0.7.0; v0.9.0 renamed the `software` resource to `part` and v0.10.0 added the `subtype` discriminator on parts and contracts. This brief uses the v0.10.0 surface throughout.)
**Relationship to [DESIGN.md](./DESIGN.md):** DESIGN.md remains the long-term direction (full architecture browser with graph + environments + file-path navigation). For the MVP build this document is the source of truth — DESIGN.md is **not**.

---

## Why the pivot

DESIGN.md was written before titan-tyr existed, against a speculative API surface and a SysMLv2-derived domain model with Parts (5 subtypes), Ports, Interfaces (2 subtypes), Connections, and four environments. The shipped API is deliberately narrower: **parts** (vertices, with two subtypes: `software` | `container`) and **contracts** (edges, with two subtypes: `interaction` | `binding`), no environment concept, no Ports/Interfaces, no graph data. The MVP follows the API as shipped.

### Delta summary

| Topic | DESIGN.md (original) | DESIGN-MVP.md (this) |
|---|---|---|
| Domain model | Parts (5 subtypes) + Ports + Interfaces (2 subtypes) + Connections | `parts` (nodes; subtypes `software` \| `container`) + `contracts` (edges; subtypes `interaction` \| `binding`) |
| Environments | 4 (common, local, staging, production) | None — flat catalog |
| Auth | "No authentication" | Placeholder `Authorization: Bearer sysmlv2` (see Open items) |
| Endpoints | `/api/environments`, `/api/index`, `/api/files/{path}`, `/api/history/{path}`, `/api/search` | `/health`, `/parts`, `/parts/{name}`, `/parts/{name}/contracts`, `/contracts/{id}`, `/templates/part` (others deferred) |
| Markdown source | `GET /api/files/{path}` (raw markdown body) | `part.markdown` / `contracts[].markdown` (JSON field) |
| Pagination | Not addressed | Cursor-based: `?limit=` (default 50, max 100) + opaque `?after=`; `next: null` ends |
| Search | Cross-architecture, dims non-matches in graph + sidebar | `?match=` substring on `name` + `aliases`; debounce 250–400ms |
| Version metadata | Custom headers `X-Contract-Version`, `X-Git-SHA`, `X-Git-Last-Modified` | JSON `version` (semver) + `updated_at`; no git SHA, no last-modified header |
| Graph rendering | Mermaid `flowchart LR`, four view tabs, layered subgraphs | **Deferred** — no graph in MVP |
| Layout | Header + sidebar + graph canvas + detail panel | Header + catalog list + detail view |

---

## Configuration

| Variable | Purpose | Notes |
|---|---|---|
| `TYR_BASE_URL` | titan-tyr base URL | required; e.g. `http://localhost:18000` |
| `TYR_TOKEN` | bearer token for `Authorization` header | defaults to `sysmlv2` (v0.7.0 placeholder) |

Delivery mechanism still undecided (see [titan-norgannon#8](https://github.com/Westfall-io/titan-norgannon/issues/8)). For local dev, an `.env` file is fine. The `register-software` skill in this repo expects the same values under `TITAN_TYR_URL` / `TITAN_TYR_TOKEN` — name harmonisation is a follow-up.

---

## Layout

Three panes, graph is permanent furniture (not a route — see 0.3.0):

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER — wordmark, search box, health indicator                     │
├──────────────┬──────────────────────────────────┬────────────────────┤
│              │                                  │                    │
│  CATALOG     │   GRAPH (always mounted)         │   DETAIL           │
│              │                                  │                    │
│  paginated   │   all parts as nodes,            │   markdown body    │
│  part        │   contracts as directed edges;   │   for the route's  │
│  rows;       │   click node → /parts/:name;     │   part or          │
│  alias +     │   route highlights selected      │   contract;        │
│  subtype     │   node(s); legend strip with     │   topbar chips +   │
│  chips;      │   counts at the bottom           │   related list     │
│  "Load more" │                                  │                    │
│              │                                  │                    │
└──────────────┴──────────────────────────────────┴────────────────────┘
```

The graph is the centerpiece — the catalog and the detail are the two sidebars. All three panes stay visible across `/`, `/parts/:name`, and `/contracts/:id`; only the detail pane swaps content.

---

## Scope: read-only, by design

titan-mimiron is **read-only** — it browses the catalog and renders contracts, nothing more. There is no Register form, no Edit form, no proposal/accept UI, and none are planned. Part registration happens out-of-band (the `register-software` Claude skill ships in this repo for that path); contract proposals happen via direct API calls. This is not a deferral — it is a permanent scope decision. New write-side proposals should be redirected to "use the CLI / skill instead."

## Scope

Per the API team's recommendation, narrowed by the read-only-by-design decision above:

### 1. Catalog (home)

- **Listing:** `GET /parts?limit=50` → `{ results: [...], next: <cursor> | null }`. Each row carries `name`, `subtype`, `repo_uri`, `issue_tracker_uri`, `aliases`, `version`, `updated_at`. **`markdown` is intentionally not in listing responses.** Optional `?subtype=software|container` narrows to one subtype (mimiron does not currently filter, but the chip is rendered per row).
- **Search:** `GET /parts?match=<query>` — substring (case-insensitive) over `name` and every entry of `aliases`. Server-side ILIKE escape — pass user input verbatim. Debounce 250–400ms.
- **Pagination:** "Load more" button driven by the `next` cursor. **No totals** — the API doesn't compute them.
- Show alias chips and a small subtype chip on each row so the user understands *why* a fuzzy match surfaced and what kind of part it is.
- Click → detail.

### 2. Detail

- **Header data:** `GET /parts/{name}` → same shape as a listing entry plus `markdown`.
  - Render the `markdown` body. **Strip the leading `<!-- template: part@X.Y.Z -->` HTML comment from the visible output** and surface it as small "Template: vX.Y.Z" metadata so drift is visible.
  - Issue tracker resolves to `<repo_uri>/issues` if `issue_tracker_uri` is `null`.
  - Topbar carries the part subtype chip (`software` or `container`).
- **Related contracts:** `GET /parts/{name}/contracts?limit=50` (response wrapper key is `part`) — every contract where this part is owner or counterparty. Each row: `contract_id`, `owner`, `counterparty`, `subtype`, `version`, `updated_at`. **No `markdown` in the list — fetch per-row on click.**
- Click a contract → `GET /contracts/{contract_id}`. Owner/counterparty keys on the response are unchanged from v1.x; subtype (`interaction` | `binding`) is rendered as a chip in the topbar.

### 3. Graph (added in 0.2.0; promoted to permanent center pane in 0.3.0)

- **Placement:** always-mounted center pane in the 3-pane layout (no `/graph` route — that was 0.2.0; in 0.3.0 the graph is permanent furniture). The catalog and detail panes flank it.
- **Data:** walks `GET /parts` and `GET /contracts` to completion (cursor pagination, `limit=100`, opaque `next`). One paginated request bag per resource — fine at current catalog sizes; revisit if the catalog grows past a few hundred entries. Fetched once on mount; the pane survives route changes.
- **Renderer:** [Cytoscape.js](https://js.cytoscape.org/) 3 with [dagre](https://github.com/dagrejs/dagre) 0.8 for layout (since 0.19.0 — replaced Mermaid 11). Cytoscape draws on its own canvas with built-in pan/zoom; styling is defined in the JS-side stylesheet (the cy `style` array) rather than CSS. dagre is driven directly so we can pin per-node ranks via the Sugiyama "anchor chain" trick (one dummy node per lifecycle tier, chained `minlen: 1`, with each real node sandwiched between its tier's anchor and the next via high-weight edges). This forces the canonical compose ↔ container ↔ image ↔ software flow regardless of edge direction — Mermaid 11 had no `rank=same` primitive so the previous renderer couldn't do this.
- **Click semantics:** click a node → `/parts/:name`; click an edge or its version label → `/contracts/:id`. The detail pane updates; the graph stays visible. Click handlers are wired through Cytoscape's event API (`cy.on('tap', 'node', ...)` / `'edge'` / background) — no post-render DOM walking, no source-order index matching. Each edge carries `data: {contractId}` so the handler reads the contract id directly.
- **Selection highlight:** when the route is `/parts/:name`, the matching graph node gets an accent stroke + glow. When the route is `/contracts/:id`, both endpoints (owner and counterparty) are highlighted. Re-rendering the SVG on every route change would be wasteful; instead we toggle a CSS class on the existing `<g class="node">` elements.
- **Search dimming:** when the header search input is non-empty, non-matching nodes drop to ~20% opacity and edges where neither endpoint matches drop to ~15%. Match rule mirrors the catalog's server-side `?match=` (case-insensitive substring on `name` + `aliases`). Selection always wins over dimming.
- **Legend:** thin strip at the bottom of the pane with node count, edge count, and a "click a node to inspect" hint.
- **Subtype rendering:** in 0.6.0 the graph still renders one node style for all parts and one edge style for all contracts. Subtype-aware shape/color rendering (square for `container` vs rounded for `software`; dashed for `interaction` vs solid for `binding`) is the natural next iteration but is out of scope for the rename PR.

### 4. Version history panel (added in 0.4.0)

- **Placement:** collapsible section at the bottom of `PartDetail` and `ContractDetail`, below the markdown body (and below the related-contracts list for parts).
- **Data:** `GET /parts/{name}/history` and `GET /contracts/{contract_id}/history` — cursor-paginated timelines from titan-tyr 0.8.0+. Each row is `{ version, updated_at }`; no `markdown`, no actor identity (the latter reserved for when real per-caller auth lands and the contract gets a `MAJOR` bump).
- **Lazy-load:** the panel starts collapsed; the first expand triggers the fetch (per the consumer obligation in mimiron↔tyr contract `1.2.0`). Subsequent expands re-show the cached result. State resets when the route's resource id changes.
- **Visual:** chevron toggle + "Version history" label + count chip once fetched. Each row is a `version` chip + `updated_at` chip; the most-recent entry gets a green `current` marker. Pre-tyr-0.8 (or any 404), the panel surfaces "version history endpoint not yet available — pending titan-tyr#20" inline rather than treating it as an error.

---

## Cross-cutting

### Health indicator

`GET /health` (unauthenticated) → `{ status, version, db }`. Poll every 30s, render as a header dot — green on `200`, red on `503` or unreachable. Show the API version somewhere visible (footer or about) so users on stale JS can spot version skew.

### Authentication

One header on every request **except** `GET /health`:

```
Authorization: Bearer sysmlv2
```

Read the token from app config, not baked in — when real per-caller auth lands, only the config changes.

### Errors

`{"detail": "..."}` per FastAPI convention. Surface `detail` verbatim in form errors. Status semantics:

| Code | UI guidance |
|---|---|
| 401 | Bounce to config; don't retry |
| 404 | "Not found" empty state |
| 409 | Surface `detail` verbatim; usually re-prompt |
| 422 | Surface `detail`; highlight the offending field |
| 503 | Banner; retry the health probe |

### Markdown rendering

marked.js. Strip the `<!-- template: ...@X.Y.Z -->` stamp from visible output (per detail screen above).

**In-app link interception (added 0.3.3).** Markdown link hrefs are rewritten at parse time so cross-references navigate inside the app:

| Href shape | Rewritten to | Behavior |
|---|---|---|
| `#…` | unchanged | passthrough (in-page anchor or pre-formed hash route) |
| `scheme:…` or `//host…` | unchanged | external; `target="_blank" rel="noopener noreferrer"`, ↗ glyph |
| `<uuid>` | `#/contracts/<uuid>` | in-app navigation to contract detail |
| slug-shaped (matches `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`) | `#/parts/<slug>` | in-app navigation to part detail |
| anything else (relative paths like `./foo.md`, etc.) | unchanged | marked `.md-link-broken` (red strike-through, hover title "broken in-app reference") |

Encourages contract authors to write `[titan-tyr](titan-tyr)` for part refs and `[the storage contract](abc-123-…)` for contract refs. Both work as plain markdown elsewhere (renders as a relative link), and resolve as in-app navigation here.

---

## Out of scope (permanent)

Per the read-only-by-design decision above:

| Feature | Where it happens instead |
|---|---|
| Part registration UI | `register-software` Claude skill in this repo (`POST /parts`) |
| Part edit UI | direct API (`PUT /parts/{name}`) |
| Contract registration UI | direct API (`POST /contracts`) |
| Contract proposal / accept UI | direct API (`POST /contracts/{id}/proposals`, `…/accept`) |
| Template management UI | direct API; governance, not user-facing |

## Deferred from DESIGN.md (gated on titan-tyr capability)

| Feature | Why deferred |
|---|---|
| Four-view graph tabs (Full / Software / DevOps / Interfaces) | Needs the full DESIGN.md domain (Ports, Interfaces, Connections) and environments. v0.10.0 introduced two part subtypes (`software` \| `container`) and two contract subtypes (`interaction` \| `binding`) — surfaced as chips in 0.6.0; richer subtype-aware graph rendering remains future work. |
| Environment switcher | API has no environment concept |
| Sidebar grouped by Part subtype | Subtype is now available (v0.10.0) and rendered as a chip; grouping is a possible future iteration |
| File-path browsing | API addresses content by `name` (parts) or `id` (contracts), not paths |

---

## Open items

1. ~~Framework decision still pending.~~ **Resolved (2026-05-02):** Vue 3 + Vue Router 4 via CDN + import map (no build step). See [#1](https://github.com/Westfall-io/titan-mimiron/issues/1).
2. **Auth contradiction.** [titan-norgannon#7](https://github.com/Westfall-io/titan-norgannon/issues/7)-equivalent decision was "no authentication" between mimiron and tyr. The shipped API requires a static placeholder bearer (`sysmlv2`). Two readings: charitably, "no real per-caller auth" — placeholder satisfies the intent and the long-term policy holds; literally, the placeholder is auth and contradicts the decision. The MVP will send the placeholder because the API requires it. If the long-term policy is genuinely no-auth, the API team should know — they may want to drop the gate at the same time.
3. ~~`TYR_BASE_URL` / `TYR_TOKEN` delivery.~~ **Resolved (2026-05-02):** container env vars (`TYR_UPSTREAM` for the proxy target, `TYR_TOKEN` for the bearer); `tyrBaseUrl` is fixed at `/tyr` since it's always the local nginx proxy mount. `config.json.template` is envsubst'd at container start. See [#2](https://github.com/Westfall-io/titan-mimiron/issues/2). Secrets management still open once `TYR_TOKEN` stops being a public placeholder.
4. **Env-var name harmonisation.** `register-software` skill uses `TITAN_TYR_URL` / `TITAN_TYR_TOKEN`; the docker image and dev-server use `TYR_UPSTREAM` / `TYR_TOKEN`. Two different audiences (CLI agent vs deployed container), so divergence is tolerable for now.
