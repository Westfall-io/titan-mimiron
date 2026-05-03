# titan-mimiron

The WatcherVault Web UI — a **read-only** browser into the WatcherVault catalog of parts and contracts. titan-mimiron is intentionally read-only by design (see [DESIGN-MVP.md](./DESIGN-MVP.md) → "Scope: read-only, by design"); part registration and contract proposals happen via the API directly or via the `register-software` Claude skill in this repo.

> **Status:** 0.11.0 — adopts titan-tyr v0.14.0 surface: three new Part subtypes `image` (built artifact between source and runtime), `pod` (K8s sibling of container), `compose` (a Docker Compose stack as a first-class part). Subtype chip grows from 5 to 8 colors — runtime trio (container / pod / compose) clustered in the teal family per the provider dev's guidance, image gets coral as the "artifact between source and runtime" signal. Templates browser auto-grows to 8 kinds (the three new `/templates/{image,pod,compose}` pages work the same as the others — index, body, version history, "Used by"). Read-only as ever — register-part flow extension stays out of MVP scope. Builds on 0.10.0 (connection contract subtype). Companion contract proposal `2.2.0-rc2` on the mimiron↔tyr contract; accepted as 2.2.0 once this build is verified live.

---

## Run it locally

Two ways:

### Docker (production analog)

```sh
./build.sh                      # tags titan-mimiron:$(cat VERSION) + :latest
docker run --rm -p 8765:80 titan-mimiron:latest
```

Then open <http://localhost:8765/>. The image is `nginx:1.27-alpine` serving the static SPA and proxying `/tyr/*` to `$TYR_UPSTREAM`.

**Container env vars** (both have defaults; override per deployment):

| Variable | Default | Purpose |
|---|---|---|
| `TYR_UPSTREAM` | `http://localhost:8000` | Upstream titan-tyr URL — what nginx proxies `/tyr/*` to. |
| `TYR_TOKEN` | `sysmlv2` | Bearer token written into `config.json` at container start; the SPA puts it on every authed request. |

The default `localhost:8000` resolves *inside* the container — useful when mimiron and titan-tyr share a network (compose stack, `--network=host` on Linux). When titan-tyr runs on your host laptop and mimiron in Docker Desktop, point at the host gateway instead:

```sh
docker run --rm -p 8765:80 \
  -e TYR_UPSTREAM=http://host.docker.internal:18000 \
  titan-mimiron:latest
```

### Python dev server (faster iteration)

```sh
python3 dev-server.py
```

Then open <http://localhost:8765/>. Same `TYR_UPSTREAM` / `TYR_TOKEN` env vars as the docker image; same defaults; `--tyr` and `--port` flags override.

```sh
TYR_TOKEN=othertoken python3 dev-server.py --tyr http://staging-tyr.example:18000 --port 9000
```

Both paths exist because titan-tyr doesn't serve CORS yet — see [titan-tyr#14](https://github.com/Westfall-io/titan-tyr/issues/14). Once CORS lands, the proxy is optional; any static host works.

## Configuration

`config.json` is **generated at startup** (by the docker entrypoint or `dev-server.py`) from `config.json.template`, with `${TYR_TOKEN}` substituted from the container env. The browser fetches it once on load.

```json
{
  "tyrBaseUrl": "/tyr",
  "tyrToken": "${TYR_TOKEN}"
}
```

`tyrBaseUrl` is intentionally fixed at `/tyr` — it's always the local nginx proxy mount, regardless of where titan-tyr actually lives. Only `TYR_UPSTREAM` (proxy target) and `TYR_TOKEN` (bearer) are tunable per deploy. See the env-var table above.

