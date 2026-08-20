import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.core.security import decode_token
from app.models.user import User
from app.routers.auth import sso_hr_login
from app.schemas.auth import HrSsoLoginRequest
from app.services.hr_kawin import HrEmployee, HrTokenError


class _Result:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


def _linked_user(*, is_active: bool = True) -> User:
    return User(
        id=5,
        username="mongkol",
        email="mongkol@example.invalid",
        password_hash="unused",
        role="accountant",
        is_platform_admin=False,
        is_active=is_active,
        hr_employee_id="0106006",
    )


def _employee(employee_id: str = "0106006") -> HrEmployee:
    return HrEmployee(employee_id=employee_id, name="มงคล ภุมรา", position="Programmer", department="IT")


class HrSsoLoginTests(unittest.IsolatedAsyncioTestCase):
    async def test_happy_path_returns_token_for_linked_active_user(self):
        db = AsyncMock()
        user = _linked_user()
        db.execute.return_value = _Result(scalar=user)

        with patch("app.routers.auth.fetch_employee_me", AsyncMock(return_value=_employee())):
            result = await sso_hr_login(HrSsoLoginRequest(token="fake"), db=db)

        self.assertEqual(result.user_id, user.id)
        self.assertEqual(result.username, user.username)
        self.assertEqual(result.role, user.role)
        decoded = decode_token(result.access_token)
        self.assertEqual(decoded["sub"], str(user.id))
        self.assertEqual(decoded["role"], user.role)
        db.commit.assert_awaited_once()

    async def test_hr_token_expired_returns_401(self):
        db = AsyncMock()
        with patch(
            "app.routers.auth.fetch_employee_me",
            AsyncMock(side_effect=HrTokenError(401, "token หมดอายุ กรุณากดปุ่มจาก HR ใหม่")),
        ):
            with self.assertRaises(HTTPException) as raised:
                await sso_hr_login(HrSsoLoginRequest(token="expired"), db=db)

        self.assertEqual(raised.exception.status_code, 401)
        db.execute.assert_not_awaited()

    async def test_hr_token_invalid_scope_returns_403(self):
        db = AsyncMock()
        with patch(
            "app.routers.auth.fetch_employee_me",
            AsyncMock(side_effect=HrTokenError(403, "token ไม่ถูกต้องหรือไม่มีสิทธิ์")),
        ):
            with self.assertRaises(HTTPException) as raised:
                await sso_hr_login(HrSsoLoginRequest(token="wrong-scope"), db=db)

        self.assertEqual(raised.exception.status_code, 403)

    async def test_hr_unreachable_returns_502(self):
        db = AsyncMock()
        with patch(
            "app.routers.auth.fetch_employee_me",
            AsyncMock(side_effect=HrTokenError(502, "เชื่อมต่อระบบ HR ไม่สำเร็จ")),
        ):
            with self.assertRaises(HTTPException) as raised:
                await sso_hr_login(HrSsoLoginRequest(token="whatever"), db=db)

        self.assertEqual(raised.exception.status_code, 502)

    async def test_employee_not_linked_to_any_user_returns_403(self):
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=None)

        with patch("app.routers.auth.fetch_employee_me", AsyncMock(return_value=_employee())):
            with self.assertRaises(HTTPException) as raised:
                await sso_hr_login(HrSsoLoginRequest(token="fake"), db=db)

        self.assertEqual(raised.exception.status_code, 403)
        self.assertIn("ไม่มีสิทธิ์", raised.exception.detail)
        db.commit.assert_not_awaited()

    async def test_linked_but_inactive_user_returns_403(self):
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=_linked_user(is_active=False))

        with patch("app.routers.auth.fetch_employee_me", AsyncMock(return_value=_employee())):
            with self.assertRaises(HTTPException) as raised:
                await sso_hr_login(HrSsoLoginRequest(token="fake"), db=db)

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
