import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.routers.companies import search_users_to_grant


class _ScalarResult:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _RowsResult:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class CompanyUserSearchTest(unittest.IsolatedAsyncioTestCase):
    async def test_empty_query_returns_all_candidates_with_org_filters(self) -> None:
        users = [
            SimpleNamespace(id=10, username="alice", email="alice@example.com", full_name="Alice"),
            SimpleNamespace(id=11, username="bob", email="bob@example.com", full_name="Bob"),
        ]
        db = SimpleNamespace(execute=AsyncMock(side_effect=[
            _ScalarResult(users),
            _RowsResult([(10, "บัญชี"), (11, "คลังสินค้า")]),
            _RowsResult([(10, "นักบัญชี"), (11, "เจ้าหน้าที่คลัง")]),
        ]))

        with patch("app.routers.companies._require_company_admin", new=AsyncMock()):
            result = await search_users_to_grant(
                company_id=5,
                q=None,
                db=db,
                current_user=SimpleNamespace(id=1),
            )

        self.assertEqual([row["username"] for row in result], ["alice", "bob"])
        self.assertEqual(result[0]["department_names"], ["บัญชี"])
        self.assertEqual(result[0]["position_names"], ["นักบัญชี"])
        statement = db.execute.await_args_list[0].args[0]
        sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
        self.assertNotIn("lower(users.username) LIKE", sql)
        self.assertNotIn("LIMIT", sql)


if __name__ == "__main__":
    unittest.main()