This resolves [#2](https://github.com/Westfall-io/titan-mimiron/issues/2) — runtime config via container env vars beat the alternatives (build-time injection, `window.__ENV__`) for staying single-image-across-environments.

## What's in this build

| Pane / element | Endpoints used |
|---|---|
| Catalog (left) | `GET /parts?limit=&after=&match=` (optional `&subtype=`) |
| Graph (center, always mounted) | `GET /parts` + `GET /contracts` (paginated to completion, fetched once on app mount) |
| Detail (right) — part | `GET /parts/{name}` + `GET /parts/{name}/contracts` |
| Detail (right) — part history panel | `GET /parts/{name}/history` (lazy on first expand) |
| Detail (right) — contract | `GET /contracts/{contract_id}` |
| Detail (right) — contract history panel | `GET /contracts/{contract_id}/history` (lazy on first expand) |
| Header health dot | `GET /health` (polled every 30s) |

Routing is hash-based: `#/`, `#/parts/:name`, `#/contracts/:id`. Only the detail pane swaps on route change — the catalog and graph stay mounted. The graph highlights the route's selection (one node for a part, both endpoints for a contract). In the graph: click a node to open the part, click an edge or its version label to open the contract. The header search dims non-matching graph nodes (and edges between non-matches) while the catalog filters server-side; both react to the same input. Search debounces 300ms.

Markdown links inside contract/part bodies are intercepted: a slug-shaped href (`titan-tyr`) routes to `/parts/titan-tyr`, a UUID routes to `/contracts/<uuid>`, external (`http://…`) opens in a new tab with a ↗ glyph, anything else is marked broken. See [DESIGN-MVP.md → Markdown rendering](./DESIGN-MVP.md#markdown-rendering).

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | [Vue 3](https://vuejs.org/) + [Vue Router 4](https://router.vuejs.org/) via CDN ([resolved #1](https://github.com/Westfall-io/titan-mimiron/issues/1)) |
| Markdown rendering | [marked.js](https://marked.js.org/) 12 + [DOMPurify](https://github.com/cure53/DOMPurify) 3 (sanitize before `v-html`) |
| Graph rendering | [Mermaid](https://mermaid.js.org/) 11 (`graph LR`, dark theme) |
| Typography | IBM Plex Sans / IBM Plex Mono (Google Fonts) |
| Module resolution | Native `<script type="importmap">` — no bundler |
| Build step | None |

## Where it sits

```
titan-norgannon (Git repo of contracts)
        │ cloned and served by
        ▼
titan-tyr (REST API)
        │ consumed by
        ▼
titan-mimiron (this repo — Web UI)
```

titan-mimiron talks **only** to titan-tyr. The mimiron ↔ tyr contract is registered in titan-tyr (see `GET /parts/titan-mimiron/contracts`).

## Repository layout

```
titan-mimiron/
├── AGENTS.md         Operating rules for AI coding agents
├── DESIGN.md         Long-term direction (graph, environments, file-path browsing)
├── DESIGN-MVP.md     Reconciled brief — source of truth for the MVP build
├── README.md         This file
├── Dockerfile               nginx:alpine + static + /tyr proxy
├── .dockerignore
├── VERSION                  Image version (consumed by build.sh + Dockerfile ARG)
├── build.sh                 Tags image :$(cat VERSION) and :latest
├── nginx/                   envsubst-processed nginx + config.json templates
├── _model/                  ICD knowledge-base structure notes
├── config.json.template     Static template — generated to config.json at startup
├── dev-server.py            Static + proxy dev server (mirrors the Dockerfile)
├── index.html               App shell
├── style.css                Design tokens, layout, markdown styling
└── src/
    ├── main.js              App bootstrap (loads config, mounts Vue, runs health probe)
    ├── App.js               Root component — header + 2-pane layout + error banner
    ├── store.js             Shared reactive state (search, health, fatal, retry)
    ├── router.js            vue-router setup (3 hash routes)
    ├── api.js               titan-tyr HTTP client (auth, errors, pagination)
    ├── markdown.js          marked + DOMPurify; template-stamp extraction
    ├── util.js              Small shared helpers (esc, relativeTime, repoLink)
    ├── components/
    │   ├── HeaderBar.js     Wordmark + search + health dot
    │   ├── CatalogPane.js   Paginated, debounced-search list (left pane)
    │   └── GraphPane.js     Always-mounted Mermaid graph (center pane) + legend strip
    └── views/               Detail-pane views, swapped by router-view
        ├── EmptyDetail.js
        ├── PartDetail.js
        └── ContractDetail.js
```

## Deferred (not in this build)

Tracked in [DESIGN-MVP.md → What's deferred](./DESIGN-MVP.md#whats-deferred): Mermaid graph, environment switcher, sidebar grouped by Part type, git history panel, file-path browsing, contract registration UI, proposal/accept flows, template management UI.

Part registration via `POST /parts` is implemented as a Claude Code skill (`.claude/skills/register-software/`), not a UI form. Run it from Claude Code to add new part nodes.

## Contributing

Read [AGENTS.md](./AGENTS.md) before making any commits — gitmoji prefix on commit messages, no `Co-Authored-By` trailer, push after every commit, and stay within the file-system scope of this repo.
