"""Regression coverage for server-generated primary slots rejected by decisions."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Request
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.routers.approvals import decide_approval_step
from app.schemas.approval import DecisionIn
from app.services.expense_signature_service import primary_document_defaults


class ApprovalSignatureValidationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.step = SimpleNamespace(id=12, expense_request_id="request", resolved_approver_user_id=53)
        self.request = SimpleNamespace(id="request", company_id=1, current_revision=1)
        self.user = SimpleNamespace(id=53, is_platform_admin=False)
        self.company = SimpleNamespace(id=1)
        self.http_request = Request({"type": "http", "headers": []})
        self.stamp = AsyncMock()
        self.decide = AsyncMock(return_value=self.step)
        for target, replacement in (
            ("_get_company_row", AsyncMock(return_value=self.request)),
            ("get_expense_request", AsyncMock(return_value="approved-detail")),
            ("expense_signature_service.stamp_required_documents", self.stamp),
            ("approval_service.decide_step", self.decide),
        ):
            patcher = patch(f"app.routers.approvals.{target}", replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def approve(self, placements, attachments=None):
        rows = [("primary-id", "primary")] if attachments is None else attachments
        db = SimpleNamespace(
            get=AsyncMock(return_value=self.step),
            execute=AsyncMock(side_effect=[
                SimpleNamespace(all=lambda: rows, scalars=lambda: SimpleNamespace(
                    all=lambda: [attachment_id for attachment_id, _ in rows],
                )),
                SimpleNamespace(scalar_one_or_none=lambda: None),
            ]),
            flush=AsyncMock(), rollback=AsyncMock(),
        )
        return await decide_approval_step(
            self.step.id,
            DecisionIn(action="approve", idempotency_key="test-decision",
                       signature_data_url="data:image/png;base64,test", placements=placements),
            self.http_request, db, self.user, self.company,
        )

    def placement(self):
        return dict(attachment_id="primary-id", page_number=1, x=.53, y=.80,
                    width=.155, height=.0166292555)

    async def test_pdf_generated_defaults_reach_stamping_and_approval(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "primary.pdf"
            pdf = canvas.Canvas(str(source), pagesize=A4)
            # Same 12pt signature / 10pt name boxes as the generated form.
            for x in (37, 174, 311):
                pdf.rect(x, 150, 112, 12)
                pdf.rect(x - 8, 137, 128, 10)
            pdf.save()
            defaults = primary_document_defaults(source, 2)
        self.assertGreater(defaults["default_signature_height"], 0)
        self.assertLess(defaults["default_signature_height"], .02)
        placement = {key.removeprefix("default_signature_"): value for key, value in defaults.items()}
        placement["page_number"] = placement.pop("page")
        placement["attachment_id"] = "primary-id"
        self.assertEqual(await self.approve([placement]), "approved-detail")
        self.stamp.assert_awaited_once()
        self.assertEqual(self.stamp.await_args.args[-1], [placement])
        self.decide.assert_awaited_once()

    async def test_supporting_document_keeps_minimum_height(self):
        placement = self.placement()
        placement["attachment_id"] = "support-id"
        with self.assertRaises(HTTPException) as raised:
            await self.approve([placement], [("support-id", "supporting")])
        self.assertEqual(raised.exception.status_code, 400)
        self.stamp.assert_not_awaited()
        self.decide.assert_not_awaited()

    async def test_valid_supporting_document_is_accepted(self):
        placement = {**self.placement(), "attachment_id": "support-id", "height": .02}
        self.assertEqual(await self.approve([placement], [("support-id", "supporting")]), "approved-detail")

    async def test_invalid_primary_geometry_is_rejected_before_stamping(self):
        for changes in ({"height": 0}, {"height": -.01}, {"y": .999},
                        {"height": float("nan")}, {"x": float("inf")},
                        {"page_number": float("inf")}, {"width": .01}):
            with self.subTest(changes=changes), self.assertRaises(HTTPException) as raised:
                await self.approve([{**self.placement(), **changes}])
            self.assertEqual(raised.exception.status_code, 400)
        self.stamp.assert_not_awaited()
        self.decide.assert_not_awaited()

    async def test_missing_required_placement_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await self.approve([])
        self.assertEqual(raised.exception.status_code, 400)
        self.stamp.assert_not_awaited()

    async def test_small_primary_slot_does_not_bypass_approver_permission(self):
        self.user.id = 99
        with self.assertRaises(HTTPException) as raised:
            await self.approve([self.placement()])
        self.assertEqual(raised.exception.status_code, 403)
        self.stamp.assert_not_awaited()
        self.decide.assert_not_awaited()
