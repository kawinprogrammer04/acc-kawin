"""Tests for the "ตรวจสอบแล้ว" (cfstate_verified) flag on
PATCH /statements/{id} — it's set directly and independently of
cfstate_invoice (the "มีใบกำกับ/ไม่มี" status is unrelated data). The invoice
tracking list contains unverified payment rows and excludes positive receipt
amounts.
"""
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.models.crm_cashflow import CrmCashflowStatement
from app.routers.crm_cashflow import (
    StatementFlagsUpdate,
    _invoice_status_label,
    _list_statements,
    list_statements,
    update_statement_flags,
)


class _Result:
    def __init__(self, *, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar


class _Company:
    def __init__(self, id=5):
        self.id = id


class _MappingsResult:
    def mappings(self):
        return self

    def all(self):
        return []


def _statement(**overrides) -> CrmCashflowStatement:
    defaults = dict(
        cfstate_id=1, comp_id=5, cfstate_status=1,
        cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
        user_id=1, cfstate_amount=Decimal("1000.00"), cfstate_refrain=1,
        cfstate_invoice=0, cfstate_document_type=None, cfstate_verified=0,
    )
    defaults.update(overrides)
    return CrmCashflowStatement(**defaults)


class UpdateStatementFlagsVerifiedTests(unittest.IsolatedAsyncioTestCase):
    async def test_marking_verified_does_not_touch_invoice_status(self):
        row = _statement(cfstate_invoice=0)
        db = AsyncMock()
        db.execute.side_effect = [_Result(scalar=row), _Result(scalar=1)]

        await update_statement_flags(1, StatementFlagsUpdate(cfstate_verified=1), db=db, company=_Company(5))

        self.assertEqual(row.cfstate_verified, 1)
        self.assertEqual(row.cfstate_invoice, 0)

    async def test_marking_verified_requires_an_attachment(self):
        row = _statement(cfstate_invoice=0, cfstate_verified=0)
        db = AsyncMock()
        db.execute.side_effect = [_Result(scalar=row), _Result(scalar=0)]

        with self.assertRaises(HTTPException) as raised:
            await update_statement_flags(
                1, StatementFlagsUpdate(cfstate_verified=1), db=db, company=_Company(5)
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("ยังไม่มีไฟล์แนบ", raised.exception.detail)
        self.assertEqual(row.cfstate_verified, 0)
        db.commit.assert_not_awaited()

    async def test_marking_invoice_received_does_not_auto_verify(self):
        row = _statement(cfstate_invoice=0, cfstate_verified=0)
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=row)

        await update_statement_flags(1, StatementFlagsUpdate(cfstate_invoice=1), db=db, company=_Company(5))

        self.assertEqual(row.cfstate_invoice, 1)
        self.assertEqual(row.cfstate_verified, 0)

    async def test_refrain_only_change_does_not_touch_verified(self):
        row = _statement()
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=row)

        await update_statement_flags(1, StatementFlagsUpdate(cfstate_refrain=0), db=db, company=_Company(5))

        self.assertEqual(row.cfstate_refrain, 0)
        self.assertEqual(row.cfstate_verified, 0)

    async def test_document_type_change_does_not_touch_invoice_or_verified(self):
        row = _statement(cfstate_invoice=0, cfstate_verified=0)
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=row)

        await update_statement_flags(
            1, StatementFlagsUpdate(cfstate_document_type="cash_bill"),
            db=db, company=_Company(5),
        )

        self.assertEqual(row.cfstate_document_type, "cash_bill")
        self.assertEqual(row.cfstate_invoice, 0)
        self.assertEqual(row.cfstate_verified, 0)

    async def test_document_type_can_be_cleared_with_null(self):
        row = _statement(cfstate_document_type="tax_invoice")
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=row)

        await update_statement_flags(
            1, StatementFlagsUpdate(cfstate_document_type=None),
            db=db, company=_Company(5),
        )

        self.assertIsNone(row.cfstate_document_type)

    async def test_rejects_empty_payload(self):
        with self.assertRaises(Exception):
            StatementFlagsUpdate()

    async def test_rejects_invalid_verified_value(self):
        with self.assertRaises(Exception):
            StatementFlagsUpdate(cfstate_verified=2)

    async def test_accepts_each_document_type(self):
        for document_type in ("tax_invoice", "cash_bill", "other"):
            payload = StatementFlagsUpdate(cfstate_document_type=document_type)
            self.assertEqual(payload.cfstate_document_type, document_type)

    async def test_rejects_invalid_document_type(self):
        with self.assertRaises(Exception):
            StatementFlagsUpdate(cfstate_document_type="receipt")


