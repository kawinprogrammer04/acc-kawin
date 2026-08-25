import base64
import hashlib
import hmac
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

from app.commands.hr_incremental_sync import (
    _attachment_uuid,
    _request_number_conflicts,
    _request_uuid,
    _source_path,
    SourceSnapshot,
    decrypt_laravel_value,
)


def _laravel_encrypt(plaintext: str, key: bytes, iv: bytes) -> str:
    padder = PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(plaintext.encode()) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    encrypted = encryptor.update(padded) + encryptor.finalize()
    iv_text = base64.b64encode(iv).decode()
    value_text = base64.b64encode(encrypted).decode()
    mac = hmac.new(key, (iv_text + value_text).encode(), hashlib.sha256).hexdigest()
    payload = {"iv": iv_text, "value": value_text, "mac": mac, "tag": ""}
    return base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()


class HrIncrementalSyncHelpersTest(unittest.TestCase):
    def test_decrypt_laravel_encrypted_cast(self) -> None:
        key = bytes(range(32))
        encrypted = _laravel_encrypt("012-345-6789", key, bytes(range(16)))
        self.assertEqual(decrypt_laravel_value(encrypted, key), "012-345-6789")

    def test_decrypt_rejects_tampered_payload(self) -> None:
        key = bytes(range(32))
        encrypted = _laravel_encrypt("0123456789", key, bytes(range(16)))
        payload = json.loads(base64.b64decode(encrypted))
        payload["mac"] = "0" * 64
        tampered = base64.b64encode(json.dumps(payload).encode()).decode()
        with self.assertRaisesRegex(ValueError, "verify HR_SYNC_APP_KEY"):
            decrypt_laravel_value(tampered, key)

    def test_source_path_stays_under_private_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expense-requests" / "1" / "document.pdf"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"pdf")
            self.assertEqual(
                _source_path(root, "expense-requests/1/document.pdf"), source
            )
            with self.assertRaisesRegex(ValueError, "unsafe HR storage path"):
                _source_path(root, "../secret")

    def test_ids_match_the_existing_import_contract(self) -> None:
        self.assertEqual(
            _request_uuid(13868), "4e622bdc-5cfb-d096-378d-479044dd5135"
        )
        self.assertEqual(
            _attachment_uuid(369, 13868, "attachment"),
            "b9b57c93-77fb-4cae-8f25-87225297ccbe",
        )
        self.assertEqual(
            _attachment_uuid(None, 13868, "request_document"),
            "6c813b66-e1ac-528e-b653-0ba5c9dfbd83",
        )

    def test_native_acc_request_number_collision_is_reported(self) -> None:
        snapshot = SourceSnapshot(
            from_date=date(2026, 1, 1),
            created_at=datetime.now(timezone.utc),
            users=[], positions=[], items=[], attachments=[], approvals=[],
            requests=[{
                "hr_expense_request_id": 13900,
                "request_number": "EXP-202608-013900",
                "purpose": "ค่าเดินทางฝ่ายขาย",
            }],
        )
        conflicts = _request_number_conflicts(snapshot, [{
            "id": "08c1dbaa-56fc-433f-9dff-d16929e61c82",
            "request_no": "EXP-202608-013900",
            "title": "ซื้ออุปกรณ์สำนักงาน",
            "status": "ready_to_pay",
            "mapped_hr_expense_request_id": None,
        }])
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["request_no"], "EXP-202608-013900")
        self.assertEqual(conflicts[0]["acc_status"], "ready_to_pay")

    def test_correctly_mapped_hr_request_is_not_a_collision(self) -> None:
        snapshot = SourceSnapshot(
            from_date=date(2026, 1, 1),
            created_at=datetime.now(timezone.utc),
            users=[], positions=[], items=[], attachments=[], approvals=[],
            requests=[{
                "hr_expense_request_id": 13900,
                "request_number": "EXP-202608-013900",
                "purpose": "ค่าเดินทางฝ่ายขาย",
            }],
        )
        conflicts = _request_number_conflicts(snapshot, [{
            "id": _request_uuid(13900),
            "request_no": "EXP-202608-013900",
            "title": "ค่าเดินทางฝ่ายขาย",
            "status": "pending_approval",
            "mapped_hr_expense_request_id": 13900,
        }])
        self.assertEqual(conflicts, [])


if __name__ == "__main__":
    unittest.main()
