import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials

from app.core.config import Settings
from app.routers.integrations import get_hr_approval_summary
from app.services.hr_kawin import HrEmployee, HrTokenError


class _Result:
    def __init__(self, *, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def all(self):
        return self._rows

    def scalars(self):
        return self

    def scalar_one(self):
        return self._scalar


def _company(company_id: int, code: str):
    return SimpleNamespace(id=company_id, code=code, name_th=f"บริษัท {code}", is_active=True)


def _user(*, platform_admin: bool = False):
    return SimpleNamespace(id=23, username="0106006", is_platform_admin=platform_admin, is_active=True)


def _employee():
    return HrEmployee(employee_id="0106006", name="ผู้อนุมัติ", position=None, department=None)


class HrApprovalSummaryTests(unittest.IsolatedAsyncioTestCase):
    def test_production_public_url_has_safe_default_when_server_env_is_not_updated(self):
        config = Settings(
            APP_ENV="production",
            DATABASE_URL="postgresql+asyncpg://example.invalid/acc",
            SECRET_KEY="test-only",
            DEBUG=False,
            ACC_PUBLIC_BASE_URL="",
            _env_file=None,
        )
        self.assertEqual(config.ACC_PUBLIC_BASE_URL, "https://acc.kawinbrothers.com")

    async def test_normal_user_gets_all_companies_with_role_appropriate_counts(self):
        first = _company(1, "KB")
        second = _company(2, "ABC")
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(rows=[(first, "viewer"), (second, "super_admin")]),
            _Result(),
            _Result(scalar=3),
            _Result(),
            _Result(scalar=4),
        ]
        response = Response()

        with (
            patch("app.routers.integrations.fetch_employee_me", AsyncMock(return_value=_employee())),
            patch("app.routers.integrations.find_active_accounting_user", AsyncMock(return_value=_user())),
            patch("app.routers.integrations.settings.ACC_PUBLIC_BASE_URL", "https://acc.example.test/"),
        ):
            result = await get_hr_approval_summary(
                response=response,
                credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="hr-token"),
                db=db,
            )

        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(result.pending_approval_count, 7)
        self.assertEqual([item.pending_approval_count for item in result.companies], [3, 4])
        self.assertEqual(result.action.sso_url, "https://acc.example.test/login")
        self.assertEqual(result.action.next, "/approvals/inbox")

        first_rls_call = db.execute.await_args_list[1]
        second_rls_call = db.execute.await_args_list[3]
        self.assertEqual(first_rls_call.args[1], {"company_id": "1"})
        self.assertEqual(second_rls_call.args[1], {"company_id": "2"})

        first_count_params = list(db.execute.await_args_list[2].args[0].compile().params.values())
        second_count_params = list(db.execute.await_args_list[4].args[0].compile().params.values())
        self.assertIn(23, first_count_params)
        self.assertNotIn(23, second_count_params)

    async def test_platform_admin_counts_all_pending_steps_in_every_active_company(self):
        company = _company(9, "ALL")
        db = AsyncMock()
        results = [
            _Result(rows=[company]),
            _Result(),
            _Result(scalar=12),
        ]
        db.execute.side_effect = results

        with (
            patch("app.routers.integrations.fetch_employee_me", AsyncMock(return_value=_employee())),
            patch(
                "app.routers.integrations.find_active_accounting_user",
                AsyncMock(return_value=_user(platform_admin=True)),
            ),
        ):
            result = await get_hr_approval_summary(
                response=Response(),
                credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="hr-token"),
                db=db,
            )

        self.assertEqual(result.pending_approval_count, 12)
        count_params = list(db.execute.await_args_list[2].args[0].compile().params.values())
        self.assertNotIn(23, count_params)

    async def test_user_without_companies_gets_zero_summary(self):
        db = AsyncMock()
        db.execute.return_value = _Result(rows=[])
        with (
            patch("app.routers.integrations.fetch_employee_me", AsyncMock(return_value=_employee())),
            patch("app.routers.integrations.find_active_accounting_user", AsyncMock(return_value=_user())),
        ):
            result = await get_hr_approval_summary(
                response=Response(),
                credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="hr-token"),
                db=db,
            )

        self.assertEqual(result.pending_approval_count, 0)
        self.assertEqual(result.companies, [])

    async def test_missing_bearer_token_returns_401(self):
        response = Response()
        with self.assertRaises(HTTPException) as raised:
            await get_hr_approval_summary(response=response, credentials=None, db=AsyncMock())

        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(raised.exception.headers, {
            "WWW-Authenticate": "Bearer",
            "Cache-Control": "no-store",
        })
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    async def test_hr_errors_keep_auth_status_and_map_upstream_failures_to_502(self):
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad-token")
        for source_status, expected_status in ((401, 401), (403, 403), (500, 502)):
            with self.subTest(source_status=source_status):
                with patch(
                    "app.routers.integrations.fetch_employee_me",
                    AsyncMock(side_effect=HrTokenError(source_status, "HR error")),
                ):
                    with self.assertRaises(HTTPException) as raised:
                        await get_hr_approval_summary(
                            response=Response(), credentials=credentials, db=AsyncMock()
                        )
                self.assertEqual(raised.exception.status_code, expected_status)

    async def test_unmapped_or_inactive_acc_user_returns_403(self):
        with (
            patch("app.routers.integrations.fetch_employee_me", AsyncMock(return_value=_employee())),
            patch(
                "app.routers.integrations.find_active_accounting_user",
                AsyncMock(side_effect=HrTokenError(403, "ไม่มีสิทธิ์เข้าใช้งานระบบบัญชี")),
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await get_hr_approval_summary(
                    response=Response(),
                    credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="hr-token"),
                    db=AsyncMock(),
                )

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
