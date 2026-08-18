"""Shared, dependency-free local configuration loader for Hikvision tools."""

from __future__ import annotations

import os
from pathlib import Path


PROJECT_DIRECTORY = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = PROJECT_DIRECTORY / '.env.hikvision_sync'


def local_config_path() -> Path:
    """Permit an explicit OS override while defaulting to the project config file."""
    configured_path = os.environ.get('HIKVISION_LOCAL_CONFIG_FILE', '').strip()
    return Path(configured_path).expanduser() if configured_path else DEFAULT_CONFIG_PATH


def load_local_hikvision_config() -> Path:
    """Load KEY=VALUE pairs without replacing already-set OS environment variables."""
    config_path = local_config_path()
    if not config_path.is_file():
        raise RuntimeError(f'Local Hikvision configuration file not found: {config_path}')

    try:
        lines = config_path.read_text(encoding='utf-8-sig').splitlines()
    except OSError as error:
        raise RuntimeError(f'Cannot read local Hikvision configuration file: {config_path}') from error

    for line in lines:
        item = line.strip()
        if not item or item.startswith('#') or '=' not in item:
            continue
        key, value = item.split('=', 1)
        key = key.strip()
        if key.startswith('export '):
            key = key.removeprefix('export ').strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value
    return config_path


def require_local_settings(*names: str) -> None:
    """Validate configuration by name only; never include values in an error."""
    for name in names:
        if not os.environ.get(name, '').strip():
            raise RuntimeError(f'Missing required local configuration variable: {name}')
