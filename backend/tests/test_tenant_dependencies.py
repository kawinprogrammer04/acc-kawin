import unittest
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.core.dependencies import _resolve_company_access, require_min_role
from app.models.company import Company
from app.models.user import User


class _Result:
    def __init__(self, *, scalar=None, row=None, rows=None):
        self._scalar = scalar
        self._row = row
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def first(self):
        return self._row

    def all(self):
        return self._rows


def _user(*, platform: bool = False) -> User:
    return User(
        id=10,
        username="tenant-test",
        email="tenant-test@example.invalid",
        password_hash="unused",
        role="viewer",
        is_platform_admin=platform,
        is_active=True,
    )


def _company(company_id: int = 2) -> Company:
    return Company(
        id=company_id,
        code=f"TEST_{company_id}",
        name_th=f"บริษัททดสอบ {company_id}",
        is_active=True,
    )


class TenantDependencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_platform_admin_can_select_tenant_and_binds_rls_context(self):
        db = AsyncMock()
        company = _company()
        db.execute.side_effect = [_Result(scalar=company), _Result()]

        selected, role = await _resolve_company_access(2, _user(platform=True), db)

        self.assertIs(selected, company)
        self.assertEqual(role, "admin")
        self.assertEqual(db.execute.await_count, 2)
        self.assertEqual(db.execute.await_args_list[1].args[1], {"company_id": "2"})

    async def test_user_without_membership_cannot_select_company(self):
        db = AsyncMock()
        db.execute.return_value = _Result(row=None)

        with self.assertRaises(HTTPException) as raised:
            await _resolve_company_access(99, _user(), db)

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(db.execute.await_count, 1)

    async def test_company_viewer_cannot_use_accountant_action(self):
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(row=(_company(), "viewer")), _Result(),
            _Result(rows=[("admin", 40), ("approver", 30), ("accountant", 20), ("viewer", 10)]),
        ]
        dependency = require_min_role("accountant")

        with self.assertRaises(HTTPException) as raised:
            await dependency(x_company_id=2, current_user=_user(), db=db)

        self.assertEqual(raised.exception.status_code, 403)

    async def test_company_accountant_can_use_accountant_action(self):
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(row=(_company(), "accountant")), _Result(),
            _Result(rows=[("admin", 40), ("approver", 30), ("accountant", 20), ("viewer", 10)]),
        ]
        dependency = require_min_role("accountant")

        current_user = _user()
        resolved = await dependency(
            x_company_id=2,
            current_user=current_user,
            db=db,
        )

        self.assertIs(resolved, current_user)


if __name__ == "__main__":
    unittest.main()
