import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.models.approval import ExpenseRequest, ExpenseRequestItem

from app.routers.approvals import (
    _personal_expense_request_query,
    _summarize_personal_expense_requests,
    copy_expense_request_as_draft,
    list_expense_requests,
)


class _EmptyScalarResult:
    def scalars(self):
        return self

    def all(self):
        return []


class ExpenseRequestVisibilityTest(unittest.IsolatedAsyncioTestCase):
    async def test_scope_all_still_filters_personal_request_list_to_current_user(self) -> None:
        db = SimpleNamespace(execute=AsyncMock(return_value=_EmptyScalarResult()))

        rows = await list_expense_requests(
            scope="all",
            status=None,
            limit=100,
            offset=0,
            db=db,
            current_user=SimpleNamespace(id=42),
            company=SimpleNamespace(id=7),
        )

        self.assertEqual(rows, [])
        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("expense_requests.company_id = 7", sql)
        self.assertIn("expense_requests.requester_user_id = 42", sql)

    async def test_personal_request_list_accepts_multiple_statuses(self) -> None:
        db = SimpleNamespace(execute=AsyncMock(return_value=_EmptyScalarResult()))

        await list_expense_requests(
            scope="mine",
            status="completed,draft,completed",
            limit=100,
            offset=0,
            db=db,
            current_user=SimpleNamespace(id=42),
            company=SimpleNamespace(id=7),
        )

        statement = db.execute.await_args.args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("expense_requests.status IN ('completed', 'draft')", sql)

    def test_personal_data_list_propagates_every_filter(self) -> None:
        statement = _personal_expense_request_query(
            SimpleNamespace(id=7),
            SimpleNamespace(id=42),
            statuses="completed,draft",
            type_ids="9,3",
            request_formats="advance,reimbursement",
            query="ACC-2026",
            date_from=date(2026, 9, 1),
            date_to=date(2026, 9, 30),
        )

        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("expense_requests.company_id = 7", sql)
        self.assertIn("expense_requests.requester_user_id = 42", sql)
        self.assertIn("expense_requests.status IN ('completed', 'draft')", sql)
        self.assertIn("expense_requests.expense_type_id IN (3, 9)", sql)
        self.assertIn("expense_requests.request_format IN ('advance', 'reimbursement')", sql)
        self.assertIn("expense_requests.request_date >= '2026-09-01'", sql)
        self.assertIn("expense_requests.request_date <= '2026-09-30'", sql)
        self.assertIn("ACC-2026", sql)

    def test_personal_stats_use_the_filtered_rows_and_full_amount(self) -> None:
        result = _summarize_personal_expense_requests([
            SimpleNamespace(status="draft", amount=Decimal("100.25")),
            SimpleNamespace(status="pending_approval", amount=Decimal("200.50")),
            SimpleNamespace(status="completed", amount=Decimal("300.75")),
            SimpleNamespace(status="returned_for_correction", amount=Decimal("50.00")),
        ])

        self.assertEqual(result.total_count, 4)
        self.assertEqual(result.action_required_count, 2)
        self.assertEqual(result.in_progress_count, 1)
        self.assertEqual(result.completed_count, 1)
        self.assertEqual(result.amount_total, Decimal("651.50"))

    async def test_copy_rejects_request_owned_by_another_user(self) -> None:
        source = SimpleNamespace(requester_user_id=99)

        with patch("app.routers.approvals._get_company_row", AsyncMock(return_value=source)):
            with self.assertRaises(HTTPException) as raised:
                await copy_expense_request_as_draft(
                    "request-1",
                    db=SimpleNamespace(),
                    current_user=SimpleNamespace(id=42),
                    company=SimpleNamespace(id=7),
                )

        self.assertEqual(raised.exception.status_code, 403)

    async def test_copy_creates_fresh_draft_with_items_but_no_transaction_state(self) -> None:
        source = ExpenseRequest(
            id="source-id", request_no="ACC-EXP-OLD", company_id=7,
            requester_user_id=42, requester_position_id=5, expense_type_id=9,
            amount=Decimal("107"), title="ค่าบริการรายเดือน", description="รอบเดิม",
            request_date=date(2026, 8, 1), required_date=date(2026, 8, 5),
            request_format="reimbursement", payer_company_name="บริษัท กวิน บราเธอร์ส จำกัด",
            recipient_type="company", recipient_name="ผู้ขายเดิม", bank_name="กสิกรไทย",
            bank_account_name="ผู้ขายเดิม", bank_account_number_encrypted="encrypted-bank",
            bank_account_last4="1234", recipient_tax_id_encrypted="encrypted-tax",
            recipient_tax_id_last4="5678", recipient_address="กรุงเทพฯ",
            service_description="ค่าบริการ", discount_amount=Decimal("0"),
            price_mode="exclude_vat", vat_mode="rate", vat_rate=Decimal("7"),
            withholding_required=True, withholding_mode="rate", withholding_rate=Decimal("3"),
            requester_withholding_status="deduct", gross_up_enabled=False,
            requested_net_amount=None, installment_enabled=True,
            installment_chain_root_id="source-id", installment_no=2,
            installment_target_amount=Decimal("214"), installment_payment_amount=Decimal("107"),
            installment_chain_status="in_progress", taxpayer_name="ผู้ขายเดิม",
            taxpayer_type="juristic", taxpayer_branch="สำนักงานใหญ่", taxpayer_id=None,
            taxpayer_address="กรุงเทพฯ", current_revision=3, status="completed",
        )
        source_item = SimpleNamespace(
            sort_order=1, description="ค่าระบบ", quantity=Decimal("1"), unit="เดือน",
            unit_price=Decimal("100"), vat_rate=Decimal("7"),
            withholding_rate=Decimal("3"), line_total=Decimal("100"),
        )

        class ScalarRows:
            def scalars(self):
                return self

            def all(self):
                return [source_item]

        class FakeDb:
            def __init__(self):
                self.added = []

            def add(self, value):
                self.added.append(value)

            async def execute(self, _statement):
                return ScalarRows()

            async def flush(self):
                copied = next(value for value in self.added if isinstance(value, ExpenseRequest))
                copied.id = "copy-id"

            async def commit(self):
                return None

            async def refresh(self, copied):
                copied.request_no = "ACC-EXP-NEW"
                copied.created_at = datetime.now(timezone.utc)

        db = FakeDb()
        current_user = SimpleNamespace(id=42, full_name="ผู้ขอ", username="requester", is_platform_admin=False)
        company = SimpleNamespace(id=7, name_th="บริษัท กวิน บราเธอร์ส จำกัด")
        expense_type = SimpleNamespace(id=9, allowed_kinds=["reimbursement"])

        with (
            patch("app.routers.approvals._get_company_row", AsyncMock(side_effect=[source, expense_type])),
            patch("app.routers.approvals._employee_organization", AsyncMock(return_value=(SimpleNamespace(name="Manager"), None))),
            patch("app.routers.approvals._request_to_out", AsyncMock(return_value={"id": "copy-id", "status": "draft"})),
        ):
            result = await copy_expense_request_as_draft(
                source.id, db=db, current_user=current_user, company=company
            )

        copied = next(value for value in db.added if isinstance(value, ExpenseRequest))
        copied_items = [value for value in db.added if isinstance(value, ExpenseRequestItem)]
        self.assertEqual(result, {"id": "copy-id", "status": "draft"})
        self.assertEqual(copied.status, "draft")
        self.assertNotEqual(copied.request_date, source.request_date)
        self.assertIsNone(copied.required_date)
        self.assertEqual(copied.title, source.title)
        self.assertEqual(copied.bank_account_number_encrypted, source.bank_account_number_encrypted)
        self.assertEqual(copied.amount, Decimal("107.00"))
        self.assertEqual(copied.paid_amount, Decimal("0"))
        self.assertEqual(copied.remaining_amount, Decimal("104.00"))
        self.assertFalse(copied.installment_enabled)
        self.assertIsNone(copied.installment_chain_root_id)
        self.assertEqual(len(copied_items), 1)
        self.assertEqual(copied_items[0].description, source_item.description)


if __name__ == "__main__":
    unittest.main()
