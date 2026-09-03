"""Small, read-only resilient HTTP client for local Hikvision ISAPI calls."""

from __future__ import annotations

import os
import sys
import time
from http.client import RemoteDisconnected

import requests
from requests.auth import HTTPDigestAuth


MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2
HIKVISION_CONNECT_TIMEOUT_SECONDS = 5
HIKVISION_READ_TIMEOUT_SECONDS = 20
HIKVISION_REQUEST_TIMEOUT = (HIKVISION_CONNECT_TIMEOUT_SECONDS, HIKVISION_READ_TIMEOUT_SECONDS)
HIKVISION_PROBE_TIMEOUT = (3, 5)
TRANSIENT_EXCEPTIONS = (
    requests.exceptions.ConnectTimeout,
    requests.exceptions.ReadTimeout,
    requests.exceptions.ConnectionError,
    RemoteDisconnected,
)


def _write_diagnostic(message: str) -> None:
    """Best-effort diagnostics that remain safe under windowless pythonw."""
    stream = sys.stderr
    if stream is None:
        return
    try:
        print(message, file=stream)
    except (AttributeError, OSError, ValueError):
        # Transport handling must never fail merely because the scheduled task
        # has no usable console stream.
        return


def _required_env(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'Missing required local configuration variable: {name}')
    return value


def _contains_transient_exception(error: BaseException) -> bool:
    """Requests may wrap RemoteDisconnected in a ConnectionError cause/context."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, TRANSIENT_EXCEPTIONS):
            return True
        current = current.__cause__ or current.__context__
    return False


def _bounded_timeout(value) -> tuple[float, float]:
    """Always provide Requests with explicit connect and read deadlines."""
    if isinstance(value, (tuple, list)) and len(value) == 2:
        connect_timeout, read_timeout = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        connect_timeout, read_timeout = HIKVISION_CONNECT_TIMEOUT_SECONDS, value
    else:
        connect_timeout, read_timeout = HIKVISION_REQUEST_TIMEOUT
    connect_timeout = float(connect_timeout)
    read_timeout = float(read_timeout)
    if connect_timeout <= 0 or read_timeout <= 0:
        return HIKVISION_REQUEST_TIMEOUT
    return connect_timeout, read_timeout


class HikvisionReadClient:
    """Retries read-only transport failures without discarding a successful Digest session."""

    def __init__(self, device_ip: str, username: str, password: str, device_id: str | None = None) -> None:
        self.device_ip = device_ip
        self.device_id = device_id or device_ip
        self._username = username
        self._password = password
        self._session: requests.Session | None = None

    @classmethod
    def from_environment(cls) -> 'HikvisionReadClient':
        return cls(
            _required_env('HIKVISION_DEVICE_IP'),
            _required_env('HIKVISION_USERNAME'),
            _required_env('HIKVISION_PASSWORD'),
        )

    def url(self, path: str) -> str:
        return f'http://{self.device_ip}{path}'

    def _new_session(self) -> requests.Session:
        session = requests.Session()
        session.auth = self.new_digest_auth()
        return session

    def new_digest_auth(self) -> HTTPDigestAuth:
        """Return a fresh Digest handler without exposing credentials to callers."""
        return HTTPDigestAuth(self._username, self._password)

    def _reset_session(self) -> None:
        if self._session is not None:
            self._session.close()
        self._session = None

    def refresh_digest_session(self) -> None:
        """Discard only a stale authenticated session before one explicit re-auth retry."""
        self._reset_session()

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        kwargs['timeout'] = _bounded_timeout(kwargs.get('timeout'))
        for attempt in range(1, MAX_ATTEMPTS + 1):
            # Attach Digest authentication before the request, just like the
            # working requests.post(..., auth=HTTPDigestAuth(...)) path. Keep a
            # successfully challenged session for later pagination batches.
            if self._session is None:
                self._session = self._new_session()
            try:
                return self._session.request(method, url, **kwargs)
            except Exception as error:
                transient = _contains_transient_exception(error)
                if not transient:
                    raise
                if attempt == MAX_ATTEMPTS:
                    _write_diagnostic(
                        f'[HIKVISION] device={self.device_id} ip={self.device_ip} '
                        f'request failed after {MAX_ATTEMPTS} bounded attempts: {type(error).__name__}'
                    )
                    # http.client.RemoteDisconnected is not a requests exception;
                    # normalize it so the scheduled agent cycle can handle it.
                    if isinstance(error, RemoteDisconnected):
                        raise requests.exceptions.ConnectionError('Hikvision disconnected during request') from error
                    raise
                _write_diagnostic(
                    f'[HIKVISION] device={self.device_id} ip={self.device_ip} '
                    f'transient failure attempt {attempt}/{MAX_ATTEMPTS}: {type(error).__name__}'
                )
                self._reset_session()
                _write_diagnostic(f'[HIKVISION] retrying in {RETRY_DELAY_SECONDS}s')
                time.sleep(RETRY_DELAY_SECONDS)
        raise RuntimeError('Hikvision request retry loop ended unexpectedly')

    def close(self) -> None:
        self._reset_session()
