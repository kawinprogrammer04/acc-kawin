import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.commands.hr_production_bundle import (
    BUNDLE_VERSION,
    COMPANY_CODE,
    _allocate_user_ids,
    _remap_approvers,
    _verify_bundle,
)


class HrProductionBundleTests(unittest.TestCase):
    def test_allocate_user_ids_reuses_username_and_avoids_id_collision(self):
        users = [
            {"hr_user_id": 40, "username": "0102001"},
            {"hr_user_id": 53, "username": "0116004"},
            {"hr_user_id": 60, "username": "0109110"},
        ]

        mapping, reused, created = _allocate_user_ids(
            users,
            existing_by_username={"admin": 1, "0102001": 900},
            occupied_ids={1, 53, 900},
        )

        self.assertEqual(mapping["0102001"], 900)
        self.assertEqual(mapping["0116004"], 901)
        self.assertEqual(mapping["0109110"], 60)
        self.assertEqual(reused, ["0102001"])
        self.assertEqual(created, ["0116004", "0109110"])

    def test_remap_approvers_uses_production_user_id(self):
        source = [{
            "user_id": 40,
            "username": "0102001",
            "name": "Approver",
            "status": "approved",
        }]

        result = _remap_approvers(source, {"0102001": 900})

        self.assertEqual(result, [{
            "user_id": 900,
            "name": "Approver",
            "status": "approved",
        }])
        self.assertEqual(source[0]["user_id"], 40)

    def test_verify_bundle_rejects_changed_sensitive_file(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            manifest = {
                "bundle_version": BUNDLE_VERSION,
                "bundle_id": "00000000-0000-0000-0000-000000000001",
                "source_created_at": "2026-08-18T00:00:00+00:00",
                "company_code": COMPANY_CODE,
                "counts": {"users": 0},
                "assets": {},
                "data": {"users": []},
            }
            manifest_path = tmp_path / "manifest.json"
            secrets_path = tmp_path / "secrets.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            secrets_path.write_text("{}", encoding="utf-8")
            sums = []
            for path in (manifest_path, secrets_path):
                sums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
            (tmp_path / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")

            loaded_manifest, loaded_secrets, _ = _verify_bundle(tmp_path)
            self.assertEqual(loaded_manifest["bundle_id"], manifest["bundle_id"])
            self.assertEqual(loaded_secrets, {})

            secrets_path.write_text('{"changed": true}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "checksum failed"):
                _verify_bundle(tmp_path)
