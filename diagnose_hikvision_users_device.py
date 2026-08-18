"""Read-only first-page diagnostic for one configured Hikvision device."""

from __future__ import annotations

import argparse
from urllib.parse import urlparse

import requests

from hikvision_devices import configured_devices
from hikvision_http import HikvisionReadClient
from hikvision_local_config import load_local_hikvision_config


def safe_error(error: Exception) -> str:
    response = getattr(error, 'response', None)
    if response is not None:
        return f'{type(error).__name__} (HTTP {response.status_code})'
    return type(error).__name__


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only Hikvision UserInfo/Search diagnostic.')
    parser.add_argument('--device', required=True, help='Configured device ID, e.g. office-secondary.')
    args = parser.parse_args()
    try:
        load_local_hikvision_config()
        device = next(item for item in configured_devices() if item.device_id == args.device)
    except StopIteration:
        print(f'device_id={args.device}\nerror=device_not_configured')
        return 2
    except RuntimeError as error:
        print(f'device_id={args.device}\nerror={error}')
        return 2

    client = HikvisionReadClient(device.ip, device.username, device.password, device.device_id)
    url = client.url('/ISAPI/AccessControl/UserInfo/Search?format=json')
    payload = {'UserInfoSearchCond': {'searchID': 'diagnostic-user-search', 'searchResultPosition': 0, 'maxResults': 10}}
    try:
        response = client.request('POST', url, json=payload, timeout=30)
        print(f'device_id={device.device_id}')
        print(f'host={urlparse(url).hostname}')
        print(f'http_status={response.status_code}')
        if not response.ok:
            print('error=http_error')
            return 1
        result = response.json().get('UserInfoSearch', {})
        total = result.get('totalMatches', result.get('userNumber', 'not_returned'))
        print(f'total_matches={total}')
        users = result.get('UserInfo') or []
        if isinstance(users, dict):
            users = [users]
        for index, user in enumerate(users[:3], start=1):
            employee_no = str(user.get('employeeNo') or user.get('employeeNoString') or '').strip()
            name = str(user.get('name') or '').strip()
            print(f'user_{index}={employee_no} | {name}')
        return 0
    except (requests.RequestException, ValueError) as error:
        print(f'device_id={device.device_id}')
        print(f'host={urlparse(url).hostname}')
        print(f'error={safe_error(error)}')
        return 1
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
