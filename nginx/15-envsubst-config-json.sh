#!/bin/sh
# Substitute container env vars into config.json so the SPA picks them
# up at first fetch. Runs before nginx via the alpine entrypoint chain.
set -e

: "${TYR_TOKEN:=sysmlv2}"
export TYR_TOKEN

envsubst '${TYR_TOKEN}' \
  < /usr/share/nginx/html/config.json.template \
  > /usr/share/nginx/html/config.json
