"""Dependency-free checks for local Hikvision configuration loading."""

import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hikvision_local_config


class LocalConfigTests(unittest.TestCase):
    def test_missing_file_identifies_expected_path(self):
        missing = Path('C:/missing/.env.hikvision_sync')
        with patch.object(hikvision_local_config, 'local_config_path', return_value=missing):
            with self.assertRaisesRegex(RuntimeError, re.escape(str(missing))):
                hikvision_local_config.load_local_hikvision_config()

    def test_file_loads_missing_values_without_overwriting_os_values(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / '.env.hikvision_sync'
            config.write_text('SUPABASE_URL=file-value\nHIKVISION_USERNAME=file-user\n', encoding='utf-8')
            with patch.dict(os.environ, {'SUPABASE_URL': 'os-value'}, clear=False):
                with patch.object(hikvision_local_config, 'local_config_path', return_value=config):
                    hikvision_local_config.load_local_hikvision_config()
                self.assertEqual(os.environ['SUPABASE_URL'], 'os-value')
                self.assertEqual(os.environ['HIKVISION_USERNAME'], 'file-user')


if __name__ == '__main__':
    unittest.main()
