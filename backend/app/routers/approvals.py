"""
Position-based expense approval workflow — endpoints for:
  /api/positions, /api/expense-types, /api/approval-policy-versions,
  /api/approval-rules, /api/position-primary-approvers, /api/approval-delegations,
  /api/expense-requests, /api/approval-routes/preview, /api/approvals/inbox,
  /api/approval-steps/{id}/decisions
"""
from datetime import datetime, timezone
from decimal import Decimal
import mimetypes
from pathlib import Path
from typing import Optional
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_company, get_current_user, require_admin
from app.models.approval import (
    ApprovalDelegation,
    ApprovalPolicyVersion,
    ApprovalRequestStep,
    ApprovalRule,
    ApprovalRuleStep,
    ExpenseRequest,
    ExpenseRequestAttachment,
    ExpenseRequestItem,
    ExpenseType,
    Position,
    PositionPrimaryApprover,
    UserPosition,
)
from app.models.company import Company
from app.models.user import User
from app.schemas.approval import (
    DecisionIn,
    DelegationCreate,
    DelegationOut,
    ExpenseRequestCreate,
    ExpenseRequestDraftUpdate,
    ExpenseRequestDetailOut,
    ExpenseRequestOut,
    ExpenseTypeCreate,
    ExpenseTypeOut,
    ExpenseTypeUpdate,
    InboxItemOut,
    PolicyVersionCreate,
    PolicyVersionOut,
    PositionCreate,
    PositionOut,
    PositionUpdate,
    PrimaryApproverOut,
    PrimaryApproverSet,
    RoutePreviewOut,
    RuleCreate,
    RuleOut,
    RuleStepOut,
    UserPositionCreate,
    UserPositionOut,
)
from app.services import approval_service, expense_request_service
from app.core.config import settings

router = APIRouter(tags=["Approvals"])


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

async def _get_company_row(db: AsyncSession, model, row_id, company_id: int, not_found: str):
    obj = (
        await db.execute(select(model).where(model.id == row_id, model.company_id == company_id))
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(404, not_found)
    return obj


def _amount_range(amount_min: Decimal, amount_max: Optional[Decimal]) -> Range:
    return Range(amount_min, amount_max, bounds="(]")


async def _rule_to_out(db: AsyncSession, rule: ApprovalRule, company_id: int) -> RuleOut:
    steps = await approval_service.get_rule_steps(db, rule.id)
    positions = {
        p.id: p.name
        for p in (await db.execute(select(Position).where(Position.company_id == company_id))).scalars().all()
    }
    expense_type = await db.get(ExpenseType, rule.expense_type_id)
    amount_min = rule.amount_range.lower or Decimal("0")
    amount_max = rule.amount_range.upper
    return RuleOut(
        id=rule.id,
        requester_position_id=rule.requester_position_id,
        requester_position_name=positions.get(rule.requester_position_id),
        expense_type_id=rule.expense_type_id,
        expense_type_name=expense_type.name if expense_type else None,
        # asyncpg decodes numrange bounds via a (sign, digits, exponent) tuple, which
        # can yield round numbers like Decimal('1E+4') — quantize back to money's 2dp.
        amount_min=amount_min.quantize(Decimal("0.01")),
        amount_max=amount_max.quantize(Decimal("0.01")) if amount_max is not None else None,
        steps=[
            RuleStepOut(
                step_no=s.step_no,
                approver_position_id=s.approver_position_id,
                approver_position_name=positions.get(s.approver_position_id),
            )
            for s in steps
        ],
    )


# ═══════════════════════════════════════════════════════════════════════════
# Admin — positions
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/positions", response_model=list[PositionOut])
async def list_positions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(Position).where(Position.company_id == company.id).order_by(Position.name)
    )
    return result.scalars().all()


