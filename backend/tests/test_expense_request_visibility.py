import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.routers.approvals import list_expense_requests


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


if __name__ == "__main__":
    unittest.main()
