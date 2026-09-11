"""ACC-facing proxy and HR webhook for the HR-owned expense lifecycle."""
from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_company
from app.models.company import Company
from app.models.hr_expense_integration import HrExpenseIntegrationEvent, HrExpenseRequestProjection
from app.models.user import User
from app.routers.expense_finance import (
    accounting_approve,
    accounting_cancel_permission,
    accounting_update,
    accounting_view,
)
from app.services import hr_expense_integration_service as integration
from app.services.expense_request_service import decrypt_account_number


router = APIRouter(tags=["HR Expense Integration"])


class MutationMeta(BaseModel):
    expected_version: int = Field(ge=0)
    idempotency_key: str = Field(min_length=8, max_length=120)


class ReviewIn(MutationMeta):
    withholding_decision: Literal["none", "deduct", "already_withheld"] | None = None
    tax_base: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)


class ReasonIn(MutationMeta):
    reason: str = Field(min_length=3, max_length=2000)


class PaymentIn(MutationMeta):
    paid_date: date
    reference_number: str | None = Field(default=None, max_length=255)
    proof_file_name: str | None = Field(default=None, max_length=255)
    proof_content_base64: str | None = None

    @model_validator(mode="after")
    def proof_fields_are_paired(self):
        if bool(self.proof_file_name) != bool(self.proof_content_base64):
            raise ValueError("ต้องส่งชื่อไฟล์และเนื้อหาหลักฐานการจ่ายมาด้วยกัน")
        return self


class ProofIn(MutationMeta):
    proof_file_name: str = Field(min_length=1, max_length=255)
    proof_content_base64: str = Field(min_length=1)
    reason: str | None = Field(default=None, max_length=2000)


class SettlementReviewIn(MutationMeta):
    action: Literal["approve", "return"]
    accounting_note: str | None = Field(default=None, max_length=2000)


class WithholdingCertificateIn(MutationMeta):
    certificate_number: str = Field(min_length=1, max_length=50)
    issued_date: date
    tax_base: Decimal = Field(ge=0)
    tax_rate: Decimal = Field(ge=0, le=100)
    tax_amount: Decimal = Field(ge=0)


