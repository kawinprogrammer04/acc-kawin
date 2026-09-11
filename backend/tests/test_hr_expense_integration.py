import base64
import hashlib
import hmac
import inspect
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.core.config import settings
from app.routers import hr_expense_integration as router
from app.routers.expense_finance import (
    accounting_approve,
    accounting_cancel_permission,
    accounting_update,
)
from app.routers.expense_finance import _hr_accounting_query, accounting_stats
from app.services import hr_expense_integration_service as service


class HrExpenseIntegrationContractTests(unittest.IsolatedAsyncioTestCase):
    def test_webhook_signature_requires_matching_hmac(self):
        body = b'{"event_id":"event-1"}'
        with patch.object(settings, "HR_EXPENSE_INTEGRATION_WEBHOOK_SECRET", "shared-secret"):
            signature = "sha256=" + hmac.new(b"shared-secret", body, hashlib.sha256).hexdigest()
            self.assertTrue(service.verify_webhook_signature(body, signature))
            self.assertFalse(service.verify_webhook_signature(body + b"x", signature))
            self.assertFalse(service.verify_webhook_signature(body, None))

    def test_snapshot_storage_removes_raw_financial_identifiers(self):
        original = {
            "payee": {"bank_account_number": "1234567890", "bank_account_last4": "7890"},
            "tax": {"payee_tax_id": "0105559999999", "payee_tax_id_last4": "9999"},
        }
        sanitized = service._sanitized_snapshot(original)
        self.assertNotIn("bank_account_number", sanitized["payee"])
        self.assertNotIn("payee_tax_id", sanitized["tax"])
        self.assertEqual(original["payee"]["bank_account_number"], "1234567890")

    def test_upload_decoder_accepts_supported_base64_and_rejects_executable(self):
        encoded = base64.b64encode(b"proof").decode()
        name, content, mime = service.decode_upload("slip.png", encoded)
        self.assertEqual((name, content, mime), ("slip.png", b"proof", "image/png"))
        with self.assertRaises(service.HrExpenseIntegrationError):
            service.decode_upload("payload.exe", encoded)

    async def test_mutation_client_sends_actor_version_and_idempotency_headers(self):
        response = httpx.Response(200, json={"success": True}, request=httpx.Request("POST", "https://hr.test"))
        client = AsyncMock()
        client.request.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=None)
        with (
            patch.object(settings, "HR_EXPENSE_INTEGRATION_ENABLED", True),
            patch.object(settings, "HR_EXPENSE_INTEGRATION_BASE_URL", "https://hr.test"),
            patch.object(settings, "HR_EXPENSE_INTEGRATION_TOKEN", "service-token"),
            patch.object(httpx, "AsyncClient", return_value=context),
        ):
            await service._request(
                "POST", "expense-requests/request-1/accounting/review",
                actor_employee_id="EMP-001", version=7, idempotency_key="action-key-001",
                json={"withholding_decision": "none"},
            )
        headers = client.request.await_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], "Bearer service-token")
        self.assertEqual(headers["X-Actor-Employee-Id"], "EMP-001")
        self.assertEqual(headers["If-Match"], '"7"')
        self.assertEqual(headers["Idempotency-Key"], "action-key-001")

    def test_mutation_routes_use_existing_accounting_permissions(self):
        review_dependency = inspect.signature(router.review_hr_expense).parameters["current_user"].default
        return_dependency = inspect.signature(router.return_hr_expense).parameters["current_user"].default
        cancel_dependency = inspect.signature(router.cancel_hr_expense).parameters["current_user"].default
        pay_dependency = inspect.signature(router.pay_hr_expense).parameters["current_user"].default
        proof_dependency = inspect.signature(router.replace_hr_payment_proof).parameters["current_user"].default
        void_dependency = inspect.signature(router.void_hr_payment).parameters["current_user"].default
        settlement_dependency = inspect.signature(router.review_hr_settlement).parameters["current_user"].default
        wht_dependency = inspect.signature(router.create_hr_withholding_certificate).parameters["current_user"].default
        self.assertIs(review_dependency.dependency, accounting_update)
        self.assertIs(return_dependency.dependency, accounting_update)
        self.assertIs(cancel_dependency.dependency, accounting_cancel_permission)
        self.assertIs(pay_dependency.dependency, accounting_update)
        self.assertIs(proof_dependency.dependency, accounting_update)
        self.assertIs(void_dependency.dependency, accounting_cancel_permission)
        self.assertIs(settlement_dependency.dependency, accounting_approve)
        self.assertIs(wht_dependency.dependency, accounting_update)

    def test_projection_date_matches_hr_submitted_date_filter(self):
        item = {
            "updated_at": "2026-09-11T12:00:00Z",
            "request": {
                "submitted_at": "2026-09-09T08:30:00Z",
                "required_date": "2026-09-17",
            },
        }
        self.assertEqual(service._projection_request_date(item), date(2026, 9, 9))

    def test_event_company_code_reads_the_authoritative_snapshot(self):
        event = SimpleNamespace(payload={"request": {"company": {"code": "KB"}}})
        self.assertEqual(service._event_company_code(event), "KB")

    def test_hr_projection_query_uses_unified_filters(self):
        statement = _hr_accounting_query(
            SimpleNamespace(id=9), statuses=["ready_to_pay"], department_ids=[3],
            type_ids=[4], date_from=date(2026, 9, 1), date_to=date(2026, 9, 30),
            withholding_only=True, has_tax_invoice=True, query="HR-EXP",
        )
        parameters = list(statement.compile().params.values())
        self.assertIn(["ready_to_pay"], parameters)
        self.assertIn([3], parameters)
        self.assertIn([4], parameters)
        self.assertIn("%HR-EXP%", parameters)
        self.assertIn("coalesce(hr_expense_request_projections.vat_amount", str(statement).lower())

    async def test_accounting_stats_include_hr_projection_amounts(self):
        class Result:
            def __init__(self, rows):
                self.rows = rows
            def scalars(self):
                return self
            def all(self):
                return self.rows

        hr_row = SimpleNamespace(
            status="ready_to_pay", remaining_amount=Decimal("250.00"),
            net_amount=Decimal("250.00"),
        )
        db = SimpleNamespace(execute=AsyncMock(side_effect=[Result([]), Result([hr_row])]))
        result = await accounting_stats(
            statuses="ready_to_pay", db=db, current_user=SimpleNamespace(),
            company=SimpleNamespace(id=9),
        )
        self.assertEqual(result.ready_to_pay_count, 1)
        self.assertEqual(result.ready_to_pay_amount, Decimal("250.00"))
        self.assertEqual(result.transfer_amount_total, Decimal("250.00"))

    async def test_hr_source_filter_skips_native_accounting_query(self):
        class Result:
            def scalars(self):
                return self
            def all(self):
                return [SimpleNamespace(
                    status="ready_to_pay", remaining_amount=Decimal("99.00"),
                    net_amount=Decimal("99.00"),
                )]

        db = SimpleNamespace(execute=AsyncMock(return_value=Result()))
        result = await accounting_stats(
            source_system="hr", db=db, current_user=SimpleNamespace(),
            company=SimpleNamespace(id=9),
        )
        self.assertEqual(db.execute.await_count, 1)
        sql = str(db.execute.await_args.args[0])
        self.assertIn("hr_expense_request_projections", sql)
        self.assertEqual(result.ready_to_pay_amount, Decimal("99.00"))


if __name__ == "__main__":
    unittest.main()
