"""Compare legacy and shared-client read-only AcsEvent Digest authentication paths.

Run manually on the office laptop only. It reports no event data, credentials,
headers, or response bodies. The shared call uses the persistent successful
Digest session that the Attendance Agent uses for pagination.
"""

from __future__ import annotations

import argparse
from datetime import date as date_type

import requests

from hikvision_http import HikvisionReadClient
from hikvision_local_config import load_local_hikvision_config, require_local_settings


def payload_for(target_date: date_type) -> dict:
    return {
        'AcsEventCond': {
            'searchID': f'attendance-{target_date.isoformat()}',
            'searchResultPosition': 0,
            'maxResults': 30,
            'major': 0,
            'minor': 0,
            'startTime': f'{target_date.isoformat()}T00:00:00+01:00',
            'endTime': f'{target_date.isoformat()}T23:59:59+01:00',
        }
    }


def report(label: str, response: requests.Response | None, error: Exception | None) -> None:
    endpoint = '/ISAPI/AccessControl/AcsEvent?format=json'
    if response is not None:
        outcome = 'success' if response.status_code == 200 else 'failure'
        print(f'{label}: HTTP {response.status_code} | auth=HTTPDigestAuth | endpoint={endpoint} | {outcome}')
        return
    print(f'{label}: HTTP unavailable | auth=HTTPDigestAuth | endpoint={endpoint} | failure ({type(error).__name__})')


def main() -> int:
    parser = argparse.ArgumentParser(description='Compare legacy and shared Hikvision AcsEvent Digest authentication.')
    parser.add_argument('--date', default=date_type.today().isoformat(), help='Read-only event-search date (YYYY-MM-DD).')
    args = parser.parse_args()
    try:
        load_local_hikvision_config()
        require_local_settings('HIKVISION_DEVICE_IP', 'HIKVISION_USERNAME', 'HIKVISION_PASSWORD')
        target_date = date_type.fromisoformat(args.date)
    except (RuntimeError, ValueError) as error:
        print(f'Configuration failure: {type(error).__name__}')
        return 2

    client = HikvisionReadClient.from_environment()
    url = client.url('/ISAPI/AccessControl/AcsEvent?format=json')
    body = payload_for(target_date)
    try:
        legacy = requests.post(
            url,
            json=body,
            auth=client.new_digest_auth(),
            timeout=30,
        )
        report('legacy', legacy, None)
    except requests.RequestException as error:
        report('legacy', None, error)

    try:
        shared = client.request('POST', url, json=body, timeout=30)
        report('shared', shared, None)
    except requests.RequestException as error:
        report('shared', None, error)
    finally:
        client.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
