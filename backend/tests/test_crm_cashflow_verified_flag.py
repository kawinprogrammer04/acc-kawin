"""Tests for the "ตรวจสอบแล้ว" (cfstate_verified) flag on
PATCH /statements/{id} — it's set directly and independently of
cfstate_invoice (the "มีใบกำกับ/ไม่มี" status is unrelated data; the gate for
/crm-cashflow/invoices is purely whether the row has been verified yet).
"""
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock

from app.models.crm_cashflow import CrmCashflowStatement
from app.routers.crm_cashflow import StatementFlagsUpdate, update_statement_flags


class _Result:
    def __init__(self, *, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _Company:
    def __init__(self, id=5):
        self.id = id


def _statement(**overrides) -> CrmCashflowStatement:
    defaults = dict(
        cfstate_id=1, comp_id=5, cfstate_status=1,
        cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
        user_id=1, cfstate_amount=Decimal("1000.00"), cfstate_refrain=1,
        cfstate_invoice=0, cfstate_verified=0,
    )
    defaults.update(overrides)
    return CrmCashflowStatement(**defaults)


class UpdateStatementFlagsVerifiedTests(unittest.IsolatedAsyncioTestCase):
    async def test_marking_verified_does_not_touch_invoice_status(self):
        row = _statement(cfstate_invoice=0)
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=row)

        await update_statement_flags(1, StatementFlagsUpdate(cfstate_verified=1), db=db, company=_Company(5))

        self.assertEqual(row.cfstate_verified, 1)
        self.assertEqual(row.cfstate_invoice, 0)

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

    async def test_rejects_empty_payload(self):
        with self.assertRaises(Exception):
            StatementFlagsUpdate()

    async def test_rejects_invalid_verified_value(self):
        with self.assertRaises(Exception):
            StatementFlagsUpdate(cfstate_verified=2)


if __name__ == "__main__":
    unittest.main()