@router.post("/positions", response_model=PositionOut, status_code=201)
async def create_position(
    payload: PositionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = Position(company_id=company.id, name=payload.name, is_active=payload.is_active)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch("/positions/{position_id}", response_model=PositionOut)
async def update_position(
    position_id: int,
    payload: PositionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, Position, position_id, company.id, "ไม่พบตำแหน่งนี้")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


# ═══════════════════════════════════════════════════════════════════════════
# Requester — my positions (subset of positions assigned to the current user)
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/my-positions", response_model=list[PositionOut])
async def list_my_positions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(Position)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == current_user.id,
            UserPosition.company_id == company.id,
            UserPosition.is_active.is_(True),
            Position.is_active.is_(True),
        )
        .order_by(Position.name)
    )
    return result.scalars().all()


@router.get("/user-positions", response_model=list[UserPositionOut])
async def list_user_positions(
    user_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    q = select(UserPosition).where(UserPosition.company_id == company.id)
    if user_id:
        q = q.where(UserPosition.user_id == user_id)
    rows = (await db.execute(q)).scalars().all()
    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    return [
        UserPositionOut(
            id=r.id, user_id=r.user_id, position_id=r.position_id,
            position_name=positions.get(r.position_id),
            user_full_name=users.get(r.user_id),
            is_active=r.is_active,
        )
        for r in rows
    ]


@router.post("/user-positions", response_model=UserPositionOut, status_code=201)
async def assign_user_position(
    payload: UserPositionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    await _get_company_row(db, Position, payload.position_id, company.id, "ไม่พบตำแหน่งนี้")
    obj = UserPosition(company_id=company.id, user_id=payload.user_id, position_id=payload.position_id)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return UserPositionOut(id=obj.id, user_id=obj.user_id, position_id=obj.position_id, is_active=obj.is_active)


@router.delete("/user-positions/{row_id}", status_code=204)
async def remove_user_position(
    row_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, UserPosition, row_id, company.id, "ไม่พบข้อมูลนี้")
    await db.delete(obj)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Admin — expense types
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/expense-types", response_model=list[ExpenseTypeOut])
async def list_expense_types(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(ExpenseType).where(ExpenseType.company_id == company.id).order_by(ExpenseType.name)
    )
    return result.scalars().all()


@router.post("/expense-types", response_model=ExpenseTypeOut, status_code=201)
async def create_expense_type(
    payload: ExpenseTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = ExpenseType(company_id=company.id, **payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch("/expense-types/{expense_type_id}", response_model=ExpenseTypeOut)
async def update_expense_type(
    expense_type_id: int,
    payload: ExpenseTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, ExpenseType, expense_type_id, company.id, "ไม่พบประเภทการเบิกนี้")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


# ═══════════════════════════════════════════════════════════════════════════
# Admin — approval policy versions & rules
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/approval-policy-versions", response_model=list[PolicyVersionOut])
async def list_policy_versions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(ApprovalPolicyVersion)
        .where(ApprovalPolicyVersion.company_id == company.id)
        .order_by(ApprovalPolicyVersion.version_no.desc())
    )
    return result.scalars().all()


@router.post("/approval-policy-versions", response_model=PolicyVersionOut, status_code=201)
async def create_policy_version(
    payload: PolicyVersionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    max_version = (
        await db.execute(
            select(ApprovalPolicyVersion.version_no)
            .where(ApprovalPolicyVersion.company_id == company.id)
            .order_by(ApprovalPolicyVersion.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none() or 0
    obj = ApprovalPolicyVersion(
        company_id=company.id,
        version_no=max_version + 1,
        status="draft",
        created_by=current_user.id,
        **payload.model_dump(),
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.post("/approval-policy-versions/{version_id}/activate", response_model=PolicyVersionOut)
async def activate_policy_version(
    version_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(
        db, ApprovalPolicyVersion, version_id, company.id, "ไม่พบเวอร์ชันสายอนุมัตินี้"
    )
    if obj.status == "retired":
        raise HTTPException(400, "เวอร์ชันนี้ถูกปิดใช้งานแล้ว ไม่สามารถเปิดใช้ซ้ำได้")

    current_active = await approval_service.get_active_policy_version(db, company.id)
    if current_active and current_active.id != obj.id:
        current_active.status = "retired"
    obj.status = "active"
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/approval-policy-versions/{version_id}/rules", response_model=list[RuleOut])
async def list_rules(
    version_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    await _get_company_row(db, ApprovalPolicyVersion, version_id, company.id, "ไม่พบเวอร์ชันสายอนุมัตินี้")
    rules = (
        await db.execute(select(ApprovalRule).where(ApprovalRule.policy_version_id == version_id))
    ).scalars().all()
    return [await _rule_to_out(db, r, company.id) for r in rules]


@router.post("/approval-policy-versions/{version_id}/rules", response_model=RuleOut, status_code=201)
async def create_rule(
    version_id: int,
    payload: RuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    await _get_company_row(db, ApprovalPolicyVersion, version_id, company.id, "ไม่พบเวอร์ชันสายอนุมัตินี้")
    await _get_company_row(db, Position, payload.requester_position_id, company.id, "ไม่พบตำแหน่งผู้เบิก")
    await _get_company_row(db, ExpenseType, payload.expense_type_id, company.id, "ไม่พบประเภทการเบิก")
    for step in payload.steps:
        await _get_company_row(db, Position, step.approver_position_id, company.id, "ไม่พบตำแหน่งผู้อนุมัติ")

    if payload.amount_max is not None and payload.amount_max <= payload.amount_min:
        raise HTTPException(400, "ยอดเงินสูงสุดต้องมากกว่ายอดเงินต่ำสุด")

    step_nos = [s.step_no for s in payload.steps]
    if len(set(step_nos)) != len(step_nos) or sorted(step_nos) != list(range(1, len(step_nos) + 1)):
        raise HTTPException(400, "ลำดับขั้นตอนต้องเรียง 1, 2, 3, ... ต่อเนื่องกันโดยไม่ซ้ำ")

    rule = ApprovalRule(
        policy_version_id=version_id,
        requester_position_id=payload.requester_position_id,
        expense_type_id=payload.expense_type_id,
        amount_range=_amount_range(payload.amount_min, payload.amount_max),
    )
    db.add(rule)
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        if "ex_approval_rules_no_overlap" in str(exc):
            raise HTTPException(409, "ช่วงยอดเงินนี้ทับซ้อนกับกฎที่มีอยู่แล้วสำหรับตำแหน่ง/ประเภทการเบิกเดียวกัน")
        raise

    for step in payload.steps:
        db.add(ApprovalRuleStep(
            approval_rule_id=rule.id, step_no=step.step_no, approver_position_id=step.approver_position_id
        ))
    await db.commit()
    await db.refresh(rule)
    return await _rule_to_out(db, rule, company.id)


@router.delete("/approval-rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    rule = (await db.execute(select(ApprovalRule).where(ApprovalRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "ไม่พบกฎนี้")
    version = await db.get(ApprovalPolicyVersion, rule.policy_version_id)
    if not version or version.company_id != company.id:
        raise HTTPException(404, "ไม่พบกฎนี้")
    await db.delete(rule)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Admin — primary approvers & delegations
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/position-primary-approvers", response_model=list[PrimaryApproverOut])
async def list_primary_approvers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    rows = (
        await db.execute(
            select(PositionPrimaryApprover).where(PositionPrimaryApprover.company_id == company.id)
        )
    ).scalars().all()
    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    return [
        PrimaryApproverOut(
            id=r.id, position_id=r.position_id, position_name=positions.get(r.position_id),
            user_id=r.user_id, user_full_name=users.get(r.user_id), is_active=r.is_active,
        )
        for r in rows
    ]


@router.post("/position-primary-approvers", response_model=PrimaryApproverOut, status_code=201)
async def set_primary_approver(
    payload: PrimaryApproverSet,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    await _get_company_row(db, Position, payload.position_id, company.id, "ไม่พบตำแหน่งนี้")
    existing = (
        await db.execute(
            select(PositionPrimaryApprover).where(
                PositionPrimaryApprover.position_id == payload.position_id,
                PositionPrimaryApprover.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.is_active = False
    obj = PositionPrimaryApprover(company_id=company.id, position_id=payload.position_id, user_id=payload.user_id)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return PrimaryApproverOut(
        id=obj.id, position_id=obj.position_id, user_id=obj.user_id, is_active=obj.is_active
    )


@router.delete("/position-primary-approvers/{row_id}", status_code=204)
async def remove_primary_approver(
    row_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, PositionPrimaryApprover, row_id, company.id, "ไม่พบข้อมูลนี้")
    obj.is_active = False
    await db.commit()


@router.get("/approval-delegations", response_model=list[DelegationOut])
async def list_delegations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    rows = (
        await db.execute(
            select(ApprovalDelegation)
            .where(ApprovalDelegation.company_id == company.id)
            .order_by(ApprovalDelegation.starts_at.desc())
        )
    ).scalars().all()
    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    return [
        DelegationOut(
            id=r.id, position_id=r.position_id, position_name=positions.get(r.position_id),
            delegate_user_id=r.delegate_user_id, delegate_full_name=users.get(r.delegate_user_id),
            starts_at=r.starts_at, ends_at=r.ends_at, reason=r.reason,
        )
        for r in rows
    ]


@router.post("/approval-delegations", response_model=DelegationOut, status_code=201)
async def create_delegation(
    payload: DelegationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    await _get_company_row(db, Position, payload.position_id, company.id, "ไม่พบตำแหน่งนี้")
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(400, "วันสิ้นสุดต้องมากกว่าวันเริ่มต้น")
    obj = ApprovalDelegation(company_id=company.id, created_by=current_user.id, **payload.model_dump())
    db.add(obj)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        if "ex_delegation_no_overlap" in str(exc):
            raise HTTPException(409, "ช่วงเวลานี้ทับซ้อนกับการมอบหมายงานอื่นของตำแหน่งเดียวกัน")
        raise
    await db.refresh(obj)
    return DelegationOut(
        id=obj.id, position_id=obj.position_id, delegate_user_id=obj.delegate_user_id,
        starts_at=obj.starts_at, ends_at=obj.ends_at, reason=obj.reason,
    )


@router.delete("/approval-delegations/{row_id}", status_code=204)
async def delete_delegation(
    row_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, ApprovalDelegation, row_id, company.id, "ไม่พบข้อมูลนี้")
    await db.delete(obj)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Requester — route preview
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/approval-routes/preview", response_model=RoutePreviewOut)
async def preview_route(
    requester_position_id: int,
    expense_type_id: int,
    amount: Decimal,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    result = await approval_service.preview_route(
        db, company.id, requester_position_id, expense_type_id, amount
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════
# Requester — expense requests
# ═══════════════════════════════════════════════════════════════════════════

async def _request_items(db: AsyncSession, request_id: str) -> list[ExpenseRequestItem]:
    return list((await db.execute(
        select(ExpenseRequestItem)
        .where(ExpenseRequestItem.expense_request_id == request_id)
        .order_by(ExpenseRequestItem.sort_order, ExpenseRequestItem.id)
    )).scalars().all())


async def _request_attachments(db: AsyncSession, request_id: str) -> list[ExpenseRequestAttachment]:
    return list((await db.execute(
        select(ExpenseRequestAttachment)
        .where(ExpenseRequestAttachment.expense_request_id == request_id)
        .order_by(ExpenseRequestAttachment.attachment_type, ExpenseRequestAttachment.created_at)
    )).scalars().all())


async def _request_to_out(
    db: AsyncSession, req: ExpenseRequest, *, include_sensitive: bool = False
) -> ExpenseRequestOut:
    requester = await db.get(User, req.requester_user_id)
    position = await db.get(Position, req.requester_position_id)
    expense_type = await db.get(ExpenseType, req.expense_type_id)
    items = await _request_items(db, req.id)
    totals = expense_request_service.calculate_totals(req, items)
    masked = f"••••{req.bank_account_last4}" if req.bank_account_last4 else None
    return ExpenseRequestOut(
        id=req.id, request_no=req.request_no, requester_user_id=req.requester_user_id,
        requester_name=(requester.full_name or requester.username) if requester else None,
        requester_position_id=req.requester_position_id,
        requester_position_name=position.name if position else None,
        expense_type_id=req.expense_type_id,
        expense_type_name=expense_type.name if expense_type else None,
        amount=req.amount, title=req.title, description=req.description,
        request_date=req.request_date, request_format=req.request_format,
        payer_company_name=req.payer_company_name,
        recipient_type=req.recipient_type, recipient_name=req.recipient_name,
        bank_name=req.bank_name, bank_account_name=req.bank_account_name,
        bank_account_number=(expense_request_service.decrypt_account_number(req.bank_account_number_encrypted)
                             if include_sensitive else None),
        bank_account_masked=masked, subtotal=totals["subtotal"],
        vat_mode=req.vat_mode, vat_rate=req.vat_rate, vat_amount=totals["vat_amount"],
        withholding_required=req.withholding_required,
        withholding_mode=req.withholding_mode, withholding_rate=req.withholding_rate,
        withholding_amount=totals["withholding_amount"], payable_total=totals["payable_total"],
        taxpayer_name=req.taxpayer_name, taxpayer_id=req.taxpayer_id,
        taxpayer_address=req.taxpayer_address, status=req.status,
        current_step_no=req.current_step_no, submitted_at=req.submitted_at,
        decided_at=req.decided_at, created_at=req.created_at,
    )


@router.get("/expense-requests", response_model=list[ExpenseRequestOut])
async def list_expense_requests(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    status: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    # q = select(ExpenseRequest).where(ExpenseRequest.company_id == company.id)
    q = select(ExpenseRequest).where(
        ExpenseRequest.company_id == company.id,
        ExpenseRequest.status != "approved",
    )
    if scope == "mine" or not current_user.is_platform_admin:
        q = q.where(ExpenseRequest.requester_user_id == current_user.id)
    if status:
        # เมื่อผู้ใช้เลือกสถานะ ให้แสดงสถานะนั้นตามปกติ
        q = q.where(ExpenseRequest.status == status)
    else:
        # หน้ารายการเริ่มต้นไม่แสดงรายการที่อนุมัติแล้ว
        q = q.where(ExpenseRequest.status != "approved")
        
    q = q.order_by(ExpenseRequest.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()
    return [await _request_to_out(db, r) for r in rows]


@router.post("/expense-requests", response_model=ExpenseRequestOut, status_code=201)
async def create_expense_request(
    payload: ExpenseRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    await _get_company_row(db, Position, payload.requester_position_id, company.id, "ไม่พบตำแหน่งผู้เบิก")
    await _get_company_row(db, ExpenseType, payload.expense_type_id, company.id, "ไม่พบประเภทการเบิก")
    data = payload.model_dump(exclude={"bank_account_number"})
    bank_account_number = payload.bank_account_number or ""
    obj = ExpenseRequest(
        company_id=company.id, requester_user_id=current_user.id, status="draft",
        payer_company_name=payload.payer_company_name or company.name_th,
        bank_account_number_encrypted=expense_request_service.encrypt_account_number(bank_account_number),
        bank_account_last4=bank_account_number[-4:] or None,
        **{key: value for key, value in data.items() if key != "payer_company_name"},
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return await _request_to_out(db, obj, include_sensitive=True)


@router.get("/expense-requests/{request_id}", response_model=ExpenseRequestDetailOut)
async def get_expense_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    steps = (
        await db.execute(
            select(ApprovalRequestStep)
            .where(ApprovalRequestStep.expense_request_id == request_id)
            .order_by(ApprovalRequestStep.step_no)
        )
    ).scalars().all()
    is_participant = req.requester_user_id == current_user.id or any(
        s.resolved_approver_user_id == current_user.id for s in steps
    )
    if not (is_participant or current_user.is_platform_admin):
        raise HTTPException(403, "คุณไม่มีสิทธิ์ดูคำขอนี้")

    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    base = await _request_to_out(db, req, include_sensitive=True)
    items = await _request_items(db, request_id)
    attachments = await _request_attachments(db, request_id)
    return ExpenseRequestDetailOut(
        **base.model_dump(),
        items=[
            {
                "id": item.id, "sort_order": item.sort_order,
                "description": item.description, "quantity": item.quantity,
                "unit": item.unit, "unit_price": item.unit_price,
                "line_total": item.line_total,
            }
            for item in items
        ],
        attachments=[
            {
                "id": item.id, "attachment_type": item.attachment_type,
                "file_name": item.file_name, "content_type": item.content_type,
                "file_size": item.file_size, "created_at": item.created_at,
            }
            for item in attachments
        ],
        steps=[
            {
                "id": s.id, "step_no": s.step_no,
                "approver_position_id": s.approver_position_id,
                "approver_position_name": positions.get(s.approver_position_id),
                "resolved_approver_user_id": s.resolved_approver_user_id,
                "resolved_approver_name": users.get(s.resolved_approver_user_id) if s.resolved_approver_user_id else None,
                "status": s.status, "comment": s.comment,
                "decided_by": s.decided_by, "decided_at": s.decided_at,
            }
            for s in steps
        ],
    )


@router.patch("/expense-requests/{request_id}", response_model=ExpenseRequestOut)
async def update_expense_request_draft(
    request_id: str,
    payload: ExpenseRequestDraftUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id:
        raise HTTPException(403, "คุณไม่ใช่เจ้าของคำขอนี้")
    if req.status != "draft":
        raise HTTPException(400, "แก้ไขได้เฉพาะคำขอที่เป็นแบบร่างเท่านั้น")

    data = payload.model_dump(exclude_unset=True)
    items_payload = data.pop("items", None)
    account_number = data.pop("bank_account_number", None)
    if "requester_position_id" in data:
        await _get_company_row(db, Position, data["requester_position_id"], company.id, "ไม่พบตำแหน่งผู้เบิก")
    if "expense_type_id" in data:
        await _get_company_row(db, ExpenseType, data["expense_type_id"], company.id, "ไม่พบประเภทการเบิก")

    for key, value in data.items():
        setattr(req, key, value)
    if account_number is not None:
        normalized = "".join(account_number.split())
        req.bank_account_number_encrypted = expense_request_service.encrypt_account_number(normalized)
        req.bank_account_last4 = normalized[-4:] or None

    if items_payload is not None:
        await db.execute(delete(ExpenseRequestItem).where(ExpenseRequestItem.expense_request_id == request_id))
        for index, item in enumerate(items_payload, start=1):
            line_total = expense_request_service.money(item["quantity"] * item["unit_price"])
            db.add(ExpenseRequestItem(
                expense_request_id=request_id, sort_order=index,
                description=item["description"].strip(), quantity=item["quantity"],
                unit=item["unit"].strip(), unit_price=item["unit_price"], line_total=line_total,
            ))
        await db.flush()

    items = await _request_items(db, request_id)
    totals = expense_request_service.calculate_totals(req, items)
    req.amount = totals["grand_total"]
    req.vat_amount = totals["vat_amount"]
    req.withholding_amount = totals["withholding_amount"]
    req.updated_at = datetime.now(timezone.utc)
    # Any draft edit makes the generated approval PDF stale. It will be
    # recreated automatically when the requester opens the attachment step.
    old_primary = next((a for a in await _request_attachments(db, request_id) if a.attachment_type == "primary"), None)
    if old_primary:
        try:
            Path(old_primary.file_path).unlink(missing_ok=True)
        except OSError:
            pass
        await db.delete(old_primary)
    await db.commit()
    await db.refresh(req)
    return await _request_to_out(db, req, include_sensitive=True)


@router.post("/expense-requests/{request_id}/attachments", status_code=201)
async def upload_expense_request_attachment(
    request_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id or req.status != "draft":
        raise HTTPException(403, "อัปโหลดเอกสารได้เฉพาะเจ้าของคำขอที่เป็นแบบร่าง")
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()
    allowed = {".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx"}
    if not filename or extension not in allowed:
        raise HTTPException(400, "รองรับเฉพาะ PDF, JPG, JPEG, PNG, DOC, DOCX, XLS และ XLSX")
    existing = await _request_attachments(db, request_id)
    if len([item for item in existing if item.attachment_type == "supporting"]) >= 10:
        raise HTTPException(400, "แนบเอกสารประกอบได้สูงสุด 10 ไฟล์")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "ไฟล์ต้องมีขนาดไม่เกิน 10 MB")

    stored_name = f"{uuid.uuid4().hex}{extension}"
    path = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / stored_name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    attachment = ExpenseRequestAttachment(
        expense_request_id=request_id, attachment_type="supporting",
        file_name=filename, stored_name=stored_name, file_path=str(path),
        content_type=file.content_type or mimetypes.guess_type(filename)[0],
        file_size=len(content), uploaded_by=current_user.id,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return {
        "id": attachment.id, "attachment_type": attachment.attachment_type,
        "file_name": attachment.file_name, "content_type": attachment.content_type,
        "file_size": attachment.file_size, "created_at": attachment.created_at,
    }


@router.post("/expense-requests/{request_id}/generate-primary-document", status_code=201)
async def generate_expense_request_primary_document(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id or req.status != "draft":
        raise HTTPException(403, "สร้างเอกสารได้เฉพาะเจ้าของคำขอที่เป็นแบบร่าง")
    items = await _request_items(db, request_id)
    if not items:
        raise HTTPException(400, "กรุณากรอกรายการค่าใช้จ่ายก่อนสร้างเอกสาร")

    old_primary = next((a for a in await _request_attachments(db, request_id) if a.attachment_type == "primary"), None)
    if old_primary:
        try:
            Path(old_primary.file_path).unlink(missing_ok=True)
        except OSError:
            pass
        await db.delete(old_primary)
        await db.flush()

    position = await db.get(Position, req.requester_position_id)
    expense_type = await db.get(ExpenseType, req.expense_type_id)
    filename = "เอกสารหลักสำหรับอนุมัติ (PDF).pdf"
    stored_name = f"primary-{uuid.uuid4().hex}.pdf"
    path = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / stored_name
    expense_request_service.render_payment_approval_pdf(
        req, items, company, current_user,
        position.name if position else "-", expense_type.name if expense_type else "-", path,
    )
    attachment = ExpenseRequestAttachment(
        expense_request_id=request_id, attachment_type="primary",
        file_name=filename, stored_name=stored_name, file_path=str(path),
        content_type="application/pdf", file_size=path.stat().st_size,
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return {
        "id": attachment.id, "attachment_type": attachment.attachment_type,
        "file_name": attachment.file_name, "content_type": attachment.content_type,
        "file_size": attachment.file_size, "created_at": attachment.created_at,
    }


@router.get("/expense-requests/{request_id}/attachments/{attachment_id}")
async def view_expense_request_attachment(
    request_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    steps = (await db.execute(select(ApprovalRequestStep).where(
        ApprovalRequestStep.expense_request_id == request_id,
        ApprovalRequestStep.resolved_approver_user_id == current_user.id,
    ))).scalars().all()
    if not (req.requester_user_id == current_user.id or steps or current_user.is_platform_admin):
        raise HTTPException(403, "คุณไม่มีสิทธิ์ดูเอกสารนี้")
    attachment = (await db.execute(select(ExpenseRequestAttachment).where(
        ExpenseRequestAttachment.id == attachment_id,
        ExpenseRequestAttachment.expense_request_id == request_id,
    ))).scalar_one_or_none()
    if not attachment or not Path(attachment.file_path).is_file():
        raise HTTPException(404, "ไม่พบไฟล์แนบนี้")
    return FileResponse(
        attachment.file_path,
        media_type=attachment.content_type or "application/octet-stream",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(attachment.file_name)}"},
    )


@router.delete("/expense-requests/{request_id}/attachments/{attachment_id}", status_code=204)
async def delete_expense_request_attachment(
    request_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id or req.status != "draft":
        raise HTTPException(403, "ลบเอกสารได้เฉพาะเจ้าของคำขอที่เป็นแบบร่าง")
    attachment = (await db.execute(select(ExpenseRequestAttachment).where(
        ExpenseRequestAttachment.id == attachment_id,
        ExpenseRequestAttachment.expense_request_id == request_id,
        ExpenseRequestAttachment.attachment_type == "supporting",
    ))).scalar_one_or_none()
    if not attachment:
        raise HTTPException(404, "ไม่พบเอกสารประกอบนี้")
    try:
        Path(attachment.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    await db.delete(attachment)
    await db.commit()


@router.post("/expense-requests/{request_id}/submit", response_model=ExpenseRequestOut)
async def submit_expense_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id:
        raise HTTPException(403, "คุณไม่ใช่เจ้าของคำขอนี้")
    items = await _request_items(db, request_id)
    attachments = await _request_attachments(db, request_id)
    missing: list[str] = []
    if not all([req.title, req.request_date, req.recipient_type, req.recipient_name,
                req.bank_name, req.bank_account_name, req.bank_account_number_encrypted]):
        missing.append("ข้อมูลคำขอและบัญชีผู้รับเงิน")
    if not items or req.amount <= 0:
        missing.append("รายการค่าใช้จ่าย")
    if req.withholding_required and not all([req.taxpayer_name, req.taxpayer_id, req.taxpayer_address]):
        missing.append("ข้อมูลภาษีสำหรับฝ่ายบัญชี")
    if not any(item.attachment_type == "primary" for item in attachments):
        missing.append("เอกสารหลักสำหรับอนุมัติ")
    if not any(item.attachment_type == "supporting" for item in attachments):
        missing.append("เอกสารประกอบเพิ่มเติม")
    if missing:
        raise HTTPException(400, f"ข้อมูลยังไม่ครบ: {', '.join(missing)}")
    try:
        req = await approval_service.submit_expense_request(db, req)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return await _request_to_out(db, req)


@router.delete("/expense-requests/{request_id}", status_code=204)
async def cancel_expense_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id:
        raise HTTPException(403, "คุณไม่ใช่เจ้าของคำขอนี้")
    if req.status != "draft":
        raise HTTPException(400, "ยกเลิกได้เฉพาะคำขอที่ยังไม่ส่ง (draft) เท่านั้น")
    req.status = "cancelled"
    await db.commit()


@router.delete("/expense-requests/{request_id}/permanent", status_code=204)
async def permanently_delete_expense_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if req.requester_user_id != current_user.id:
        raise HTTPException(403, "คุณไม่ใช่เจ้าของคำขอนี้")
    if req.status not in {"draft", "cancelled"}:
        raise HTTPException(400, "ลบทิ้งถาวรได้เฉพาะคำขอแบบร่างหรือคำขอที่ยกเลิกแล้ว")

    attachments = await _request_attachments(db, request_id)
    for attachment in attachments:
        try:
            Path(attachment.file_path).unlink(missing_ok=True)
        except OSError:
            pass
    await db.delete(req)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Approver — inbox & decisions
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/approvals/inbox", response_model=list[InboxItemOut])
async def get_inbox(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    rows = (
        await db.execute(
            select(ApprovalRequestStep, ExpenseRequest)
            .join(ExpenseRequest, ExpenseRequest.id == ApprovalRequestStep.expense_request_id)
            .where(
                ApprovalRequestStep.resolved_approver_user_id == current_user.id,
                ApprovalRequestStep.status == "pending",
                ExpenseRequest.company_id == company.id,
            )
            .order_by(ExpenseRequest.submitted_at)
        )
    ).all()
    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    expense_types = {e.id: e.name for e in (await db.execute(select(ExpenseType).where(ExpenseType.company_id == company.id))).scalars().all()}
    return [
        InboxItemOut(
            step_id=step.id, step_no=step.step_no, expense_request_id=req.id,
            title=req.title, amount=req.amount, requester_user_id=req.requester_user_id,
            requester_name=users.get(req.requester_user_id),
            requester_position_name=positions.get(req.requester_position_id),
            expense_type_name=expense_types.get(req.expense_type_id),
            request_date=req.request_date, submitted_at=req.submitted_at,
        )
        for step, req in rows
    ]


@router.post("/approval-steps/{step_id}/decisions", response_model=ExpenseRequestDetailOut)
async def decide_approval_step(
    step_id: int,
    payload: DecisionIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    try:
        step = await approval_service.decide_step(
            db, step_id, current_user.id, payload.action, payload.comment, payload.idempotency_key
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    return await get_expense_request(step.expense_request_id, db, current_user, company)
