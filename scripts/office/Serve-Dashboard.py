"""Small production-only static server for the built local dashboard."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        requested = urlparse(self.path).path.lstrip('/')
        if requested and not (Path(self.directory) / requested).is_file():
            self.path = '/index.html'
        return super().do_GET()


def main() -> int:
    parser = argparse.ArgumentParser(description='Serve built dashboard on loopback only.')
    parser.add_argument('--dist', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args()
    dist = Path(args.dist).resolve()
    if not (dist / 'index.html').is_file():
        raise SystemExit(f'Dashboard build is missing: {dist / "index.html"}')
    handler = lambda *handler_args, **handler_kwargs: DashboardHandler(*handler_args, directory=str(dist), **handler_kwargs)
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
