import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.models.user import User
from app.routers.auth import update_user
from app.schemas.auth import UserUpdate


class _Result:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


def _linked_user() -> User:
    return User(
        id=7,
        username="account@05",
        email="account05@gmail.com",
        password_hash="unused",
        full_name="อัญรินทร์ สีกันหา",
        role="accountant",
        is_platform_admin=False,
        is_active=True,
        hr_employee_id="admin",
    )


class UserHrLinkUpdateTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_null_clears_hr_employee_link(self):
        user = _linked_user()
        db = AsyncMock()
        db.execute.return_value = _Result(user)

        result = await update_user(
            user_id=user.id,
            payload=UserUpdate(hr_employee_id=None),
            db=db,
            current_user=SimpleNamespace(id=1),
        )

        self.assertIsNone(result.hr_employee_id)
        db.commit.assert_awaited_once()

    async def test_empty_string_clears_hr_employee_link(self):
        user = _linked_user()
        db = AsyncMock()
        db.execute.return_value = _Result(user)

        result = await update_user(
            user_id=user.id,
            payload=UserUpdate(hr_employee_id=""),
            db=db,
            current_user=SimpleNamespace(id=1),
        )

        self.assertIsNone(result.hr_employee_id)

    async def test_omitted_hr_employee_id_preserves_existing_link(self):
        user = _linked_user()
        db = AsyncMock()
        db.execute.return_value = _Result(user)

        result = await update_user(
            user_id=user.id,
            payload=UserUpdate(full_name="ชื่อใหม่"),
            db=db,
            current_user=SimpleNamespace(id=1),
        )

        self.assertEqual(result.hr_employee_id, "admin")


if __name__ == "__main__":
    unittest.main()
