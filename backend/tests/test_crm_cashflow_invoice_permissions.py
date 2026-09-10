"""Invoice-only access must authorize every API operation used by the page."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.crm_cashflow import router


class InvoicePagePermissionTests(unittest.IsolatedAsyncioTestCase):
    routes = (
        ("GET", "/categories"),
        ("GET", "/invoices"),
        ("PATCH", "/statements/{statement_id}"),
        ("DELETE", "/statements/{statement_id}"),
        ("GET", "/statements/{statement_id}/attachments"),
        ("POST", "/statements/{statement_id}/attachments"),
        ("GET", "/statements/{statement_id}/attachments/{attachment_id}"),
        ("DELETE", "/statements/{statement_id}/attachments/{attachment_id}"),
    )

    async def check_routes(self, *, allowed):
        user = SimpleNamespace(id=10, is_platform_admin=False)
        company = SimpleNamespace(id=5)

        async def permission_state(db, checked_user, company_id, key):
            self.assertIs(checked_user, user)
            self.assertEqual(company_id, 5)
            return (allowed and key == "crm_cashflow_invoice.view", True)

        with (
            patch("app.core.dependencies._resolve_company_access", new=AsyncMock(return_value=(company, "viewer"))),
            patch("app.core.dependencies._catalog_permission_state", side_effect=permission_state),
        ):
            for method, path in self.routes:
                with self.subTest(method=method, path=path):
                    route = next(r for r in router.routes if r.path == "/crm-cashflow" + path and method in r.methods)
                    self.assertTrue(route.dependencies)
                    for dependency in route.dependencies:
                        call = dependency.dependency(x_company_id=5, current_user=user, db=AsyncMock())
                        if allowed:
                            self.assertIs(await call, user)
                        else:
                            with self.assertRaises(HTTPException) as error:
                                await call
                            self.assertEqual(error.exception.status_code, 403)

    async def test_invoice_view_only_allows_all_page_operations(self):
        await self.check_routes(allowed=True)

    async def test_configured_user_without_page_access_is_denied(self):
        await self.check_routes(allowed=False)

    async def test_invoice_permission_does_not_bypass_company_membership(self):
        route = next(r for r in router.routes if r.path.endswith("/statements/{statement_id}") and "PATCH" in r.methods)
        with patch("app.core.dependencies._resolve_company_access", new=AsyncMock(side_effect=HTTPException(403, "No company access"))):
            with self.assertRaises(HTTPException) as error:
                await route.dependencies[0].dependency(x_company_id=99, current_user=SimpleNamespace(id=10), db=AsyncMock())
        self.assertEqual(error.exception.status_code, 403)
