# titan-mimiron

The WatcherVault Web UI — a navigable, force-directed graph of the WatcherVault software architecture with side-by-side markdown rendering of the underlying contract for any selected element.

> **Status:** pre-implementation. The design is captured in [DESIGN.md](./DESIGN.md); no application code has been written yet. Several questions need to be resolved before build can start — see [Open questions](#open-questions) below.

---

## What it is

titan-mimiron is a **document reader with graph-based navigation**. Every element in the architecture — a software service, a Docker image, a running container, an interface contract — is backed by a markdown file in [titan-norganon](https://github.com/Westfall-io/titan-norganon). titan-mimiron lets a human:

- Browse those elements as a Mermaid graph, filtered by environment and view.
- Click any node (or sidebar item) to load and render its raw markdown contract.
- Switch between environments (`common`, `local`, `staging`, `production`) and watch the graph reshape accordingly.
- Search across the architecture.
- Inspect version, git SHA, last-modified date, and full commit history for any contract.

It is **not** a database viewer, form renderer, or dashboard. The graph is the navigation; the markdown document is the content.

---

## Where it sits

```
titan-norganon (Git repo of contracts)
        │ cloned and served by
        ▼
titan-tyr (REST API)
        │ consumed by
        ▼
titan-mimiron (this repo — Web UI)
```

titan-mimiron talks **only** to titan-tyr. It never reaches into the contracts repo directly. All data — index, files, history, environments, search — is fetched at runtime from the titan-tyr base URL configured at deploy time.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | Vanilla JavaScript (ES modules) — pending framework decision |
| Graph rendering | [Mermaid.js](https://mermaid.js.org/) 11.x (`flowchart LR`) |
| Markdown rendering | [marked.js](https://marked.js.org/) 12.x |
| Typography | IBM Plex Sans / IBM Plex Mono (Google Fonts) |
| Build step | None planned for v1 — CDN imports |

See [DESIGN.md → Technology](./DESIGN.md#technology) for full rationale and constraints.

---

## Configuration

The app must function against any running titan-tyr instance without code changes. The base URL is provided via:

| Variable | Purpose |
| --- | --- |
| `TYR_BASE_URL` | Base URL of the titan-tyr REST API |

How that variable is delivered to the running page (build-time injection vs `/config.json` vs `window.__ENV__`) is one of the open questions below.

---

## API surface (consumed)

| When | Endpoint |
| --- | --- |
| On load | `GET /api/environments` |
| On load / env change | `GET /api/index?env={env}` |
| On element select | `GET /api/files/{path}` |
| On history expand | `GET /api/history/{path}` |
| On search input | `GET /api/search?q={q}&env={env}` |

Contract version, git SHA, and last-modified date are read from response headers (`X-Contract-Version`, `X-Git-SHA`, `X-Git-Last-Modified`) on `GET /api/files/{path}`.

---

## Repository layout

```
titan-mimiron/
├── AGENTS.md     Operating rules for AI coding agents
├── DESIGN.md     Full developer brief — single source of truth for the build
└── README.md     This file
```

Application source will land here once the open questions are resolved.

---

## Open questions

The build is gated on these decisions (from [DESIGN.md → Open Questions to Resolve Before Starting](./DESIGN.md#open-questions-to-resolve-before-starting)):

1. **Framework** — vanilla JS or a framework?
2. **`/api/index` response shape** — exact JSON contract with titan-tyr.
3. **Authentication** — does titan-mimiron authenticate against titan-tyr, or sit behind a network boundary?
4. **`TYR_BASE_URL` delivery** — build-time, runtime `/config.json`, or `window.__ENV__`?

---

## Contributing

Read [AGENTS.md](./AGENTS.md) before making any commits — it covers commit-message format (gitmoji prefix), the no-Co-Authored-By rule, the push-after-every-commit rule, and the file-system scope boundary for AI agents working in this repo.
