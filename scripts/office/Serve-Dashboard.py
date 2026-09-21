"""Pythonw-safe loopback server for the built local React dashboard."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from hikvision_agent_control import AgentControl, AgentControlError


def configure_logger(dist: Path) -> logging.Logger:
    """Log to a real file only; pythonw.exe may provide no stdout/stderr."""
    logger = logging.getLogger('office_dashboard_server')
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logs_dir = dist.parent / 'logs'
    logs_dir.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(logs_dir / 'office-dashboard-server.log', encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    logger.addHandler(handler)
    return logger


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, request_handler, logger: logging.Logger, controller):
        self.logger = logger
        self.controller = controller
        super().__init__(address, request_handler)

    def handle_error(self, request, client_address):
        # BaseServer would print to sys.stderr, which can be None under pythonw.
        self.logger.exception('Unhandled dashboard request error from %s', client_address)

    def server_close(self):
        super().server_close()
        for handler in list(self.logger.handlers):
            handler.close()
            self.logger.removeHandler(handler)


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, logger: logging.Logger, **kwargs):
        self.dashboard_logger = logger
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format, *args):
        """Never use SimpleHTTPRequestHandler's sys.stderr-based logger."""
        self.dashboard_logger.info('%s - %s', self.client_address[0], format % args)

    def _send_health(self):
        body = b'OK\n'
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def _is_loopback_request(self):
        return self.client_address[0] in {'127.0.0.1', '::1'}

    def _read_json(self):
        content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        if content_type != 'application/json' or self.headers.get('X-Agent-Control') != 'local-dashboard':
            raise AgentControlError('Invalid local control request.')
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).hostname not in {'127.0.0.1', 'localhost', '::1'}:
            raise AgentControlError('Request origin is not allowed.')
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError as error:
            raise AgentControlError('Invalid request length.') from error
        if length < 0 or length > 16_384:
            raise AgentControlError('Request length is not allowed.')
        try:
            value = json.loads(self.rfile.read(length) or b'{}')
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise AgentControlError('Invalid request data.') from error
        if not isinstance(value, dict):
            raise AgentControlError('Invalid request data.')
        return value

    def _handle_api_get(self, requested_path: str):
        if requested_path != '/api/agent-control/status':
            return False
        if not self._is_loopback_request():
            self._send_json(403, {'error': 'Local access only.'})
            return True
        self._send_json(200, self.server.controller.status())
        return True

    def do_POST(self):
        try:
            if not self._is_loopback_request():
                self._send_json(403, {'error': 'Local access only.'})
                return
            if urlparse(self.path).path != '/api/agent-control/action':
                self._send_json(404, {'error': 'Not found.'})
                return
            result = self.server.controller.control_agent(str(self._read_json().get('action') or ''))
            self._send_json(200, result)
        except AgentControlError as error:
            self._send_json(400, {'error': str(error)})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self.dashboard_logger.exception('Agent control request failed: path=%s', self.path)
            self._send_json(500, {'error': 'Unable to complete the local action.'})

    def do_GET(self):
        try:
            requested_path = urlparse(self.path).path
            if requested_path == '/__health':
                self._send_health()
                return
            if self._handle_api_get(requested_path):
                return
            candidate = Path(self.translate_path(requested_path))
            relative = requested_path.lstrip('/')
            if not candidate.is_file():
                if Path(relative).suffix or relative.startswith('assets/'):
                    self.send_error(404, 'File not found')
                    return
                self.path = '/index.html'
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self.dashboard_logger.exception('Dashboard request failed: path=%s', self.path)
            try:
                self.send_error(500, 'Local dashboard request failed')
            except (BrokenPipeError, ConnectionResetError):
                pass


def create_server(dist: Path, host: str = '127.0.0.1', port: int = 4173) -> DashboardServer:
    dist = dist.resolve()
    if not (dist / 'index.html').is_file():
        raise RuntimeError(f'Dashboard build is missing: {dist / "index.html"}')
    logger = configure_logger(dist)
    handler = partial(DashboardHandler, directory=str(dist), logger=logger)
    server = DashboardServer((host, port), handler, logger, AgentControl())
    logger.info('Dashboard server started: http://%s:%s dist=%s', host, server.server_port, dist)
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description='Serve built dashboard on loopback only.')
    parser.add_argument('--dist', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args()
    server = create_server(Path(args.dist), args.host, args.port)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
