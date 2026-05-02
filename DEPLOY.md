# DEPLOY.md

Operational guide for deploying titan-mimiron. Audience: anyone running the container in dev, staging, or prod.

For *what* this app is and *how the code works*, see [`README.md`](./README.md) and [`DESIGN-MVP.md`](./DESIGN-MVP.md). This file is the operational view: image, env vars, networking, health, sizing, smoke tests.

---

## What you're deploying

- A static SPA (Vue 3 + Vue Router 4, no build step) served by nginx.
- A built-in nginx reverse proxy from `/tyr/*` → titan-tyr's REST API. The browser only ever talks to its own origin; the cross-origin hop happens server-side.
- **Stateless.** No database, no cache, no persistent volume. Restarting wipes nothing because there's nothing to wipe.
- **Read-only against titan-tyr by design** (see [DESIGN-MVP.md → Scope: read-only, by design](./DESIGN-MVP.md#scope-read-only-by-design)). The bearer token grants write access at the API level; the UI just doesn't exercise it.

---

## Image

| Property | Value |
|---|---|
| Base image | `nginx:1.27-alpine` |
| Built artifact size | ~50 MB |
| Default exposed port | `80` (TCP, plain HTTP) |
| Process | `nginx -g 'daemon off;'` (PID 1) |
| User | `root` (default for nginx:alpine — see [Security](#security)) |
| OCI labels | `org.opencontainers.image.{title,description,source,version}` |

### Build

```sh
./build.sh
```

Tags `titan-mimiron:$(cat VERSION)` and `titan-mimiron:latest`. The version comes from the [`VERSION`](./VERSION) file at the repo root and is also baked into the image as `org.opencontainers.image.version`.

### Registry

No registry today — local-only by current decision (titan-norgannon#7, closed). When that changes:

- The image is multi-arch-buildable via `docker buildx` (no architecture-specific code in nginx:alpine).
- The `LABEL` chain already gives `docker inspect` the metadata a registry needs.
- Tag immutably (`:0.1.0`) and never overwrite a published version tag. Move `:latest` if you want a floating pointer.

---

## Runtime configuration

Two env vars on the container, both with defaults. Override per environment.

| Variable | Default | Purpose |
|---|---|---|
| `TYR_UPSTREAM` | `http://localhost:8000` | URL nginx proxies `/tyr/*` to. Resolved **inside** the container, so `localhost` means the container itself — only useful with `--network=host` or sidecar topologies. For split-host (Docker Desktop with titan-tyr on the laptop), use `http://host.docker.internal:18000`. For compose, use the service name (`http://tyr:8000`). |
| `TYR_TOKEN` | `sysmlv2` | Bearer token. Substituted into `/usr/share/nginx/html/config.json` at container start; the SPA puts it on every authed request to `/tyr/*`. Today this is a **public placeholder** baked into titan-tyr 0.7.x — see [Security](#security) for the implications when real auth lands. |

**How the values land:**

- `TYR_UPSTREAM` is substituted into `/etc/nginx/conf.d/default.conf` by the alpine image's standard `20-envsubst-on-templates.sh` entrypoint hook.
- `TYR_TOKEN` is substituted into `/usr/share/nginx/html/config.json` by `15-envsubst-config-json.sh` (custom hook in this image).

Both happen **once at container start**. Changing the env on a running container does nothing — restart to pick up new values.

---

## Network

### Outbound

| To | Why | Protocol |
|---|---|---|
| `$TYR_UPSTREAM` | All catalog reads (`/health`, `/software`, `/contracts`, `/templates/*`) | HTTP/1.1 (or HTTPS if you point at one) |
| `https://fonts.googleapis.com` + `https://fonts.gstatic.com` | IBM Plex font files | HTTPS, **fetched by the browser** (not the container) |
| `https://cdn.jsdelivr.net` + `https://unpkg.com` | Vue, Vue Router, marked, DOMPurify | HTTPS, **fetched by the browser** (not the container) |

The container itself only needs to reach `$TYR_UPSTREAM`. Font and CDN traffic comes from the user's browser. If your end users are on a network that blocks unpkg or jsdelivr, you'll need to mirror those assets and serve them from the container — not addressed in v0.1.0.

### Inbound

Single port `80` inside the container; map to whatever you like outside (`8765` is the project default for parity with `dev-server.py`).

No ingress to anything beyond the SPA itself and the `/tyr/*` proxy. No webhooks, no callbacks.

---

## Health

| Check | How |
|---|---|
| Liveness | `GET /` (returns `index.html`, `200`). nginx is up if this is `200`. |
| Readiness | `GET /tyr/health` (returns titan-tyr's `{status, version, db}`). Reads through the proxy, so a `200` here means "nginx is up *and* the configured upstream is reachable." |
| Upstream health | `GET /tyr/health` continuously (the SPA polls every 30s; the health dot in the header is green when this returns `{status: ok, db: reachable}`). |

`/tyr/health` is unauthenticated end-to-end (the API doesn't require the bearer for `/health`).

**Suggested probe configuration** (compose / k8s / load balancer):

```
liveness:    GET /            expect 200    interval 10s, timeout 2s
readiness:   GET /tyr/health  expect 200    interval 5s,  timeout 2s, fail-after 3
```

A failed readiness probe means the upstream is broken, not mimiron — usually the right action is to wait, not to restart mimiron.

---

## Sizing

Tiny. nginx serving ~30 KB of static assets to whatever traffic you throw at it. The `/tyr/*` proxy adds one extra TCP hop per API call; nginx handles thousands of concurrent connections without breaking a sweat.

Reasonable starting points:

| Resource | Dev | Staging | Prod |
|---|---|---|---|
| CPU | 50m | 100m | 200m |
| Memory | 32Mi | 64Mi | 128Mi |
| Replicas | 1 | 1 | 2+ (for availability, not load) |

If you ever hit a real bottleneck it'll be at titan-tyr, not here.

---

## Topologies

### Standalone `docker run`

```sh
docker run -d --name mimiron \
  -p 8765:80 \
  -e TYR_UPSTREAM=http://host.docker.internal:18000 \
  -e TYR_TOKEN=sysmlv2 \
  --restart unless-stopped \
  titan-mimiron:0.1.0
```

Open <http://localhost:8765/>. `host.docker.internal` is the right value when titan-tyr runs on the host (Docker Desktop, or Linux with `--add-host=host.docker.internal:host-gateway`).

### docker-compose (mimiron + titan-tyr in one network)

```yaml
services:
  tyr:
    image: titan-tyr:0.7.1
    ports:
      - "18000:8000"   # optional — only needed if you want host access to the API

  mimiron:
    image: titan-mimiron:0.1.0
    ports:
      - "8765:80"
    environment:
      TYR_UPSTREAM: http://tyr:8000
      TYR_TOKEN: sysmlv2
    depends_on:
      - tyr
    restart: unless-stopped
```

The proxy talks to `tyr:8000` over the compose network — no `host.docker.internal` indirection.

### Kubernetes (sketch — not tested in v0.1.0)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mimiron
spec:
  replicas: 2
  selector: { matchLabels: { app: mimiron } }
  template:
    metadata: { labels: { app: mimiron } }
    spec:
      containers:
      - name: mimiron
        image: titan-mimiron:0.1.0
        ports: [{ containerPort: 80 }]
        env:
        - name: TYR_UPSTREAM
          value: http://tyr.default.svc.cluster.local:8000
        - name: TYR_TOKEN
          valueFrom:
            secretKeyRef: { name: tyr-token, key: token }
        livenessProbe:
          httpGet: { path: /, port: 80 }
          periodSeconds: 10
        readinessProbe:
          httpGet: { path: /tyr/health, port: 80 }
          periodSeconds: 5
        resources:
          requests: { cpu: 100m, memory: 64Mi }
          limits:   { cpu: 200m, memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata: { name: mimiron }
spec:
  selector: { app: mimiron }
  ports: [{ port: 80, targetPort: 80 }]
```

Front it with whatever Ingress / TLS terminator your cluster uses.

---

## Security

The image is intentionally minimal. A few things to know before pointing real users at it:

1. **No TLS in the image.** It serves plain HTTP on port 80. Run it behind a reverse proxy / Ingress / load balancer that terminates TLS.

2. **`TYR_TOKEN` is in the response body.** The SPA fetches `/config.json` to learn its bearer token, so `curl http://your-mimiron/config.json` will return the token verbatim. While `sysmlv2` is the public placeholder this is fine; once titan-tyr ships real per-caller auth, **this approach is no longer appropriate** — the token would need to be injected per-user (e.g. via a session cookie) or the proxy would have to attach the header server-side and the SPA would never see it. Track via [titan-mimiron#2](https://github.com/Westfall-io/titan-mimiron/issues/2)'s "secrets management" caveat.

3. **CORS is not mimiron's problem.** All API calls go through the same-origin proxy, so the browser doesn't enforce CORS for them. titan-tyr 0.7.1+ does serve CORS for an allow-list (currently `digitalforge.app` family + `localhost`); see [titan-tyr#15](https://github.com/Westfall-io/titan-tyr/issues/15) for the env-var-configurability work-in-progress.

4. **nginx runs as root.** Standard for `nginx:alpine`. Acceptable for an internal tool; harden by switching to `nginxinc/nginx-unprivileged` and binding port 8080 if your environment requires non-root.

5. **No authentication on the SPA itself.** Anyone who can reach the container can read the catalog. If you need to gate access, do it at the ingress layer (Cloudflare Access, oauth2-proxy, etc.).

6. **No CSP / security headers.** nginx serves with default headers. Add a header block to `nginx/default.conf.template` if your environment requires CSP, X-Frame-Options, etc.

7. **No rate limiting.** The proxy will pass any request rate through to titan-tyr. If that's a concern, add an `nginx limit_req` zone or rate-limit at the ingress.

---

## Logging

nginx logs to stdout/stderr in the standard combined access log format. Container runtimes (docker, k8s) collect them.

The custom entrypoint script (`/docker-entrypoint.d/15-envsubst-config-json.sh`) runs once at start; its only output on success is silence. On failure (e.g. `config.json.template` missing), it `set -e`-exits before nginx starts.

Nothing else logs. The SPA's client-side errors are visible in browser devtools, not server logs.

---

## Smoke test (post-deploy)

```sh
# Replace HOST with whatever the deployment is reachable at.
HOST=http://localhost:8765

# 1. Static asset serves
curl -sS -o /dev/null -w "HTTP %{http_code}  /\n" $HOST/

# 2. Generated config has the right token
curl -sS $HOST/config.json
# Expected:
# {
#   "tyrBaseUrl": "/tyr",
#   "tyrToken": "<your TYR_TOKEN>"
# }

# 3. Proxy reaches upstream
curl -sS $HOST/tyr/health
# Expected: {"status":"ok","version":"0.7.x","db":"reachable"}

# 4. Authed proxy works
curl -sS -H "Authorization: Bearer <your TYR_TOKEN>" "$HOST/tyr/software?limit=2"
# Expected: {"results":[...],"next":null|"<cursor>"}
```

A green dot in the page header (top-right) is the equivalent visual check from a browser — it polls `/tyr/health` every 30s.

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Page loads, but the catalog spins forever and the health dot is red | nginx can reach itself but not titan-tyr — wrong `TYR_UPSTREAM`, or upstream down | `docker exec mimiron curl -sS $TYR_UPSTREAM/health` to confirm upstream reachability from inside the container |
| Browser console shows `401` on every API call | `TYR_TOKEN` is wrong or stale | `curl http://your-mimiron/config.json` to see what the SPA is using; restart the container to pick up a new env value |
| `proxy_pass: invalid URL` in nginx logs at startup | `TYR_UPSTREAM` was set to an empty string or malformed value | Ensure the var includes scheme (`http://` or `https://`) and no trailing slash |
| `502 Bad Gateway` on `/tyr/*` | titan-tyr is reachable from the host but not from inside the container — usually a `localhost` mistake | Use `host.docker.internal` (Docker Desktop), the compose service name, or the k8s service DNS — not `localhost` |
| Page loads but fonts / Vue fail to load | Browser can't reach `fonts.googleapis.com` / `cdn.jsdelivr.net` / `unpkg.com` | Either unblock those origins for end users, or mirror the assets locally (not implemented in v0.1.0) |
| `409` on every contract write | Stale browser tab still has old data; titan-tyr enforces strict-greater versioning | Refresh; mimiron is read-only so no real workflow hits this |

---

## Upgrades

Stateless image; just swap the tag and restart. No migrations, no warm-up, no graceful drain needed beyond nginx's normal connection handling.

```sh
docker pull titan-mimiron:0.2.0   # whatever new version
docker stop mimiron && docker rm mimiron
docker run -d --name mimiron ... titan-mimiron:0.2.0
```

If a new version changes the API contract with titan-tyr, the contract bump is recorded in titan-tyr (`GET /contracts/94def627-5073-4927-8d24-e5b992439062` — the mimiron↔tyr edge). Read the active version's markdown before assuming a deploy is forward-compatible.