async def _projection(
    db: AsyncSession, integration_id: str, company_id: int,
) -> HrExpenseRequestProjection:
    row = (await db.execute(select(HrExpenseRequestProjection).where(
        HrExpenseRequestProjection.integration_id == integration_id,
        HrExpenseRequestProjection.company_id == company_id,
        HrExpenseRequestProjection.is_deleted.is_(False),
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบคำขอเบิกจาก HR นี้ในบริษัทที่เลือก")
    return row


def _assert_resource(row: HrExpenseRequestProjection, collection: str, resource_id: str) -> None:
    snapshot = row.snapshot or {}
    if collection == "settlement":
        resources = [snapshot.get("settlement") or {}]
    else:
        resources = snapshot.get(collection) or []
    if not any(str(item.get("integration_id") or "") == resource_id for item in resources):
        raise HTTPException(404, "ไม่พบเอกสารการเงินนี้ในคำขอที่เลือก")


def _actor(user: User) -> str:
    employee_id = (user.hr_employee_id or user.username or "").strip()
    if not employee_id:
        raise HTTPException(422, "ผู้ใช้ ACC ยังไม่ได้ผูก Employee ID ของ HR")
    return employee_id


def _raise_integration_error(exc: integration.HrExpenseIntegrationError) -> None:
    detail: object = exc.payload or str(exc)
    raise HTTPException(exc.status_code, detail)


@router.post("/integrations/hr/expenses/refresh")
async def refresh_hr_expenses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    try:
        return await integration.refresh_projection(db, company)
    except integration.HrExpenseIntegrationError as exc:
        _raise_integration_error(exc)


@router.get("/integrations/hr/expense-requests/{integration_id}")
async def hr_expense_detail(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    if integration.is_configured():
        try:
            item = await integration.get_detail(integration_id)
            row = await integration.upsert_projection(db, item, preserve_sensitive_if_missing=False)
            await db.commit()
            return {"item": item, "stale": False}
        except integration.HrExpenseIntegrationError:
            # A failed outbound GET has not changed the local transaction, so
            # retain the RLS-bound company context for the cached fallback.
            pass

    item = dict(row.snapshot or {})
    item.setdefault("payee", {})["bank_account_number"] = decrypt_account_number(
        row.bank_account_number_encrypted
    )
    return {"item": item, "stale": True}


async def _mutate_request(
    db: AsyncSession,
    company: Company,
    user: User,
    integration_id: str,
    payload: MutationMeta,
    path: str,
    *,
    method: str = "POST",
    body: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
) -> dict:
    await _projection(db, integration_id, company.id)
    try:
        return await integration.mutate(
            db,
            method=method,
            path=path,
            actor_employee_id=_actor(user),
            version=payload.expected_version,
            idempotency_key=payload.idempotency_key,
            json=body,
            data=data,
            files=files,
        )
    except integration.HrExpenseIntegrationError as exc:
        _raise_integration_error(exc)


@router.post("/integrations/hr/expense-requests/{integration_id}/accounting/review")
async def review_hr_expense(
    integration_id: str, payload: ReviewIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    body = payload.model_dump(exclude={"expected_version", "idempotency_key"}, exclude_none=True)
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"expense-requests/{integration_id}/accounting/review", body=body,
    )


@router.post("/integrations/hr/expense-requests/{integration_id}/accounting/return")
async def return_hr_expense(
    integration_id: str, payload: ReasonIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"expense-requests/{integration_id}/accounting/return", body={"comments": payload.reason},
    )


@router.post("/integrations/hr/expense-requests/{integration_id}/accounting/cancel")
async def cancel_hr_expense(
    integration_id: str, payload: ReasonIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_cancel_permission),
    company: Company = Depends(get_current_company),
):
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"expense-requests/{integration_id}/accounting/cancel", body={"reason": payload.reason},
    )


@router.post("/integrations/hr/expense-requests/{integration_id}/payments")
async def pay_hr_expense(
    integration_id: str, payload: PaymentIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    data = {"paid_date": payload.paid_date.isoformat()}
    if payload.reference_number:
        data["reference_number"] = payload.reference_number
    files = None
    if payload.proof_file_name and payload.proof_content_base64:
        name, content, mime = integration.decode_upload(
            payload.proof_file_name, payload.proof_content_base64,
        )
        files = {"payment_proof": (name, content, mime)}
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"expense-requests/{integration_id}/payments", data=data, files=files,
    )


@router.patch("/integrations/hr/expense-requests/{integration_id}/payments/{payment_id}/proof")
async def replace_hr_payment_proof(
    integration_id: str, payment_id: str, payload: ProofIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    _assert_resource(row, "payments", payment_id)
    name, content, mime = integration.decode_upload(payload.proof_file_name, payload.proof_content_base64)
    data = {"reason": payload.reason} if payload.reason else None
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"payments/{payment_id}/proof", method="PATCH", data=data,
        files={"payment_proof": (name, content, mime)},
    )


@router.post("/integrations/hr/expense-requests/{integration_id}/payments/{payment_id}/void")
async def void_hr_payment(
    integration_id: str, payment_id: str, payload: ReasonIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_cancel_permission),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    _assert_resource(row, "payments", payment_id)
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"payments/{payment_id}/void", body={"reason": payload.reason},
    )


@router.post("/integrations/hr/expense-requests/{integration_id}/settlements/{settlement_id}/review")
async def review_hr_settlement(
    integration_id: str, settlement_id: str, payload: SettlementReviewIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_approve),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    _assert_resource(row, "settlement", settlement_id)
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"settlements/{settlement_id}/review",
        body={"action": payload.action, "accounting_note": payload.accounting_note},
    )


