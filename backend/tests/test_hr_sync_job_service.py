import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.hr_sync_job_service import _safe_error, configuration_status


class HrSyncJobServiceTest(unittest.TestCase):
    def test_configuration_requires_all_private_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            storage = root / "storage"
            storage.mkdir()
            (storage / "expense-requests").mkdir()
            key_file = root / "hr_app_key"
            key_file.write_text("base64:" + "a" * 44, encoding="utf-8")
            environment = {
                "HR_SYNC_DB_HOST": "mysql.example.internal",
                "HR_SYNC_DB_USER": "select_only",
                "HR_SYNC_DB_PASSWORD": "secret-value",
                "HR_SYNC_STORAGE_ROOT": str(storage),
                "HR_SYNC_APP_KEY_FILE": str(key_file),
                "HR_SYNC_FROM_DATE": "2026-01-01",
            }
            with patch.dict(os.environ, environment, clear=False), patch(
                "app.services.hr_sync_job_service.shutil.which",
                return_value="/usr/local/bin/pg_dump",
            ):
                status = configuration_status()
        self.assertTrue(status["ready"])
        self.assertTrue(all(status["checks"].values()))

    def test_configuration_does_not_accept_empty_placeholder_mounts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            storage = root / "storage"
            storage.mkdir()
            (storage / ".gitkeep").touch()
            key_file = root / "hr_app_key"
            key_file.touch()
            environment = {
                "HR_SYNC_DB_HOST": "mysql.example.internal",
                "HR_SYNC_DB_USER": "select_only",
                "HR_SYNC_DB_PASSWORD": "secret-value",
                "HR_SYNC_STORAGE_ROOT": str(storage),
                "HR_SYNC_APP_KEY_FILE": str(key_file),
            }
            with patch.dict(os.environ, environment, clear=False), patch(
                "app.services.hr_sync_job_service.shutil.which",
                return_value="/usr/local/bin/pg_dump",
            ):
                status = configuration_status()
        self.assertFalse(status["ready"])
        self.assertFalse(status["checks"]["storage_mounted"])
        self.assertFalse(status["checks"]["app_key_configured"])

    def test_errors_redact_hr_database_password(self) -> None:
        with patch.dict(os.environ, {"HR_SYNC_DB_PASSWORD": "do-not-leak"}):
            message = _safe_error(RuntimeError("failed with do-not-leak"))
        self.assertNotIn("do-not-leak", message)
        self.assertIn("[REDACTED]", message)


if __name__ == "__main__":
    unittest.main()
