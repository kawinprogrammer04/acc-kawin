import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
import zipfile

from app.routers.approvals import download_expense_request_attachments_archive


class _EmptyScalarResult:
    def scalars(self):
        return self

    def all(self):
        return []


class ExpenseAttachmentArchiveTest(unittest.IsolatedAsyncioTestCase):
    async def test_archive_uses_signed_files_and_downloads_every_attachment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original_primary = root / "primary-original.pdf"
            signed_primary = root / "primary-signed.pdf"
            supporting = root / "receipt.png"
            original_primary.write_bytes(b"original")
            signed_primary.write_bytes(b"signed")
            supporting.write_bytes(b"receipt")

            attachments = [
                SimpleNamespace(
                    file_name="เอกสารหลัก.pdf",
                    file_path=str(original_primary),
                    signed_file_path=str(signed_primary),
                ),
                SimpleNamespace(
                    file_name="ใบเสร็จ.png",
                    file_path=str(supporting),
                    signed_file_path=None,
                ),
            ]
            db = SimpleNamespace(execute=AsyncMock(return_value=_EmptyScalarResult()))
            request = SimpleNamespace(requester_user_id=42, request_no="ACC-EXP-001")

            with (
                patch("app.routers.approvals._get_company_row", AsyncMock(return_value=request)),
                patch("app.routers.approvals._request_attachments", AsyncMock(return_value=attachments)),
            ):
                response = await download_expense_request_attachments_archive(
                    "request-id",
                    db=db,
                    current_user=SimpleNamespace(id=42),
                    company=SimpleNamespace(id=7),
                )

            body = bytearray()
            async for chunk in response.body_iterator:
                body.extend(chunk)

            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                self.assertEqual(archive.namelist(), ["เอกสารหลัก.pdf", "ใบเสร็จ.png"])
                self.assertEqual(archive.read("เอกสารหลัก.pdf"), b"signed")
                self.assertEqual(archive.read("ใบเสร็จ.png"), b"receipt")

            self.assertEqual(response.media_type, "application/zip")
            self.assertIn("ACC-EXP-001-documents.zip", response.headers["content-disposition"])


if __name__ == "__main__":
    unittest.main()
