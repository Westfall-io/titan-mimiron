FROM nginx:1.27-alpine

COPY index.html style.css config.json /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Default upstream — overridable at `docker run -e TYR_UPSTREAM=...`.
# host.docker.internal works on Docker Desktop (Mac/Windows) and on Linux
# when run with `--add-host=host.docker.internal:host-gateway`.
ENV TYR_UPSTREAM=http://host.docker.internal:18000

EXPOSE 80
