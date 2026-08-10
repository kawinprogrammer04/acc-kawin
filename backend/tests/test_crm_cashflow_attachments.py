import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import gettempdir
from unittest.mock import AsyncMock
from uuid import uuid4

from app.models.crm_cashflow import CrmCashflowStatement, CrmCashflowStatementAttachment
from app.routers.crm_cashflow import ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, delete_attachment


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _Company:
    id = 5


class CrmCashflowAttachmentRulesTests(unittest.TestCase):
    def test_allowed_attachment_types(self):
        self.assertIn("image/jpeg", ALLOWED_ATTACHMENT_TYPES)
        self.assertIn("image/png", ALLOWED_ATTACHMENT_TYPES)
        self.assertIn("application/pdf", ALLOWED_ATTACHMENT_TYPES)

    def test_disallowed_types_rejected(self):
        self.assertNotIn("text/plain", ALLOWED_ATTACHMENT_TYPES)
        self.assertNotIn("application/x-msdownload", ALLOWED_ATTACHMENT_TYPES)
        self.assertNotIn("text/html", ALLOWED_ATTACHMENT_TYPES)

    def test_max_attachment_byte_size_is_10mb(self):
        # 10 MB = 10 * 1024 * 1024 bytes
        self.assertEqual(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024)


class CrmCashflowAttachmentDeleteTests(unittest.IsolatedAsyncioTestCase):
    async def test_deleting_last_attachment_keeps_statement_document_type(self):
        statement = CrmCashflowStatement(
            cfstate_id=1,
            comp_id=5,
            cfstate_status=1,
            cfstate_date=date(2026, 8, 10),
            cfcat_id=1,
            cflist_id=1,
            user_id=1,
            cfstate_amount=Decimal("-100.00"),
            cfstate_refrain=1,
            cfstate_invoice=0,
            cfstate_document_type="cash_bill",
            cfstate_verified=0,
        )
        attachment = CrmCashflowStatementAttachment(
            id=uuid4(),
            cfstate_id=1,
            comp_id=5,
            file_name="bill.pdf",
            stored_name="bill.pdf",
            file_path=str(Path(gettempdir()) / f"missing-{uuid4()}.pdf"),
            content_type="application/pdf",
            file_size=100,
            created_by=1,
        )
        db = AsyncMock()
        db.execute.side_effect = [_Result(statement), _Result(attachment)]

        await delete_attachment(
            statement_id=1,
            attachment_id=str(attachment.id),
            db=db,
            company=_Company(),
        )

        self.assertEqual(statement.cfstate_document_type, "cash_bill")
        db.delete.assert_awaited_once_with(attachment)
        db.commit.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
