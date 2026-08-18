import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.approval import UserPosition
from app.routers.companies import GrantUserIn, grant_company_access
from app.schemas.auth import UserCreate


class _Result:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self

    def all(self):
        return self._rows


class UserMultiPositionTests(unittest.IsolatedAsyncioTestCase):
    def test_create_payload_accepts_multiple_positions(self):
        payload = UserCreate(
            username="EMP001",
            email="employee@example.com",
            password="temporary-password",
            company_id=1,
            position_ids=[11, 12],
        )

        self.assertEqual(payload.position_ids, [11, 12])

    async def test_company_save_replaces_positions_in_one_commit(self):
        membership = SimpleNamespace(role="viewer", department_id=None, is_active=True)
        kept = SimpleNamespace(position_id=11, is_active=False)
        removed = SimpleNamespace(position_id=13, is_active=True)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[
            _Result(rows=[11, 12]),
            _Result(scalar=SimpleNamespace(id=7)),
            _Result(scalar=membership),
            _Result(rows=[kept, removed]),
        ])
        db.delete = AsyncMock()
        db.commit = AsyncMock()

        with (
            patch("app.routers.companies._require_company_admin", new=AsyncMock(return_value=SimpleNamespace(id=1))),
            patch("app.routers.companies.role_is_active", new=AsyncMock(return_value=True)),
            patch("app.routers.companies.get_role_levels", new=AsyncMock(return_value={"viewer": 10, "admin": 40})),
        ):
            response = await grant_company_access(
                company_id=1,
                payload=GrantUserIn(user_id=7, role="accountant", position_ids=[11, 12]),
                db=db,
                current_user=SimpleNamespace(id=99),
            )

        self.assertTrue(kept.is_active)
        db.delete.assert_awaited_once_with(removed)
        added_positions = [
            call.args[0]
            for call in db.add.call_args_list
            if isinstance(call.args[0], UserPosition)
        ]
        self.assertEqual([row.position_id for row in added_positions], [12])
        db.commit.assert_awaited_once()
        self.assertEqual(response["position_ids"], [11, 12])

    async def test_omitted_positions_preserve_existing_assignments(self):
        membership = SimpleNamespace(role="viewer", department_id=None, is_active=True)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[
            _Result(scalar=SimpleNamespace(id=7)),
            _Result(scalar=membership),
        ])
        db.commit = AsyncMock()

        with (
            patch("app.routers.companies._require_company_admin", new=AsyncMock(return_value=SimpleNamespace(id=1))),
            patch("app.routers.companies.role_is_active", new=AsyncMock(return_value=True)),
            patch("app.routers.companies.get_role_levels", new=AsyncMock(return_value={"viewer": 10, "admin": 40})),
        ):
            response = await grant_company_access(
                company_id=1,
                payload=GrantUserIn(user_id=7, role="viewer"),
                db=db,
                current_user=SimpleNamespace(id=99),
            )

        self.assertEqual(db.execute.await_count, 2)
        db.delete.assert_not_called()
        self.assertIsNone(response["position_ids"])


if __name__ == "__main__":
    unittest.main()
