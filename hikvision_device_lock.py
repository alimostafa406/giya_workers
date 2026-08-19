"""Cross-process, per-device coordination for expensive Hikvision reads.

The attendance Agent and loopback Helper are separate Windows processes.  This
module combines an in-process threading lock with an OS byte-range file lock so
one device's long pagination cannot overlap another long pagination elsewhere.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import threading
import time
from contextlib import AbstractContextManager
from pathlib import Path


DEFAULT_TIMEOUT_SECONDS = 120.0
POLL_SECONDS = 0.2
_THREAD_LOCKS: dict[str, threading.Lock] = {}
_THREAD_LOCKS_GUARD = threading.Lock()


class HikvisionDeviceLockTimeout(RuntimeError):
    """Raised when a high-volume device operation cannot be serialized safely."""


def _safe_device_key(device_id: str) -> str:
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', str(device_id).strip() or 'unknown-device')


def _thread_lock(device_id: str) -> threading.Lock:
    with _THREAD_LOCKS_GUARD:
        return _THREAD_LOCKS.setdefault(_safe_device_key(device_id), threading.Lock())


def _lock_directory() -> Path:
    configured = os.environ.get('HIKVISION_DEVICE_LOCK_DIR', '').strip()
    directory = Path(configured) if configured else Path(tempfile.gettempdir()) / 'workers_hikvision_device_locks'
    directory.mkdir(parents=True, exist_ok=True)
    return directory


class HikvisionDeviceOperationLock(AbstractContextManager):
    """Serialize one high-volume operation for one device across processes."""

    def __init__(self, device_id: str, operation: str, timeout_seconds: float | None = None, *, lock_dir: Path | None = None) -> None:
        self.device_id = str(device_id)
        self.operation = operation
        self.timeout_seconds = timeout_seconds if timeout_seconds is not None else self._configured_timeout()
        self.lock_dir = lock_dir
        self._thread_lock = _thread_lock(self.device_id)
        self._file = None
        self._acquired = False
        self._waited = False

    @staticmethod
    def _configured_timeout() -> float:
        try:
            return max(1.0, float(os.environ.get('HIKVISION_DEVICE_LOCK_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS)))
        except ValueError:
            return DEFAULT_TIMEOUT_SECONDS

    def _path(self) -> Path:
        directory = self.lock_dir or _lock_directory()
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f'{_safe_device_key(self.device_id)}.lock'

    @staticmethod
    def _try_file_lock(file_handle) -> bool:
        if os.name == 'nt':
            import msvcrt
            file_handle.seek(0)
            try:
                msvcrt.locking(file_handle.fileno(), msvcrt.LK_NBLCK, 1)
                return True
            except OSError:
                return False
        import fcntl
        try:
            fcntl.flock(file_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False

    @staticmethod
    def _unlock_file(file_handle) -> None:
        if os.name == 'nt':
            import msvcrt
            file_handle.seek(0)
            msvcrt.locking(file_handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(file_handle.fileno(), fcntl.LOCK_UN)

    def __enter__(self):
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self._thread_lock.acquire(timeout=min(POLL_SECONDS, max(0.0, remaining))):
                if not self._waited:
                    print(f'[HIKVISION] {self.device_id} waiting for device lock: {self.operation}', file=sys.stderr)
                    self._waited = True
                if time.monotonic() >= deadline:
                    raise HikvisionDeviceLockTimeout(
                        f'{self.device_id} device lock timed out while waiting for {self.operation}'
                    )
                continue
            try:
                self._file = self._path().open('a+b')
                self._file.seek(0, os.SEEK_END)
                if self._file.tell() == 0:
                    self._file.write(b'0')
                    self._file.flush()
                if self._try_file_lock(self._file):
                    self._acquired = True
                    if self._waited:
                        print(f'[HIKVISION] {self.device_id} device lock acquired: {self.operation}', file=sys.stderr)
                    return self
            finally:
                if not self._acquired:
                    if self._file is not None:
                        self._file.close()
                        self._file = None
                    self._thread_lock.release()
            if not self._waited:
                print(f'[HIKVISION] {self.device_id} waiting for device lock: {self.operation}', file=sys.stderr)
                self._waited = True
            if time.monotonic() >= deadline:
                raise HikvisionDeviceLockTimeout(
                    f'{self.device_id} device lock timed out while waiting for {self.operation}'
                )
            time.sleep(POLL_SECONDS)

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        try:
            if self._acquired and self._file is not None:
                self._unlock_file(self._file)
        finally:
            if self._file is not None:
                self._file.close()
                self._file = None
            if self._acquired:
                self._thread_lock.release()
                self._acquired = False
                if self._waited:
                    print(f'[HIKVISION] {self.device_id} device lock released: {self.operation}', file=sys.stderr)
        return False
