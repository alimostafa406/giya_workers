"""Durable processing ownership, heartbeats and conservative orphan recovery.

The service-role recovery RPC independently requires a later successful same-scope
retry. Silence alone never proves death. OS access failures fail closed.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import ctypes
from ctypes import wintypes
import logging
import os
import socket
import threading
import uuid

LOG = logging.getLogger(__name__)
EXECUTION_ID = str(uuid.uuid4())
HOST = socket.gethostname()
_MANAGERS = {}
_MANAGER_LOCK = threading.Lock()


def process_token(pid):
    """Windows process creation FILETIME; None means exited, errors mean unknown."""
    if os.name != 'nt':
        raise OSError('Process death checks require Windows process creation identity')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetProcessTimes.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, int(pid))
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # invalid parameter: PID no longer exists
            return None
        raise OSError(error, 'Cannot inspect process')
    try:
        created, exited, kernel_time, user_time = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited),
                                      ctypes.byref(kernel_time), ctypes.byref(user_time)):
            raise ctypes.WinError(ctypes.get_last_error())
        if exited.dwHighDateTime or exited.dwLowDateTime:
            return None
        return str((created.dwHighDateTime << 32) | created.dwLowDateTime)
    finally:
        kernel.CloseHandle(handle)


class ProcessingLifecycle:
    def __init__(self, client, rpc, *, background=True):
        self.client, self.rpc = client, rpc
        self.execution_id = EXECUTION_ID
        self.pid, self.host = os.getpid(), HOST
        self.token = process_token(self.pid) if os.name == 'nt' else 'unsupported'
        self.active = set()
        self.pending = {}
        self.lock = threading.RLock()
        self.stop = threading.Event()
        if background:
            threading.Thread(target=self._loop, name='morning-processing-heartbeat', daemon=True).start()

    def _call(self, name, payload):
        return self.rpc(self.client, name, payload)

    def _loop(self):
        while not self.stop.wait(30):
            try:
                self.tick()
            except Exception:
                LOG.exception('Processing heartbeat/recovery failed; records remain blocking')

    def tick(self):
        # Registration and heartbeat snapshots share the same lock. Never attest
        # absence while an operation is registering, working, or finishing.
        with self.lock:
            active = sorted(self.active)
            if active:
                self._call('agent_morning_processing_heartbeat', {
                    'p_execution_id': self.execution_id, 'p_job_ids': active})
            for job, payload in list(self.pending.items()):
                try:
                    self._call('agent_morning_processing_finish', payload)
                except Exception:
                    LOG.warning('Processing terminal acknowledgement still pending: %s', job)
                else:
                    self.pending.pop(job, None)
            candidates = self._call('agent_morning_processing_candidates', {'p_host': self.host})
            if not isinstance(candidates, list):
                return
            for job in candidates:
                if job['id'] in self.active:
                    continue
                evidence = self.inactivity_evidence(job)
                if evidence:
                    self._call('agent_recover_morning_processing', {
                        'p_id': job['id'], 'p_evidence': evidence})

    def inactivity_evidence(self, job):
        if job.get('owner_host') != self.host or not job.get('owner_execution_id'):
            return None  # legacy jobs require explicit audited log evidence
        if job['owner_execution_id'] == self.execution_id:
            if job['id'] in self.active:
                return None
            kind = 'owner_execution_inactive'
            token = self.token
        else:
            try:
                token = process_token(job['owner_pid'])
            except OSError:
                return None
            if token == job.get('owner_process_token'):
                return None
            kind = 'owner_process_exited'
        return {
            'kind': kind, 'observer_host': self.host, 'observer_execution_id': self.execution_id,
            'owner_execution_id': job['owner_execution_id'], 'owner_pid': job['owner_pid'],
            'owner_process_token': job['owner_process_token'],
            'observed_process_token': token,
            'confirmed_execution_inactive': True,
            'observed_at': datetime.now(timezone.utc).isoformat(),
        }

    @contextmanager
    def processing(self, operation, date_from=None, date_to=None, identity=False):
        job = str(uuid.uuid4())
        with self.lock:
            self.active.add(job)  # precedes any potentially ambiguous RPC response
            try:
                self._call('agent_morning_processing_begin', {
                    'p_id': job, 'p_operation': operation,
                    'p_date_from': str(date_from) if date_from else None,
                    'p_date_to': str(date_to or date_from) if date_from else None,
                    'p_identity': identity, 'p_execution_id': self.execution_id,
                    'p_host': self.host, 'p_pid': self.pid, 'p_process_token': self.token,
                })
            except BaseException:
                self.active.remove(job)
                # A timeout may have committed registration. Future candidates
                # can prove this UUID is no longer active in this execution.
                raise
        outcome = {}
        status, error = 'complete', None
        try:
            yield outcome
            if outcome.get('failed'):
                status, error = 'failed', outcome['failed']
        except BaseException as failure:
            status, error = 'failed', f'{type(failure).__name__}: {failure}'
            raise
        finally:
            payload = {'p_id': job, 'p_execution_id': self.execution_id,
                       'p_status': status, 'p_error': error}
            with self.lock:
                # Retain the exact terminal outcome until acknowledged. Never
                # convert a failed operation into success during recovery.
                self.pending[job] = payload
                try:
                    self._call('agent_morning_processing_finish', payload)
                except Exception:
                    LOG.exception('Processing terminal state queued for retry: job=%s status=%s', job, status)
                else:
                    self.pending.pop(job, None)
                finally:
                    self.active.remove(job)


def managed_processing(client, rpc, operation, date_from, date_to, identity):
    key = client.base_url
    with _MANAGER_LOCK:
        manager = _MANAGERS.get(key)
        if manager is None:
            manager = ProcessingLifecycle(client, rpc, background=key.endswith('.supabase.co'))
            _MANAGERS[key] = manager
        else:
            manager.rpc = rpc
    return manager.processing(operation, date_from, date_to, identity)
