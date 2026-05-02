# titan-mimiron — MVP Developer Brief

**Status:** v1 / MVP. Reconciled against titan-tyr **v0.7.0** and the API team's "titan-tyr UI MVP — endpoint guide."
**Relationship to [DESIGN.md](./DESIGN.md):** DESIGN.md remains the long-term direction (full architecture browser with graph + environments + file-path navigation). For the MVP build this document is the source of truth — DESIGN.md is **not**.

---

## Why the pivot

DESIGN.md was written before titan-tyr existed, against a speculative API surface and a SysMLv2-derived domain model with Parts (5 subtypes), Ports, Interfaces (2 subtypes), Connections, and four environments. The shipped API is deliberately narrower: **software nodes** (vertices) and **contracts** (edges), no environment concept, no Part subtyping, no graph data. The MVP follows the API as shipped.

### Delta summary

| Topic | DESIGN.md (original) | DESIGN-MVP.md (this) |
|---|---|---|
| Domain model | Parts (5 subtypes) + Ports + Interfaces (2 subtypes) + Connections | `software` (nodes) + `contracts` (edges) |
| Environments | 4 (common, local, staging, production) | None — flat catalog |
| Auth | "No authentication" | Placeholder `Authorization: Bearer sysmlv2` (see Open items) |
| Endpoints | `/api/environments`, `/api/index`, `/api/files/{path}`, `/api/history/{path}`, `/api/search` | `/health`, `/software`, `/software/{name}`, `/software/{name}/contracts`, `/contracts/{id}`, `/templates/software` (others deferred) |
| Markdown source | `GET /api/files/{path}` (raw markdown body) | `software.markdown` / `contracts[].markdown` (JSON field) |
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
│  paginated   │   all software as nodes,         │   markdown body    │
│  software    │   contracts as directed edges;   │   for the route's  │
│  rows;       │   click node → /software/:name;  │   software or      │
│  alias       │   route highlights selected      │   contract;        │
│  chips;      │   node(s); legend strip with     │   topbar chips +   │
│  "Load more" │   counts at the bottom           │   related list     │
│              │                                  │                    │
└──────────────┴──────────────────────────────────┴────────────────────┘
```

The graph is the centerpiece — the catalog and the detail are the two sidebars. All three panes stay visible across `/`, `/software/:name`, and `/contracts/:id`; only the detail pane swaps content.

---

## Scope: read-only, by design

titan-mimiron is **read-only** — it browses the catalog and renders contracts, nothing more. There is no Register form, no Edit form, no proposal/accept UI, and none are planned. Software registration happens out-of-band (the `register-software` Claude skill ships in this repo for that path); contract proposals happen via direct API calls. This is not a deferral — it is a permanent scope decision. New write-side proposals should be redirected to "use the CLI / skill instead."

## Scope

Per the API team's recommendation, narrowed by the read-only-by-design decision above:

### 1. Catalog (home)

- **Listing:** `GET /software?limit=50` → `{ results: [...], next: <cursor> | null }`. Each row carries `name`, `repo_uri`, `issue_tracker_uri`, `aliases`, `version`, `updated_at`. **`markdown` is intentionally not in listing responses.**
- **Search:** `GET /software?match=<query>` — substring (case-insensitive) over `name` and every entry of `aliases`. Server-side ILIKE escape — pass user input verbatim. Debounce 250–400ms.
- **Pagination:** "Load more" button driven by the `next` cursor. **No totals** — the API doesn't compute them.
- Show alias chips on each row so the user understands *why* a fuzzy match surfaced.
- Click → detail.

### 2. Detail

- **Header data:** `GET /software/{name}` → same shape as a listing entry plus `markdown`.
  - Render the `markdown` body. **Strip the leading `<!-- template: software@X.Y.Z -->` HTML comment from the visible output** and surface it as small "Template: vX.Y.Z" metadata so drift is visible.
  - Issue tracker resolves to `<repo_uri>/issues` if `issue_tracker_uri` is `null`.
- **Related contracts:** `GET /software/{name}/contracts?limit=50` — every contract where this software is owner or counterparty. Each row: `contract_id`, `owner`, `counterparty`, `version`, `updated_at`. **No `markdown` in the list — fetch per-row on click.**
- Click a contract → `GET /contracts/{contract_id}`.

### 3. Graph (added in 0.2.0; promoted to permanent center pane in 0.3.0)

- **Placement:** always-mounted center pane in the 3-pane layout (no `/graph` route — that was 0.2.0; in 0.3.0 the graph is permanent furniture). The catalog and detail panes flank it.
- **Data:** walks `GET /software` and `GET /contracts` to completion (cursor pagination, `limit=100`, opaque `next`). One paginated request bag per resource — fine at current catalog sizes; revisit if the catalog grows past a few hundred entries. Fetched once on mount; the pane survives route changes.
- **Renderer:** [Mermaid](https://mermaid.js.org/) 11 with `graph LR`, custom `theme: 'base'` themed to match the app's dark palette, `curve: 'basis'`, `securityLevel: 'loose'` to enable the `click ID call fn(arg)` callback syntax. Software names are slug-validated server-side (`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`) so the loose label policy is safe by construction.
- **Click semantics:** click a node → `/software/:name`. The detail pane updates; the graph stays visible. Edge clicks not supported in this version — the version label on the edge is enough to tell users which contract is which; navigate to either endpoint to find it in the contracts list.
- **Selection highlight:** when the route is `/software/:name`, the matching graph node gets an accent stroke + glow. When the route is `/contracts/:id`, both endpoints (owner and counterparty) are highlighted. Re-rendering the SVG on every route change would be wasteful; instead we toggle a CSS class on the existing `<g class="node">` elements.
- **Legend:** thin strip at the bottom of the pane with node count, edge count, and a "click a node to inspect" hint.

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

---

## Out of scope (permanent)

Per the read-only-by-design decision above:

| Feature | Where it happens instead |
|---|---|
| Software registration UI | `register-software` Claude skill in this repo (`POST /software`) |
| Software edit UI | direct API (`PUT /software/{name}`) |
| Contract registration UI | direct API (`POST /contracts`) |
| Contract proposal / accept UI | direct API (`POST /contracts/{id}/proposals`, `…/accept`) |
| Template management UI | direct API; governance, not user-facing |

## Deferred from DESIGN.md (gated on titan-tyr capability)

| Feature | Why deferred |
|---|---|
| Four-view graph tabs (Full / Software / DevOps / Interfaces) | Needs Part subtyping and environments; today's API has only `software` + `contracts`. The single-view graph in 0.2.0 covers the basic case. |
| Environment switcher | API has no environment concept |
| Sidebar grouped by Part type | API has only `software` and `contracts` — no Part subtyping |
| Git history panel | No `/history` endpoint; MVP has `version` + `updated_at` only |
| File-path browsing | API addresses content by `name` (software) or `id` (contracts), not paths |
| Search dimming the graph | Catalog search and graph view are separate routes today; cross-coupling is a v0.3.0 concern |
| Edge clicks in the graph | Mermaid edge click handlers need post-render SVG manipulation; not worth the complexity until contract bodies surface differently than navigating to an endpoint |

---

## Open items

1. ~~Framework decision still pending.~~ **Resolved (2026-05-02):** Vue 3 + Vue Router 4 via CDN + import map (no build step). See [#1](https://github.com/Westfall-io/titan-mimiron/issues/1).
2. **Auth contradiction.** [titan-norgannon#7](https://github.com/Westfall-io/titan-norgannon/issues/7)-equivalent decision was "no authentication" between mimiron and tyr. The shipped API requires a static placeholder bearer (`sysmlv2`). Two readings: charitably, "no real per-caller auth" — placeholder satisfies the intent and the long-term policy holds; literally, the placeholder is auth and contradicts the decision. The MVP will send the placeholder because the API requires it. If the long-term policy is genuinely no-auth, the API team should know — they may want to drop the gate at the same time.
3. ~~`TYR_BASE_URL` / `TYR_TOKEN` delivery.~~ **Resolved (2026-05-02):** container env vars (`TYR_UPSTREAM` for the proxy target, `TYR_TOKEN` for the bearer); `tyrBaseUrl` is fixed at `/tyr` since it's always the local nginx proxy mount. `config.json.template` is envsubst'd at container start. See [#2](https://github.com/Westfall-io/titan-mimiron/issues/2). Secrets management still open once `TYR_TOKEN` stops being a public placeholder.
4. **Env-var name harmonisation.** `register-software` skill uses `TITAN_TYR_URL` / `TITAN_TYR_TOKEN`; the docker image and dev-server use `TYR_UPSTREAM` / `TYR_TOKEN`. Two different audiences (CLI agent vs deployed container), so divergence is tolerable for now.
