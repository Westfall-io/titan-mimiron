FROM nginx:1.27-alpine

ARG VERSION=dev
LABEL org.opencontainers.image.title="titan-mimiron"
LABEL org.opencontainers.image.description="WatcherVault Web UI — read-only browser for software and contracts"
LABEL org.opencontainers.image.source="https://github.com/Westfall-io/titan-mimiron"
LABEL org.opencontainers.image.version="${VERSION}"

# Static SPA assets
COPY index.html style.css /usr/share/nginx/html/
COPY config.json.template /usr/share/nginx/html/config.json.template
COPY src /usr/share/nginx/html/src

# Nginx config template (envsubst-processed by alpine entrypoint into /etc/nginx/conf.d/)
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Custom entrypoint shims (run by alpine's docker-entrypoint chain in
# numeric order). 12 loads TYR_TOKEN from a K8s init-container handoff
# file at /handoff/TITAN_TYR_TOKEN if present (no-op in compose/dev);
# 15 envsubst's the resulting TYR_TOKEN into config.json so the SPA
# picks it up at first fetch. See titan-mimiron#58 / titan-archaedas#7.
# The `.envsh` extension on 12 is load-bearing — alpine's entrypoint
# sources .envsh into the parent shell so the export propagates, but
# executes .sh in a subprocess where exports die.
COPY nginx/12-load-handoff-token.envsh /docker-entrypoint.d/12-load-handoff-token.envsh
COPY nginx/15-envsubst-config-json.sh /docker-entrypoint.d/15-envsubst-config-json.sh

# Defaults — override at `docker run -e TYR_UPSTREAM=... -e TYR_TOKEN=...`.
# TYR_UPSTREAM is the URL nginx proxies /tyr/* to.
# TYR_TOKEN is the bearer token the SPA puts on every authed request.
ENV TYR_UPSTREAM=http://localhost:8000
ENV TYR_TOKEN=sysmlv2

EXPOSE 80
