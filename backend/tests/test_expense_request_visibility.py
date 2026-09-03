import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.approvals import (
    _personal_expense_request_query,
    _summarize_personal_expense_requests,
    create_next_installment,
    list_expense_requests,
)


class _EmptyScalarResult:
    def scalars(self):
        return self

    def all(self):
        return []


class ExpenseRequestVisibilityTest(unittest.IsolatedAsyncioTestCase):
    async def test_accounting_viewer_can_start_the_next_installment(self) -> None:
        source = SimpleNamespace(requester_user_id=42, installment_chain_root_id=None)
        with (
            patch("app.routers.approvals._get_company_row", new=AsyncMock(return_value=source)),
            patch("app.routers.approvals.has_company_permission", new=AsyncMock(return_value=True)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await create_next_installment(
                    request_id="request-1",
                    payload=SimpleNamespace(installment_payment_amount=100),
                    db=SimpleNamespace(),
                    current_user=SimpleNamespace(id=99),
                    company=SimpleNamespace(id=7),
                )

        # Reaching the installment-chain validation proves accounting access
        # passed; a non-accounting, non-owner user is rejected with 403 first.
        self.assertEqual(raised.exception.status_code, 400)

    async def test_unrelated_user_cannot_start_the_next_installment(self) -> None:
        source = SimpleNamespace(requester_user_id=42, installment_chain_root_id="root-1")
        with (
            patch("app.routers.approvals._get_company_row", new=AsyncMock(return_value=source)),
            patch("app.routers.approvals.has_company_permission", new=AsyncMock(return_value=False)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await create_next_installment(
                    request_id="request-1",
                    payload=SimpleNamespace(installment_payment_amount=100),
                    db=SimpleNamespace(),
                    current_user=SimpleNamespace(id=99),
                    company=SimpleNamespace(id=7),
                )

        self.assertEqual(raised.exception.status_code, 403)

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


if __name__ == "__main__":
    unittest.main()
