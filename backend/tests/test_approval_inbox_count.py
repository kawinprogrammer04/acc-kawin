import asyncio
import unittest
from types import SimpleNamespace

from app.routers.approvals import get_inbox_count


class _CountResult:
    def __init__(self, count: int):
        self.count = count

    def scalar_one(self):
        return self.count


class _Database:
    def __init__(self, count: int):
        self.count = count
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _CountResult(self.count)


class ApprovalInboxCountTests(unittest.TestCase):
    def test_mine_count_uses_pending_company_and_current_approver(self):
        database = _Database(7)
        result = asyncio.run(get_inbox_count(
            scope="mine",
            db=database,
            current_user=SimpleNamespace(id=23, is_platform_admin=False),
            company=SimpleNamespace(id=9),
        ))

        parameters = list(database.statement.compile().params.values())
        self.assertEqual(result.count, 7)
        self.assertIn("pending", parameters)
        self.assertIn(9, parameters)
        self.assertIn(23, parameters)

    def test_platform_admin_all_count_is_not_limited_to_one_approver(self):
        database = _Database(12)
        result = asyncio.run(get_inbox_count(
            scope="all",
            db=database,
            current_user=SimpleNamespace(id=23, is_platform_admin=True),
            company=SimpleNamespace(id=9),
        ))

        parameters = list(database.statement.compile().params.values())
        self.assertEqual(result.count, 12)
        self.assertIn("pending", parameters)
        self.assertIn(9, parameters)
        self.assertNotIn(23, parameters)


if __name__ == "__main__":
    unittest.main()
