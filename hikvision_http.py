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
TRANSIENT_EXCEPTIONS = (
    requests.exceptions.ConnectTimeout,
    requests.exceptions.ReadTimeout,
    requests.exceptions.ConnectionError,
    RemoteDisconnected,
)


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
                    # http.client.RemoteDisconnected is not a requests exception;
                    # normalize it so the scheduled agent cycle can handle it.
                    if isinstance(error, RemoteDisconnected):
                        raise requests.exceptions.ConnectionError('Hikvision disconnected during request') from error
                    raise
                print(
                    f'[HIKVISION] transient failure attempt {attempt}/{MAX_ATTEMPTS}: {type(error).__name__}',
                    file=sys.stderr,
                )
                self._reset_session()
                print(f'[HIKVISION] retrying in {RETRY_DELAY_SECONDS}s', file=sys.stderr)
                time.sleep(RETRY_DELAY_SECONDS)
        raise RuntimeError('Hikvision request retry loop ended unexpectedly')

    def close(self) -> None:
        self._reset_session()
