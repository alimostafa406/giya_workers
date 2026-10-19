"""Completion metadata for the EXISTING verification engine (no attendance rules)."""
from contextlib import contextmanager
from datetime import time
from functools import wraps
import os
import requests

CUTOFF = time(11)


def rpc(client, name, payload):
    response = requests.post(f'{client.base_url}/rest/v1/rpc/{name}',
                             headers=client.headers, json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def versions(client, target_date):
    # Fake clients explicitly implement this seam in completion tests.
    if hasattr(client, 'morning_input_versions'):
        return client.morning_input_versions(target_date)
    if not hasattr(client, 'base_url'):
        return None
    return rpc(client, 'agent_morning_input_versions', {'p_date': target_date.isoformat()})


def cutoff_pass(target_date, now):
    return target_date == now.date() and now.time().replace(tzinfo=None) >= CUTOFF


def complete_cutoff_run(run):
    proof = run.get('device_failure_summary', {}).get('cutoff_verification') or {}
    coverage = proof.get('coverage', [])
    return (run.get('status') == 'complete' and proof.get('reconciliation_complete') is True
            and proof.get('persistence_complete') is True and bool(coverage)
            and all(item.get('state') == 'complete' and item.get('query_end') == '11:00:00'
                    and item.get('segment_count', 0) > 0
                    and item.get('segments_complete') == item.get('segment_count')
                    for item in coverage))


@contextmanager
def processing(operation, date_from=None, date_to=None, *, identity=False, client=None):
    """Durable in-flight scope. Failed work stays blocking until a successful retry.

    Historical attendance-only work is date scoped; identity work affects today
    regardless of the request's date. Registration precedes device-lock waiting.
    """
    if client is None:
        url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        if not url or not key:
            # Read-only/offline tools have no production writer to fence.
            yield
            return
        from types import SimpleNamespace
        client = SimpleNamespace(base_url=url.rstrip('/'), headers={
            'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    if not hasattr(client, 'base_url'):
        yield {}
        return
    job = rpc(client, 'agent_morning_processing', {'p_id': None, 'p_operation': operation,
        'p_date_from': str(date_from) if date_from else None,
        'p_date_to': str(date_to or date_from) if date_from else None,
        'p_identity': identity, 'p_status': 'running', 'p_error': None})
    outcome = {}
    try:
        yield outcome
    except BaseException as error:
        rpc(client, 'agent_morning_processing', {'p_id': job, 'p_operation': operation,
            'p_date_from': None, 'p_date_to': None, 'p_identity': identity,
            'p_status': 'failed', 'p_error': type(error).__name__})
        raise
    else:
        rpc(client, 'agent_morning_processing', {'p_id': job, 'p_operation': operation,
            'p_date_from': None, 'p_date_to': None, 'p_identity': identity,
            'p_status': 'failed' if outcome.get('failed') else 'complete', 'p_error': outcome.get('failed')})


def tracked(operation, scope, *, enabled=lambda *args, **kwargs: True):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            if not enabled(*args, **kwargs):
                return function(*args, **kwargs)
            date_from, date_to, identity = scope(*args, **kwargs)
            with processing(operation, date_from, date_to, identity=identity) as outcome:
                result = function(*args, **kwargs)
                failed = (isinstance(result, tuple) and result[0] is False) or (
                    isinstance(result, dict) and (result.get('status') in {'failed', 'incomplete'}
                    or result.get('errors') or result.get('device_failures')
                    or result.get('write_results', {}).get('errors')))
                if failed and outcome is not None:
                    outcome['failed'] = f'{operation} incomplete'
                return result
        return wrapped
    return decorate
