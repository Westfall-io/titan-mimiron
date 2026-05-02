#!/usr/bin/env python3
"""
Dev server for titan-mimiron.

Mirrors the production Dockerfile shape — serves static assets and proxies
/tyr/* to titan-tyr — so local iteration matches what runs in the image.

  python3 dev-server.py [--port 8765] [--tyr http://localhost:8000]

Honors the same env vars as the docker image:
  TYR_UPSTREAM  upstream titan-tyr URL                (default http://localhost:8000)
  TYR_TOKEN     bearer token written into config.json (default sysmlv2)

Then open http://localhost:8765/.
"""

from __future__ import annotations
import argparse
import http.server
import os
import pathlib
import socketserver
import string
import sys
import urllib.error
import urllib.request


PROXY_PREFIX = "/tyr/"


def render_config_json() -> None:
    template = pathlib.Path("config.json.template").read_text()
    body = string.Template(template).safe_substitute(
        TYR_TOKEN=os.environ.get("TYR_TOKEN", "sysmlv2"),
    )
    pathlib.Path("config.json").write_text(body)


def make_handler(tyr_base: str):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path.startswith(PROXY_PREFIX):
                self._proxy("GET")
            else:
                super().do_GET()

        def do_POST(self):  # noqa: N802
            if self.path.startswith(PROXY_PREFIX):
                self._proxy("POST")
            else:
                self.send_error(405)

        def do_PUT(self):  # noqa: N802
            if self.path.startswith(PROXY_PREFIX):
                self._proxy("PUT")
            else:
                self.send_error(405)

        def _proxy(self, method: str) -> None:
            upstream = f"{tyr_base}{self.path[len(PROXY_PREFIX) - 1:]}"
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            req = urllib.request.Request(upstream, data=body, method=method)
            for h in ("Authorization", "Content-Type", "Accept"):
                v = self.headers.get(h)
                if v:
                    req.add_header(h, v)
            try:
                with urllib.request.urlopen(req) as resp:
                    self._relay(resp)
            except urllib.error.HTTPError as e:
                self._relay(e)
            except urllib.error.URLError as e:
                self.send_error(502, f"upstream unreachable: {e.reason}")

        def _relay(self, resp) -> None:
            self.send_response(resp.status)
            for k, v in resp.headers.items():
                if k.lower() in ("transfer-encoding", "connection"):
                    continue
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(resp.read())

        def log_message(self, fmt, *args):
            sys.stderr.write(f"{self.address_string()} - {fmt % args}\n")

    return Handler


def main() -> None:
    default_tyr = os.environ.get("TYR_UPSTREAM", "http://localhost:8000")
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--tyr", default=default_tyr,
                   help=f"titan-tyr upstream (default: {default_tyr})")
    args = p.parse_args()

    render_config_json()

    tyr_base = args.tyr.rstrip("/")
    handler = make_handler(tyr_base)
    with socketserver.ThreadingTCPServer(("", args.port), handler) as httpd:
        print(f"titan-mimiron dev server")
        print(f"  static:  http://localhost:{args.port}/")
        print(f"  proxy:   http://localhost:{args.port}{PROXY_PREFIX}* -> {tyr_base}/*")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
