"""Shared multi-device registry; old HIKVISION_DEVICE_IP settings remain supported."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class HikvisionDevice:
    device_id: str
    ip: str
    username: str
    password: str


def configured_devices() -> list[HikvisionDevice]:
    indexes = sorted({int(match.group(1)) for key in os.environ for match in [re.fullmatch(r'HIKVISION_DEVICE_(\d+)_IP', key)] if match})
    devices = []
    for index in indexes:
        prefix = f'HIKVISION_DEVICE_{index}_'
        ip = os.environ.get(f'{prefix}IP', '').strip()
        username = os.environ.get(f'{prefix}USERNAME', '').strip()
        password = os.environ.get(f'{prefix}PASSWORD', '').strip()
        device_id = os.environ.get(f'{prefix}ID', f'device-{index}').strip() or f'device-{index}'
        if not ip or not username or not password:
            missing = next(name for name, value in ((f'{prefix}IP', ip), (f'{prefix}USERNAME', username), (f'{prefix}PASSWORD', password)) if not value)
            raise RuntimeError(f'Missing required local configuration variable: {missing}')
        devices.append(HikvisionDevice(device_id, ip, username, password))
    if devices:
        if len({device.device_id for device in devices}) != len(devices):
            raise RuntimeError('Hikvision device IDs must be unique.')
        return devices
    ip = os.environ.get('HIKVISION_DEVICE_IP', '').strip()
    username = os.environ.get('HIKVISION_USERNAME', '').strip()
    password = os.environ.get('HIKVISION_PASSWORD', '').strip()
    if not ip or not username or not password:
        missing = next(name for name, value in (('HIKVISION_DEVICE_IP', ip), ('HIKVISION_USERNAME', username), ('HIKVISION_PASSWORD', password)) if not value)
        raise RuntimeError(f'Missing required local configuration variable: {missing}')
    return [HikvisionDevice(os.environ.get('HIKVISION_DEVICE_ID', 'office-main'), ip, username, password)]
