# titan-mimiron

The WatcherVault Web UI — a navigable, force-directed graph of the WatcherVault software architecture with side-by-side markdown rendering of the underlying contract for any selected element.

> **Status:** MVP scaffolding shipped. The current build implements the read-only catalog described in [DESIGN-MVP.md](./DESIGN-MVP.md): software list with search, software detail with related contracts, and contract detail. The longer-term direction (graph + environments + register form) is captured in [DESIGN.md](./DESIGN.md).

---

## Run it locally

Requires Python 3.9+ and a running titan-tyr (`http://localhost:18000` by default).

```sh
python3 dev-server.py
```

Then open <http://localhost:8765/>.

`dev-server.py` is a tiny static server that also proxies `/tyr/*` to titan-tyr. The proxy is a workaround for [titan-tyr#14](https://github.com/Westfall-io/titan-tyr/issues/14) (no CORS support yet) — once that lands, the static files can be served by anything (`python3 -m http.server`, nginx, an S3 bucket) and `config.json`'s `tyrBaseUrl` can point directly at the API.

To point at a different titan-tyr:

```sh
python3 dev-server.py --tyr http://staging-tyr.example:18000 --port 9000
```

## Configuration

`config.json` at the repo root, fetched once at app startup:

```json
{
  "tyrBaseUrl": "/tyr",
  "tyrToken": "sysmlv2"
}
```

| Key | Purpose |
|---|---|
| `tyrBaseUrl` | Where the app sends API requests. Default `/tyr` (works with `dev-server.py`). Set to a full origin (e.g. `https://tyr.example.com`) once CORS is in place. |
| `tyrToken` | Bearer token sent on every request except `GET /health`. v0.7.0 uses the placeholder `sysmlv2`. |

See [issue #2](https://github.com/Westfall-io/titan-mimiron/issues/2) on the long-term delivery mechanism (build-time vs runtime config vs `window.__ENV__`).

## What's in this build

| Screen | Endpoints used |
|---|---|
| Catalog (home) | `GET /software?limit=&after=&match=` |
| Software detail | `GET /software/{name}` + `GET /software/{name}/contracts` |
| Contract detail | `GET /contracts/{contract_id}` |
| Header health dot | `GET /health` (polled every 30s) |

Routing is hash-based: `#/`, `#/software/:name`, `#/contracts/:id`. Search debounces 300ms.

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | Vanilla JavaScript (ES modules) — see [issue #1](https://github.com/Westfall-io/titan-mimiron/issues/1) |
| Markdown rendering | [marked.js](https://marked.js.org/) 12 from `cdn.jsdelivr.net` |
| Typography | IBM Plex Sans / IBM Plex Mono (Google Fonts) |
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

titan-mimiron talks **only** to titan-tyr. The mimiron ↔ tyr contract is registered in titan-tyr (see `GET /software/titan-mimiron/contracts`).

## Repository layout

```
titan-mimiron/
├── AGENTS.md         Operating rules for AI coding agents
├── DESIGN.md         Long-term direction (graph, environments, file-path browsing)
├── DESIGN-MVP.md     Reconciled brief — source of truth for the MVP build
├── README.md         This file
├── _model/           ICD knowledge-base structure notes
├── config.json       Runtime config (tyrBaseUrl, tyrToken)
├── dev-server.py     Static + proxy dev server (CORS workaround)
├── index.html        App shell
├── style.css         Design tokens, layout, markdown styling
└── src/
    ├── api.js        titan-tyr HTTP client (auth, errors, pagination)
    ├── markdown.js   marked.js wrapper + template-stamp extraction
    ├── router.js     Hash-based route table
    ├── util.js       Small shared helpers (esc, relativeTime, repoLink)
    ├── main.js       App bootstrap, search, health probe
    └── views/
        ├── catalog.js
        ├── software.js
        └── contract.js
```

## Deferred (not in this build)

Tracked in [DESIGN-MVP.md → What's deferred](./DESIGN-MVP.md#whats-deferred): Mermaid graph, environment switcher, sidebar grouped by Part type, git history panel, file-path browsing, contract registration UI, proposal/accept flows, template management UI.

Software registration via `POST /software` is implemented as a Claude Code skill (`.claude/skills/register-software/`), not a UI form. Run it from Claude Code to add new software nodes.

## Contributing

Read [AGENTS.md](./AGENTS.md) before making any commits — gitmoji prefix on commit messages, no `Co-Authored-By` trailer, push after every commit, and stay within the file-system scope of this repo.
