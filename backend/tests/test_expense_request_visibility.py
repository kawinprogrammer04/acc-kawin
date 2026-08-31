import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.approvals import create_next_installment, list_expense_requests


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


if __name__ == "__main__":
    unittest.main()
