import inspect
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.models.expense_finance import ExpensePayment, ExpenseRequestHistory
from app.routers.expense_finance import (
    ACCOUNTING_STATUSES, _accounting_query, _accounting_transfer_amount,
    accounting_stats, accounting_transfer, accounting_view,
)
from app.schemas.expense_finance import AccountingTransferIn, PaymentIn
from app.services import expense_finance_service as finance


def request(status="ready_to_pay"):
    return SimpleNamespace(
        id="request-1", company_id=9, current_revision=1, version=1,
        status=status, net_amount=Decimal("125"), amount=Decimal("125"),
        paid_amount=Decimal("0"), remaining_amount=Decimal("125"),
        request_format="reimbursement", request_no="TEST-TRANSFER",
        requester_user_id=7, installment_enabled=False,
        installment_payment_amount=None, installment_chain_root_id=None,
        settlement_due_date=None,
    )


def database(*values):
    results = [Mock(scalar_one_or_none=Mock(return_value=value),
                    scalar_one=Mock(return_value=value)) for value in values]
    return SimpleNamespace(execute=AsyncMock(side_effect=results), add=Mock(),
                           commit=AsyncMock(), refresh=AsyncMock())


class TransferStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_mark_transfer_persists_history_without_recording_payment(self):
        for status in ("ready_to_pay", "partially_paid"):
            req, db = request(status), database(None)
            self.assertEqual(await finance.set_transfer_status(db, req, True, 7), "awaiting_slip")
            db.commit.assert_awaited_once()
            self.assertEqual(req.paid_amount, Decimal("0"))
            self.assertEqual(req.remaining_amount, Decimal("125"))
            self.assertEqual(req.version, 2)
            history = db.add.call_args.args[0]
            self.assertIsInstance(history, ExpenseRequestHistory)
            self.assertEqual((history.from_status, history.to_status), (status, "awaiting_slip"))
            self.assertEqual(history.actor_user_id, 7)

    async def test_uncheck_restores_exact_previous_status_including_adjustments(self):
        for original_status in ("ready_to_pay", "partially_paid"):
            req, db = request("awaiting_slip"), database(original_status)
            req.paid_amount = Decimal("100")
            self.assertEqual(await finance.set_transfer_status(db, req, False, 7), original_status)
            self.assertEqual(db.add.call_args.args[0].event, "transfer_unmarked")

    async def test_repeated_checkbox_value_does_not_duplicate_history(self):
        for status, checked in (("awaiting_slip", True), ("ready_to_pay", False)):
            db = database()
            self.assertEqual(await finance.set_transfer_status(db, request(status), checked, 7), status)
            db.add.assert_not_called()

    async def test_pending_approval_and_closed_requests_cannot_be_marked(self):
        for status in ("pending_approval", "accounting_review", "completed", "settlement_due", "cancelled"):
            db = database()
            with self.assertRaises(ValueError):
                await finance.set_transfer_status(db, request(status), True, 7)
            db.commit.assert_not_awaited()

    async def test_incomplete_approval_blocks_transfer(self):
        req, db = request(), database(42)
        with self.assertRaisesRegex(ValueError, "ยังไม่ครบ"):
            await finance.set_transfer_status(db, req, True, 7)
        self.assertEqual(req.status, "ready_to_pay")
        db.add.assert_not_called()

    async def test_missing_history_does_not_guess_previous_status(self):
        req, db = request("awaiting_slip"), database(None)
        with self.assertRaises(ValueError):
            await finance.set_transfer_status(db, req, False, 7)
        self.assertEqual(req.status, "awaiting_slip")

    async def test_payment_with_slip_completes_marked_request(self):
        req = request("awaiting_slip")
        db = database(None, req)
        payload = PaymentIn(amount=Decimal("125"), paid_at=datetime.now(timezone.utc),
                            idempotency_key="test-transfer-slip", proof_file_name="slip.png",
                            proof_content_base64="c2xpcA==")
        with patch.object(finance, "_store", return_value=("/tmp/test-slip.png", "hash")):
            payment = await finance.record_payment(db, req, payload, 7)
        self.assertIsInstance(payment, ExpensePayment)
        self.assertEqual(req.status, "completed")
        self.assertEqual(req.remaining_amount, Decimal("0"))
        self.assertEqual(req.paid_amount, Decimal("125"))

    async def test_marked_request_still_requires_slip_to_record_payment(self):
        req = request("awaiting_slip")
        db = database(None, req)
        payload = PaymentIn(amount=Decimal("125"), paid_at=datetime.now(timezone.utc),
                            idempotency_key="test-transfer-no-slip")
        with self.assertRaisesRegex(ValueError, "แนบหลักฐาน"):
            await finance.record_payment(db, req, payload, 7)
        self.assertEqual(req.status, "awaiting_slip")
        db.commit.assert_not_awaited()

    async def test_route_locks_request_and_scopes_company(self):
        req, db = request(), database(None)
        with patch("app.routers.expense_finance._request", new=AsyncMock(return_value=req)) as lookup:
            result = await accounting_transfer(req.id, AccountingTransferIn(transferred=True),
                                               db, SimpleNamespace(id=7), SimpleNamespace(id=9))
        lookup.assert_awaited_once_with(db, req.id, 9, lock=True)
        self.assertEqual(result, {"status": "awaiting_slip"})
        permission = inspect.signature(accounting_transfer).parameters["current_user"].default
        self.assertIs(permission.dependency, accounting_view)

    async def test_stats_and_totals_use_awaiting_slip_filter(self):
        results = []
        for rows in ([request("awaiting_slip")], [], [], []):
            result = Mock()
            result.scalars.return_value.all.return_value = rows
            results.append(result)
        db = SimpleNamespace(execute=AsyncMock(side_effect=results))
        result = await accounting_stats(statuses="awaiting_slip", db=db,
                                         company=SimpleNamespace(id=9), current_user=SimpleNamespace())
        self.assertEqual(result.awaiting_slip_count, 1)
        self.assertEqual(result.ready_to_pay_count, 0)
        self.assertEqual(result.transfer_amount_total, Decimal("125"))
        sql = str(db.execute.call_args_list[0].args[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        self.assertIn("expense_requests.status IN ('awaiting_slip')", sql)

    def test_default_list_and_exports_recognize_new_status(self):
        self.assertIn("awaiting_slip", ACCOUNTING_STATUSES)
        self.assertEqual(finance.ACCOUNTING_STATUS_LABELS["awaiting_slip"], "รอแนบสลิป")
        params = list(_accounting_query(SimpleNamespace(id=9)).compile().params.values())
        self.assertIn(ACCOUNTING_STATUSES, params)

    def test_adjustment_transfer_amount_does_not_change_when_marked(self):
        req = request()
        req.request_format, req.current_revision = "advance", 2
        settlement = SimpleNamespace(settlement_type="additional", difference_amount=Decimal("25"))
        settlements = {req.id: settlement}
        before = _accounting_transfer_amount(req, {req.id}, settlements)
        req.status = "awaiting_slip"
        self.assertEqual(_accounting_transfer_amount(req, {req.id}, settlements), before)


if __name__ == "__main__":
    unittest.main()
