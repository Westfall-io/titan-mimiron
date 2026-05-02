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

Three regions, no graph:

```
┌──────────────────────────────────────────────────────────┐
│  HEADER — wordmark, search box, health indicator         │
├──────────────────────────┬───────────────────────────────┤
│                          │                               │
│   CATALOG LIST           │   DETAIL                      │
│                          │                               │
│   paginated software     │   software name, version,     │
│   rows; alias chips;     │   links, rendered markdown,   │
│   "Load more" button     │   related contracts list      │
│                          │                               │
└──────────────────────────┴───────────────────────────────┘
```

Master-detail two-pane is the simplest MVP. A separate route per detail page is also acceptable.

---

## MVP scope (three screens)

Per the API team's recommendation:

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

### 3. Register software

Sequence:

1. `GET /templates/software` (returns `text/markdown`) — the scaffold.
2. `GET /templates/software/proposals` to discover `active_version` (the body endpoint doesn't carry it).
3. Two-pane editor: rendered template (left, reference) + editable filled body (right). Form fields above the editor for `name`, `repo_uri`, `issue_tracker_uri` (optional), `aliases` (chip input), `version` (default `1.0.0`).
4. Apply the fill conventions (per the `register-software` skill in this repo): replace `<...>` placeholders, substitute `<template-version>` with the active version, strip blockquotes prefixed `**DELETE WHEN FILLING IN.**`, drop pure-reference H3 subsections, don't invent new H2 sections.
5. Preview the full body. Confirm. `POST /software`.

Common errors:
- `409` — name taken. Re-prompt.
- `422` — name not slug-shaped (`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`), bad `version`, bad `issue_tracker_uri` (https-only), or alias entry violates per-entry rules. Highlight the offending field and surface `detail` verbatim.

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

## What's deferred from DESIGN.md

| Feature | Why deferred |
|---|---|
| Mermaid graph visualisation | API doesn't expose connection layout data; the model lacks Part subtyping and environments needed for the original four views |
| Environment switcher | API has no environment concept |
| Sidebar grouped by Part type | API has only `software` and `contracts` — no Part subtyping |
| Git history panel | No `/history` endpoint; MVP has `version` + `updated_at` only |
| File-path browsing | API addresses content by `name` (software) or `id` (contracts), not paths |
| Search affecting graph dimming | No graph in MVP |
| Contract registration UI | API team recommends deferring; CLI suffices for now |
| Proposal/accept flows | Low frequency; deferrable to CLI for v1 |
| Template management UI | Governance, not user-facing |

---

## Open items

1. **Framework decision** still pending (DESIGN.md open question 1). MVP scope is small enough that vanilla JS + ES modules remains viable; reconfirm before starting.
2. **Auth contradiction.** [titan-norgannon#7](https://github.com/Westfall-io/titan-norgannon/issues/7)-equivalent decision was "no authentication" between mimiron and tyr. The shipped API requires a static placeholder bearer (`sysmlv2`). Two readings: charitably, "no real per-caller auth" — placeholder satisfies the intent and the long-term policy holds; literally, the placeholder is auth and contradicts the decision. The MVP will send the placeholder because the API requires it. If the long-term policy is genuinely no-auth, the API team should know — they may want to drop the gate at the same time.
3. **`TYR_BASE_URL` / `TYR_TOKEN` delivery** ([titan-norgannon#8](https://github.com/Westfall-io/titan-norgannon/issues/8)) — same delivery question, plus a secrets dimension once the token isn't a public placeholder.
4. **Env-var name harmonisation.** `register-software` skill uses `TITAN_TYR_URL` / `TITAN_TYR_TOKEN`; this brief uses `TYR_BASE_URL` / `TYR_TOKEN`. Pick one set before build start.
