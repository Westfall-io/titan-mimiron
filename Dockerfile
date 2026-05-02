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

# Custom entrypoint shim that envsubst's config.json before nginx starts
COPY nginx/15-envsubst-config-json.sh /docker-entrypoint.d/15-envsubst-config-json.sh

# Defaults — override at `docker run -e TYR_UPSTREAM=... -e TYR_TOKEN=...`.
# TYR_UPSTREAM is the URL nginx proxies /tyr/* to.
# TYR_TOKEN is the bearer token the SPA puts on every authed request.
ENV TYR_UPSTREAM=http://localhost:8000
ENV TYR_TOKEN=sysmlv2

EXPOSE 80