@router.post("/integrations/hr/expense-requests/{integration_id}/withholding-certificates")
async def create_hr_withholding_certificate(
    integration_id: str, payload: WithholdingCertificateIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    body = payload.model_dump(exclude={"expected_version", "idempotency_key"}, mode="json")
    return await _mutate_request(
        db, company, current_user, integration_id, payload,
        f"expense-requests/{integration_id}/withholding-certificates", body=body,
    )


async def _private_file(
    db: AsyncSession, company: Company, integration_id: str, remote_path: str,
) -> Response:
    await _projection(db, integration_id, company.id)
    try:
        content, media_type, content_disposition = await integration.get_private_file(remote_path)
    except integration.HrExpenseIntegrationError as exc:
        _raise_integration_error(exc)
    headers = {"Cache-Control": "private, no-store"}
    if content_disposition:
        headers["Content-Disposition"] = content_disposition.replace("\r", "").replace("\n", "")
    return Response(content, media_type=media_type, headers=headers)


@router.get("/integrations/hr/expense-requests/{integration_id}/payments/{payment_id}/proof")
async def hr_payment_proof(
    integration_id: str, payment_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    _assert_resource(row, "payments", payment_id)
    return await _private_file(db, company, integration_id, f"payments/{payment_id}/proof")


@router.get("/integrations/hr/expense-requests/{integration_id}/attachments/{attachment_id}/content")
async def hr_attachment_content(
    integration_id: str, attachment_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    _assert_resource(row, "attachments", attachment_id)
    return await _private_file(db, company, integration_id, f"attachments/{attachment_id}/content")


@router.get("/integrations/hr/expense-requests/{integration_id}/withholding-certificates/{certificate_id}/content")
async def hr_withholding_content(
    integration_id: str, certificate_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    row = await _projection(db, integration_id, company.id)
    _assert_resource(row, "withholding_certificates", certificate_id)
    return await _private_file(
        db, company, integration_id, f"withholding-certificates/{certificate_id}/content",
    )


@router.post("/integrations/hr/v1/events", status_code=status.HTTP_202_ACCEPTED)
async def receive_hr_expense_event(
    request: Request,
    x_integration_signature: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    raw_body = await request.body()
    if len(raw_body) > 1024 * 1024:
        raise HTTPException(413, "event มีขนาดใหญ่เกินกำหนด")
    if not integration.verify_webhook_signature(raw_body, x_integration_signature):
        raise HTTPException(401, "ลายเซ็น webhook ไม่ถูกต้อง")
    try:
        payload = json.loads(raw_body)
        event_id = str(uuid.UUID(str(payload["event_id"])))
        seq = int(payload["seq"])
        aggregate_id = str(uuid.UUID(str(payload["aggregate_integration_id"])))
        aggregate_version = int(payload["aggregate_version"])
        event_type = str(payload["event_type"])
        if seq < 1 or aggregate_version < 0 or not event_type or len(event_type) > 120:
            raise ValueError("event metadata")
        occurred_at = integration._parse_datetime(payload["occurred_at"])
        if not occurred_at:
            raise ValueError("occurred_at")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(422, "รูปแบบ event จาก HR ไม่ครบถ้วน") from exc

    existing = (await db.execute(select(HrExpenseIntegrationEvent).where(or_(
        HrExpenseIntegrationEvent.event_id == event_id,
        HrExpenseIntegrationEvent.seq == seq,
    )))).scalar_one_or_none()
    if existing:
        if existing.event_id != event_id or existing.seq != seq:
            raise HTTPException(409, "event id หรือ sequence ชนกับข้อมูลเดิม")
        return {"accepted": True, "duplicate": True}
    db.add(HrExpenseIntegrationEvent(
        event_id=event_id,
        seq=seq,
        aggregate_integration_id=aggregate_id,
        aggregate_version=aggregate_version,
        event_type=event_type,
        payload=payload.get("payload") or {},
        occurred_at=occurred_at,
    ))
    await db.commit()
    return {"accepted": True, "duplicate": False}
