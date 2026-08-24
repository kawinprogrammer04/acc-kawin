"""Tests for automatic CRM cashflow Description classification."""

import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.routers.crm_cashflow import (
    StatementBatchCreate,
    StatementCreate,
    classify_crm_cashflow_note,
    create_statements,
)
from app.services.crm_cashflow_rules import should_auto_verify_crm_cashflow_note


class _Result:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _Company:
    id = 5


class _User:
    id = 1


def _item(description: str) -> StatementCreate:
    return StatementCreate(
        cfstate_date=date(2026, 8, 23),
        cfcat_id=1,
        cflist_id=2,
        cfstate_refrain=1,
        cfstate_detail=description,
        cfstate_amount=Decimal("100.00"),
    )


class CrmCashflowDescriptionRuleTests(unittest.TestCase):
    def test_ads_rules_map_to_the_expected_notes(self):
        cases = {
            "KBANK x7675=ADS AMEX": "ADS AMEX",
            "SCB x2988=ADS SCB": "ADS SCB",
            "SCB x9566=ADS": "ADS",
            "1892112988=ADS SCB": "ADS SCB",
            "SCB x699=ค่า ADS Shopee": "ค่า ADS Shopee",
        }
        for description, expected in cases.items():
            with self.subTest(description=description):
                self.assertEqual(classify_crm_cashflow_note(description), expected)

    def test_matching_is_case_insensitive_and_trims_outer_whitespace(self):
        self.assertEqual(classify_crm_cashflow_note("  kbank X7675 transaction  "), "ADS AMEX")

    def test_pay_is_a_prefix_rule(self):
        self.assertEqual(classify_crm_cashflow_note("PAYMENT PROVIDER"), "รายการอื่นๆ")
        self.assertEqual(classify_crm_cashflow_note("  pay transfer  "), "รายการอื่นๆ")
        self.assertIsNone(classify_crm_cashflow_note("EPAYMENT PROVIDER"))
        self.assertFalse(should_auto_verify_crm_cashflow_note("รายการอื่นๆ"))
        self.assertTrue(should_auto_verify_crm_cashflow_note("ADS SCB"))

    def test_ads_rule_takes_priority_over_pay(self):
        self.assertEqual(classify_crm_cashflow_note("SCB x699 PAY"), "ค่า ADS Shopee")

    def test_unmatched_description_is_unchanged(self):
        self.assertIsNone(classify_crm_cashflow_note("ค่าเช่าสำนักงาน"))


class CrmCashflowCreateClassificationTests(unittest.IsolatedAsyncioTestCase):
    async def _create(self, description: str):
        db = AsyncMock()
        db.add = MagicMock()
        db.execute.side_effect = [
            _Result(SimpleNamespace(cfcat_status=1)),
            _Result(SimpleNamespace(cflist_status=1, cfcat_id=1)),
            _Result(None),
        ]
        result = await create_statements(
            StatementBatchCreate(items=[_item(description)]),
            db=db,
            current_user=_User(),
            company=_Company(),
        )
        return result, db.add.call_args.args[0]

    async def test_matching_new_statement_is_verified_and_annotated(self):
        result, statement = await self._create("KBANK x7675=ADS AMEX")

        self.assertEqual(result["created"], 1)
        self.assertEqual(statement.cfstate_note, "ADS AMEX")
        self.assertEqual(statement.cfstate_verified, 1)

    async def test_unmatched_new_statement_remains_pending(self):
        _, statement = await self._create("ค่าเช่าสำนักงาน")

        self.assertIsNone(statement.cfstate_note)
        self.assertEqual(statement.cfstate_verified, 0)

    async def test_pay_statement_is_hidden_from_invoices_but_remains_pending(self):
        _, statement = await self._create("PAYMENT PROVIDER")

        self.assertEqual(statement.cfstate_note, "รายการอื่นๆ")
        self.assertEqual(statement.cfstate_verified, 0)


if __name__ == "__main__":
    unittest.main()