class InvoiceStatusLabelTests(unittest.TestCase):
    def test_document_type_takes_priority(self):
        self.assertEqual(_invoice_status_label(0, "tax_invoice"), "ใบกำกับภาษี")
        self.assertEqual(_invoice_status_label(1, "cash_bill"), "บิลเงินสด")
        self.assertEqual(_invoice_status_label(None, "other"), "อื่นๆ")

    def test_legacy_status_is_used_without_document_type(self):
        self.assertEqual(_invoice_status_label(None, None), "")
        self.assertEqual(_invoice_status_label(0, None), "รอใบกำกับ")
        self.assertEqual(_invoice_status_label(1, None), "ได้รับแล้ว")


class InvoiceTrackingFilterTests(unittest.IsolatedAsyncioTestCase):
    async def test_statement_dashboard_uses_the_same_verification_filter_as_the_list(self):
        filtered_rows = [{
            "cfstate_amount": Decimal("125.00"),
            "cfstate_verified": 1,
            "user_name": "Accountant",
            "username": "accountant",
        }]

        with patch(
            "app.routers.crm_cashflow._list_statements",
            new=AsyncMock(return_value=filtered_rows),
        ) as mocked_list:
            result = await list_statements(
                verification_status="verified",
                page=1,
                page_size=25,
                db=AsyncMock(),
                company=_Company(5),
            )

        self.assertEqual(mocked_list.await_count, 1)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["dashboard"]["verified_count"], 1)
        self.assertEqual(result["dashboard"]["pending_count"], 0)
        self.assertEqual(result["dashboard"]["sum_revenue"], 125.0)

    async def test_statement_pagination_keeps_filtered_totals_for_all_rows(self):
        filtered_rows = [{
            "cfstate_id": index,
            "cfstate_amount": Decimal("1.00"),
            "cfstate_verified": 1,
            "user_name": "Accountant",
            "username": "accountant",
        } for index in range(1, 31)]

        with patch(
            "app.routers.crm_cashflow._list_statements",
            new=AsyncMock(return_value=filtered_rows),
        ):
            result = await list_statements(
                page=2,
                page_size=10,
                db=AsyncMock(),
                company=_Company(5),
            )

        self.assertEqual(result["total"], 30)
        self.assertEqual(len(result["items"]), 10)
        self.assertEqual(result["items"][0]["cfstate_id"], 11)
        self.assertEqual(result["items"][-1]["cfstate_id"], 20)
        self.assertEqual(result["sum_revenue"], 30.0)
        self.assertEqual(result["dashboard"]["verified_count"], 30)

    async def test_statement_query_filters_verification_and_document_type(self):
        db = AsyncMock()
        db.execute.return_value = _MappingsResult()

        await _list_statements(
            db, comp_id=5, start_date=None, end_date=None, cfcat_id=None,
            verification_status="verified", invoice_status="tax_invoice",
        )

        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("cashflow_statement.cfstate_verified = 1", sql)
        self.assertIn("cashflow_statement.cfstate_document_type = 'tax_invoice'", sql)

    async def test_legacy_invoice_filter_excludes_rows_with_document_type(self):
        db = AsyncMock()
        db.execute.return_value = _MappingsResult()

        await _list_statements(
            db, comp_id=5, start_date=None, end_date=None, cfcat_id=None,
            invoice_status="pending",
        )

        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("cashflow_statement.cfstate_document_type IS NULL", sql)
        self.assertIn("cashflow_statement.cfstate_invoice = 0", sql)

    async def test_pending_invoice_query_excludes_positive_receipt_amounts(self):
        db = AsyncMock()
        db.execute.return_value = _MappingsResult()

        await _list_statements(
            db, comp_id=5, start_date=None, end_date=None, cfcat_id=None,
            pending_verification_only=True,
        )

        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("cashflow_statement.cfstate_verified = 0", sql)
        self.assertIn("cashflow_statement.cfstate_amount <= 0", sql)


if __name__ == "__main__":
    unittest.main()
