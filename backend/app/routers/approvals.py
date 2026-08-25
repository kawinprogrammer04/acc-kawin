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
import re
import uuid
import hashlib
import shutil
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_company, get_current_user, require_permission
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
from app.models.company import Company, UserCompany
from app.models.user import User
from app.models.expense_finance import (
    Department,
    ExpenseApprovalCandidate,
    ExpenseAttachmentRequirement,
    ExpensePayment,
    ExpenseRequestHistory,
    ExpenseRequestLegacyApprovalStep,
)
from app.schemas.approval import (
    DecisionIn,
    DelegationCreate,
    DelegationOut,
    ExpenseInstallmentCreate,
    ExpenseInstallmentSiblingOut,
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
    RuleUpdate,
    RuleStepOut,
    UserPositionCreate,
    UserPositionOut,
)
from app.services import approval_service, expense_request_service, expense_signature_service
from app.core.config import settings

router = APIRouter(tags=["Approvals"])
settings_view = require_permission("expense_settings.view", legacy_min_role="admin")
settings_create = require_permission("expense_settings.create", legacy_min_role="admin")
settings_update = require_permission("expense_settings.update", legacy_min_role="admin")
settings_delete = require_permission("expense_settings.delete", legacy_min_role="admin")
settings_approve = require_permission("expense_settings.approve", legacy_min_role="admin")


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


async def _validate_position_department(
    db: AsyncSession, department_id: Optional[int], company_id: int,
) -> None:
    if department_id is None:
        return
    department = (
        await db.execute(
            select(Department).where(
                Department.id == department_id,
                Department.company_id == company_id,
                Department.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not department:
        raise HTTPException(400, "ไม่พบแผนกที่เลือก หรือแผนกถูกปิดใช้งานแล้ว")


async def _is_company_accounting(db: AsyncSession, user: User, company_id: int) -> bool:
    if user.is_platform_admin:
        return True
    role = (await db.execute(select(UserCompany.role).where(
        UserCompany.user_id == user.id, UserCompany.company_id == company_id,
        UserCompany.is_active.is_(True),
    ))).scalar_one_or_none()
    return role in {"accountant", "admin", "super_admin"}


async def _can_view_all_company_requests(db: AsyncSession, user: User, company_id: int) -> bool:
    """super_admin (company-level role, distinct from the global is_platform_admin
    flag) sees every employee's expense requests and approvals, not just their own."""
    if user.is_platform_admin:
        return True
    role = (await db.execute(select(UserCompany.role).where(
        UserCompany.user_id == user.id, UserCompany.company_id == company_id,
        UserCompany.is_active.is_(True),
    ))).scalar_one_or_none()
    return role == "super_admin"


def _amount_range(amount_min: Decimal, amount_max: Optional[Decimal]) -> Range:
    return Range(amount_min, amount_max, bounds="(]")


def _rule_specificity(source_scope: Optional[dict], request_kind: Optional[str]) -> int:
    if not source_scope:
        return 3 + int(request_kind is not None)
    return sum(source_scope.get(field) is not None for field in (
        "department_name", "requester_position_name", "expense_type_code", "request_kind",
    ))


async def _rule_to_out(db: AsyncSession, rule: ApprovalRule, company_id: int) -> RuleOut:
    steps = await approval_service.get_rule_steps(db, rule.id)
    position_rows = list((await db.execute(select(Position).where(Position.company_id == company_id))).scalars().all())
    positions = {p.id: p.name for p in position_rows}
    position_departments = {p.id: p.department_id for p in position_rows}
    department_ids = {p.department_id for p in position_rows if p.department_id is not None}
    departments = {
        d.id: d.name
        for d in (await db.execute(select(Department).where(Department.id.in_(department_ids)))).scalars().all()
    } if department_ids else {}
    user_rows = list((await db.execute(
        select(User).join(UserCompany, UserCompany.user_id == User.id).where(
            User.is_active.is_(True), UserCompany.company_id == company_id, UserCompany.is_active.is_(True),
        )
    )).scalars().all())
    users = {u.id: (u.full_name or u.username) for u in user_rows}
    expense_type = await db.get(ExpenseType, rule.expense_type_id)
    amount_min = rule.amount_range.lower or Decimal("0")
    amount_max = rule.amount_range.upper
    requester_department_id = position_departments.get(rule.requester_position_id)
    target_name = lambda step: (
        "หัวหน้าของผู้ขอ" if step.target_type == "direct_supervisor"
        else users.get(step.target_user_id) if step.target_type == "user"
        else positions.get(step.approver_position_id) or step.name
    )
    return RuleOut(
        id=rule.id,
        requester_position_id=rule.requester_position_id,
        requester_position_name=positions.get(rule.requester_position_id),
        requester_department_id=requester_department_id,
        requester_department_name=departments.get(requester_department_id),
        expense_type_id=rule.expense_type_id,
        expense_type_name=expense_type.name if expense_type else None,
        # asyncpg decodes numrange bounds via a (sign, digits, exponent) tuple, which
        # can yield round numbers like Decimal('1E+4') — quantize back to money's 2dp.
        amount_min=amount_min.quantize(Decimal("0.01")),
        amount_max=amount_max.quantize(Decimal("0.01")) if amount_max is not None else None,
        name=rule.source_policy_name,
        request_kind=rule.request_kind,
        priority=rule.priority,
        specificity=rule.specificity,
        source_system=rule.source_system,
        source_policy_id=rule.source_policy_id,
        logical_group_key=rule.logical_group_key,
        source_scope=rule.source_scope,
        is_active=rule.is_active,
        steps=[
            RuleStepOut(
                step_no=s.step_no,
                name=s.name or target_name(s),
                target_type=s.target_type,
                target_id=s.target_user_id if s.target_type == "user" else s.approver_position_id,
                target_name=target_name(s),
                approve_mode=s.approve_mode,
                approver_position_id=s.approver_position_id,
                approver_position_name=positions.get(s.approver_position_id) or s.name,
            )
            for s in steps
        ],
    )


async def _normalize_rule_steps(db: AsyncSession, steps, company_id: int) -> list[dict]:
    step_nos = [step.step_no for step in steps]
    if len(set(step_nos)) != len(step_nos) or sorted(step_nos) != list(range(1, len(step_nos) + 1)):
        raise HTTPException(400, "ลำดับขั้นตอนต้องเรียง 1, 2, 3, ... ต่อเนื่องกันโดยไม่ซ้ำ")

    normalized = []
    for step in steps:
        target_id = step.target_id or step.approver_position_id
        if step.target_type == "direct_supervisor":
            target_id = None
            position_id = None
            user_id = None
            default_name = "หัวหน้าของผู้ขอ"
        elif step.target_type in {"position", "hr_position"}:
            if not target_id:
                raise HTTPException(400, "กรุณาเลือกตำแหน่งผู้อนุมัติให้ครบทุกขั้น")
            await _get_company_row(db, Position, target_id, company_id, "ไม่พบตำแหน่งผู้อนุมัติ")
            position_id = target_id
            user_id = None
            default_name = "ตำแหน่งผู้อนุมัติ"
        elif step.target_type == "user":
            if not target_id:
                raise HTTPException(400, "กรุณาเลือกผู้อนุมัติให้ครบทุกขั้น")
            user = (await db.execute(
                select(User).join(UserCompany, UserCompany.user_id == User.id).where(
                    User.id == target_id, User.is_active.is_(True),
                    UserCompany.company_id == company_id, UserCompany.is_active.is_(True),
                )
            )).scalar_one_or_none()
            if not user:
                raise HTTPException(400, "ผู้อนุมัติที่เลือกไม่พร้อมใช้งาน")
            position_id = None
            user_id = target_id
            default_name = user.full_name or user.username
        else:
            raise HTTPException(400, "ชนิดผู้อนุมัติไม่ถูกต้อง")
        normalized.append({
            "step_no": step.step_no,
            "name": step.name or default_name,
            "approve_mode": step.approve_mode,
            "target_type": step.target_type,
            "approver_position_id": position_id,
            "target_user_id": user_id,
        })
    return normalized


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
        select(Position).where(
            Position.company_id == company.id,
            Position.is_active.is_(True),
        ).order_by(Position.name)
    )
    return result.scalars().all()


@router.post("/positions", response_model=PositionOut, status_code=201)
async def create_position(
    payload: PositionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_create),
    company: Company = Depends(get_current_company),
):
    await _validate_position_department(db, payload.department_id, company.id)
    obj = (await db.execute(select(Position).where(
        Position.company_id == company.id,
        Position.name == payload.name,
    ).with_for_update())).scalar_one_or_none()
    if obj and obj.is_active:
        raise HTTPException(409, "มีชื่อตำแหน่งนี้อยู่แล้ว")
    if obj:
        obj.department_id = payload.department_id
        obj.is_active = True
        obj.updated_at = datetime.now(timezone.utc)
    else:
        obj = Position(
            company_id=company.id,
            name=payload.name,
            department_id=payload.department_id,
            is_active=payload.is_active,
        )
        db.add(obj)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "มีชื่อตำแหน่งนี้อยู่แล้ว") from exc
    await db.refresh(obj)
    return obj


@router.patch("/positions/{position_id}", response_model=PositionOut)
async def update_position(
    position_id: int,
    payload: PositionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_update),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, Position, position_id, company.id, "ไม่พบตำแหน่งนี้")
    if "department_id" in payload.model_fields_set:
        await _validate_position_department(db, payload.department_id, company.id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    obj.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "มีชื่อตำแหน่งนี้อยู่แล้ว") from exc
    await db.refresh(obj)
    return obj


@router.delete("/positions/{position_id}", status_code=204)
async def delete_position(
    position_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_delete),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, Position, position_id, company.id, "ไม่พบตำแหน่งนี้")
    await db.execute(
        delete(UserPosition).where(
            UserPosition.company_id == company.id,
            UserPosition.position_id == position_id,
        )
    )
    await db.execute(
        update(PositionPrimaryApprover)
        .where(
            PositionPrimaryApprover.company_id == company.id,
            PositionPrimaryApprover.position_id == position_id,
        )
        .values(is_active=False, updated_at=datetime.now(timezone.utc))
    )
    obj.is_active = False
    obj.updated_at = datetime.now(timezone.utc)
    await db.commit()


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
    current_user: User = Depends(settings_view),
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
    current_user: User = Depends(settings_create),
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
    current_user: User = Depends(settings_delete),
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
    current_user: User = Depends(settings_create),
    company: Company = Depends(get_current_company),
):
    obj = ExpenseType(company_id=company.id, **payload.model_dump())
    db.add(obj)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "มีรหัสประเภทค่าใช้จ่ายนี้อยู่แล้ว") from exc
    await db.refresh(obj)
    return obj


@router.patch("/expense-types/{expense_type_id}", response_model=ExpenseTypeOut)
async def update_expense_type(
    expense_type_id: int,
    payload: ExpenseTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_update),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, ExpenseType, expense_type_id, company.id, "ไม่พบประเภทการเบิกนี้")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    obj.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "มีรหัสประเภทค่าใช้จ่ายนี้อยู่แล้ว") from exc
    await db.refresh(obj)
    return obj


@router.delete("/expense-types/{expense_type_id}")
async def delete_expense_type(
    expense_type_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_delete),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, ExpenseType, expense_type_id, company.id, "ไม่พบประเภทการเบิกนี้")

    in_use = (
        await db.execute(
            select(func.count()).select_from(ExpenseRequest).where(
                ExpenseRequest.company_id == company.id,
                ExpenseRequest.expense_type_id == expense_type_id,
            )
        )
    ).scalar_one()

    if in_use:
        # ประเภทนี้เคยถูกใช้บันทึกคำขอเบิกแล้ว — ปิดการใช้งานแทนการลบถาวร
        obj.is_active = False
        obj.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(obj)
        return {"deactivated": True, "expense_type": ExpenseTypeOut.model_validate(obj)}

    rule_ids = (
        await db.execute(select(ApprovalRule.id).where(ApprovalRule.expense_type_id == expense_type_id))
    ).scalars().all()
    if rule_ids:
        await db.execute(delete(ApprovalRuleStep).where(ApprovalRuleStep.approval_rule_id.in_(rule_ids)))
        await db.execute(delete(ApprovalRule).where(ApprovalRule.id.in_(rule_ids)))
    await db.execute(
        delete(ExpenseAttachmentRequirement).where(
            ExpenseAttachmentRequirement.company_id == company.id,
            ExpenseAttachmentRequirement.expense_type_id == expense_type_id,
        )
    )
    await db.delete(obj)
    await db.commit()
    return {"deactivated": False}


# ═══════════════════════════════════════════════════════════════════════════
# Admin — approval policy versions & rules
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/approval-policy-versions", response_model=list[PolicyVersionOut])
async def list_policy_versions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_view),
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
    current_user: User = Depends(settings_create),
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
    current_user: User = Depends(settings_approve),
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
    current_user: User = Depends(settings_view),
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
    current_user: User = Depends(settings_create),
    company: Company = Depends(get_current_company),
):
    version = await _get_company_row(db, ApprovalPolicyVersion, version_id, company.id, "ไม่พบเวอร์ชันสายอนุมัตินี้")
    if version.status == "retired":
        raise HTTPException(400, "ไม่สามารถเพิ่มกฎในเวอร์ชันที่ปิดใช้งานแล้ว")
    requester_position = await _get_company_row(db, Position, payload.requester_position_id, company.id, "ไม่พบตำแหน่งผู้เบิก")
    await _get_company_row(db, ExpenseType, payload.expense_type_id, company.id, "ไม่พบประเภทการเบิก")

    if payload.amount_max is not None and payload.amount_max <= payload.amount_min:
        raise HTTPException(400, "ยอดเงินสูงสุดต้องมากกว่ายอดเงินต่ำสุด")

    normalized_steps = await _normalize_rule_steps(db, payload.steps, company.id)

    rule = ApprovalRule(
        policy_version_id=version_id,
        requester_position_id=payload.requester_position_id,
        expense_type_id=payload.expense_type_id,
        amount_range=_amount_range(payload.amount_min, payload.amount_max),
        source_system=payload.source_system or "acc",
        source_policy_id=payload.source_policy_id,
        source_policy_name=payload.name or f"{requester_position.name} / กฎอนุมัติ",
        logical_group_key=payload.logical_group_key or f"acc:{uuid.uuid4()}",
        source_scope=payload.source_scope,
        priority=payload.priority,
        specificity=_rule_specificity(payload.source_scope, payload.request_kind),
        request_kind=payload.request_kind,
    )
    db.add(rule)
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        if "ex_approval_rules_no_overlap" in str(exc):
            raise HTTPException(409, "ช่วงยอดเงินนี้ทับซ้อนกับกฎที่มีอยู่แล้วสำหรับตำแหน่ง/ประเภทการเบิกเดียวกัน")
        raise

    for step in normalized_steps:
        db.add(ApprovalRuleStep(approval_rule_id=rule.id, **step))
    await db.commit()
    await db.refresh(rule)
    return await _rule_to_out(db, rule, company.id)


@router.patch("/approval-rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: int,
    payload: RuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_update),
    company: Company = Depends(get_current_company),
):
    rule = (await db.execute(select(ApprovalRule).where(ApprovalRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "ไม่พบกฎนี้")
    version = await db.get(ApprovalPolicyVersion, rule.policy_version_id)
    if not version or version.company_id != company.id:
        raise HTTPException(404, "ไม่พบกฎนี้")
    if version.status == "retired":
        raise HTTPException(400, "ไม่สามารถแก้ไขกฎในเวอร์ชันที่ปิดใช้งานแล้ว")

    requester_position_id = payload.requester_position_id if "requester_position_id" in payload.model_fields_set else rule.requester_position_id
    expense_type_id = payload.expense_type_id if "expense_type_id" in payload.model_fields_set else rule.expense_type_id
    amount_min = payload.amount_min if "amount_min" in payload.model_fields_set else (rule.amount_range.lower or Decimal("0"))
    amount_max = payload.amount_max if "amount_max" in payload.model_fields_set else rule.amount_range.upper
    await _get_company_row(db, Position, requester_position_id, company.id, "ไม่พบตำแหน่งผู้เบิก")
    await _get_company_row(db, ExpenseType, expense_type_id, company.id, "ไม่พบประเภทการเบิก")
    if amount_max is not None and amount_max <= amount_min:
        raise HTTPException(400, "ยอดเงินสูงสุดต้องมากกว่ายอดเงินต่ำสุด")

    if payload.steps is not None:
        normalized_steps = await _normalize_rule_steps(db, payload.steps, company.id)
        await db.execute(delete(ApprovalRuleStep).where(ApprovalRuleStep.approval_rule_id == rule.id))
        for step in normalized_steps:
            db.add(ApprovalRuleStep(approval_rule_id=rule.id, **step))

    rule.requester_position_id = requester_position_id
    rule.expense_type_id = expense_type_id
    rule.amount_range = _amount_range(amount_min, amount_max)
    if "name" in payload.model_fields_set:
        rule.source_policy_name = payload.name
    if "request_kind" in payload.model_fields_set:
        rule.request_kind = payload.request_kind
    if "priority" in payload.model_fields_set and payload.priority is not None:
        rule.priority = payload.priority
    if "is_active" in payload.model_fields_set and payload.is_active is not None:
        rule.is_active = payload.is_active
    if "source_scope" in payload.model_fields_set:
        rule.source_scope = payload.source_scope
    rule.specificity = _rule_specificity(rule.source_scope, rule.request_kind)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "กฎนี้มีช่วงยอดเงินทับซ้อนกับกฎอื่น") from exc
    await db.refresh(rule)
    return await _rule_to_out(db, rule, company.id)


@router.delete("/approval-rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_delete),
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
    current_user: User = Depends(settings_view),
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
    current_user: User = Depends(settings_update),
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
    current_user: User = Depends(settings_delete),
    company: Company = Depends(get_current_company),
):
    obj = await _get_company_row(db, PositionPrimaryApprover, row_id, company.id, "ไม่พบข้อมูลนี้")
    obj.is_active = False
    await db.commit()


@router.get("/approval-delegations", response_model=list[DelegationOut])
async def list_delegations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(settings_view),
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
    current_user: User = Depends(settings_create),
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
    current_user: User = Depends(settings_delete),
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
    request_kind: Optional[str] = Query(default=None, pattern="^(reimbursement|advance|direct_payment)?$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    result = await approval_service.preview_route(
        db, company.id, requester_position_id, expense_type_id, amount, request_kind
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════
# Requester — expense requests
# ═══════════════════════════════════════════════════════════════════════════

async def _request_items(db: AsyncSession, request_id: str) -> list[ExpenseRequestItem]:
    revision = (await db.execute(select(ExpenseRequest.current_revision).where(ExpenseRequest.id == request_id))).scalar_one_or_none()
    return list((await db.execute(
        select(ExpenseRequestItem)
        .where(ExpenseRequestItem.expense_request_id == request_id, ExpenseRequestItem.revision == (revision or 1))
        .order_by(ExpenseRequestItem.sort_order, ExpenseRequestItem.id)
    )).scalars().all())


async def _request_attachments(db: AsyncSession, request_id: str) -> list[ExpenseRequestAttachment]:
    revision = (await db.execute(select(ExpenseRequest.current_revision).where(ExpenseRequest.id == request_id))).scalar_one_or_none()
    return list((await db.execute(
        select(ExpenseRequestAttachment)
        .where(ExpenseRequestAttachment.expense_request_id == request_id,
               ExpenseRequestAttachment.revision == (revision or 1),
               ExpenseRequestAttachment.is_active.is_(True))
        .order_by(ExpenseRequestAttachment.attachment_type, ExpenseRequestAttachment.created_at)
    )).scalars().all())


async def _employee_organization(
    db: AsyncSession,
    user: User,
    company: Company,
    position_id: int,
) -> tuple[Position, Optional[Department]]:
    """Resolve the employee organization snapshot.

    Department is optional by design (for example, executives may report at
    company level).  When a company membership exists its department value is
    authoritative, including an explicit NULL; the position department is
    retained only as a compatibility fallback for platform admins without a
    company-membership row.
    """
    position = await _get_company_row(db, Position, position_id, company.id, "ไม่พบตำแหน่งผู้เบิก")
    assignment = (await db.execute(select(UserPosition.id).where(
        UserPosition.user_id == user.id,
        UserPosition.company_id == company.id,
        UserPosition.position_id == position_id,
        UserPosition.is_active.is_(True),
    ))).scalar_one_or_none()
    if not assignment and not user.is_platform_admin:
        raise HTTPException(403, "ตำแหน่งนี้ไม่ได้ถูกกำหนดให้พนักงานในบริษัทปัจจุบัน")

    membership = (await db.execute(select(UserCompany).where(
        UserCompany.user_id == user.id,
        UserCompany.company_id == company.id,
        UserCompany.is_active.is_(True),
    ))).scalar_one_or_none()
    department_id = membership.department_id if membership else position.department_id
    department = await db.get(Department, department_id) if department_id else None
    if department_id and (
        not department or department.company_id != company.id or not department.is_active
    ):
        raise HTTPException(400, "แผนกของพนักงานไม่ถูกต้องหรือถูกปิดใช้งาน กรุณาตรวจสอบที่หน้าจัดการผู้ใช้งาน")
    return position, department


async def _installment_chain_remaining(db: AsyncSession, req: ExpenseRequest) -> Optional[Decimal]:
    """How much of the whole installment chain's target still needs to be paid out.

    None when this request isn't part of an installment chain. Safe to compare
    against 0 to decide whether a further installment may still be created.
    """
    if req.installment_chain_root_id is None or req.installment_target_amount is None:
        return None
    paid = (await db.execute(select(func.coalesce(func.sum(ExpenseRequest.paid_amount), 0)).where(
        ExpenseRequest.installment_chain_root_id == req.installment_chain_root_id
    ))).scalar_one()
    return expense_request_service.money(req.installment_target_amount - Decimal(paid))


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
        version=req.version, current_revision=req.current_revision,
        requester_name=(requester.full_name or requester.username) if requester else None,
        requester_position_id=req.requester_position_id,
        requester_position_name=position.name if position else None,
        department_id=req.department_id,
        department_name=req.department_name_snapshot,
        expense_type_id=req.expense_type_id,
        expense_type_name=expense_type.name if expense_type else None,
        amount=req.amount, title=req.title, description=req.description,
        request_date=req.request_date, required_date=req.required_date, request_format=req.request_format,
        payer_company_name=req.payer_company_name,
        recipient_type=req.recipient_type, recipient_name=req.recipient_name,
        bank_name=req.bank_name, bank_account_name=req.bank_account_name,
        bank_account_number=(expense_request_service.decrypt_account_number(req.bank_account_number_encrypted)
                             if include_sensitive else None),
        recipient_address=req.recipient_address, service_description=req.service_description,
        bank_account_masked=masked, subtotal=totals["subtotal"], discount_amount=totals["discount_amount"],
        price_before_vat=totals["price_before_vat"],
        price_mode=req.price_mode,
        vat_mode=req.vat_mode, vat_rate=req.vat_rate, vat_amount=totals["vat_amount"],
        withholding_required=req.withholding_required,
        withholding_mode=req.withholding_mode, withholding_rate=req.withholding_rate,
        withholding_amount=totals["withholding_amount"], payable_total=totals["payable_total"],
        gross=totals["grand_total"], net=totals["payable_total"],
        paid=req.paid_amount, remaining=req.remaining_amount,
        gross_up_enabled=req.gross_up_enabled,
        installment_enabled=req.installment_enabled,
        installment_no=req.installment_no,
        installment_chain_root_id=req.installment_chain_root_id,
        installment_target_amount=req.installment_target_amount,
        installment_payment_amount=req.installment_payment_amount,
        installment_chain_status=req.installment_chain_status,
        installment_chain_remaining=await _installment_chain_remaining(db, req),
        requested_net_amount=req.requested_net_amount,
        requester_withholding_status=req.requester_withholding_status,
        taxpayer_name=req.taxpayer_name,
        taxpayer_type=req.taxpayer_type, taxpayer_branch=req.taxpayer_branch,
        taxpayer_id=(expense_request_service.decrypt_account_number(req.recipient_tax_id_encrypted)
                     if include_sensitive and req.recipient_tax_id_encrypted else (req.taxpayer_id if include_sensitive else None)),
        taxpayer_address=req.taxpayer_address, status=req.status,
        current_step_no=req.current_step_no, submitted_at=req.submitted_at,
        approved_at=req.approved_at, decided_at=req.decided_at, created_at=req.created_at,
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
    q = select(ExpenseRequest).where(ExpenseRequest.company_id == company.id)
    if scope == "mine" or not await _can_view_all_company_requests(db, current_user, company.id):
        q = q.where(ExpenseRequest.requester_user_id == current_user.id)
    if status:
        # เมื่อผู้ใช้เลือกสถานะ ให้แสดงสถานะนั้นตามปกติ
        q = q.where(ExpenseRequest.status == status)
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
    position, department = await _employee_organization(
        db, current_user, company, payload.requester_position_id
    )
    expense_type = await _get_company_row(db, ExpenseType, payload.expense_type_id, company.id, "ไม่พบประเภทการเบิก")
    if payload.request_format not in (expense_type.allowed_kinds or []):
        raise HTTPException(400, "ประเภทการเบิกนี้ไม่รองรับรูปแบบคำขอที่เลือก")
    if payload.request_format == "advance" and payload.installment_enabled:
        raise HTTPException(400, "คำขอเงินทดรองไม่รองรับการแบ่งจ่ายเป็นงวด")
    data = payload.model_dump(exclude={"bank_account_number", "department_id"})
    bank_account_number = payload.bank_account_number or ""
    obj = ExpenseRequest(
        company_id=company.id, requester_user_id=current_user.id, status="draft",
        company_name_snapshot=company.name_th,
        department_id=department.id if department else None,
        department_name_snapshot=department.name if department else None,
        requester_name_snapshot=current_user.full_name or current_user.username,
        requester_position_snapshot=position.name,
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
    all_steps = (
        await db.execute(
            select(ApprovalRequestStep)
            .where(ApprovalRequestStep.expense_request_id == request_id)
            .order_by(ApprovalRequestStep.step_no)
        )
    ).scalars().all()
    # A user who approved/returned a *previous* revision (before a
    # return-for-correction) must still count as a participant so they keep
    # visibility into the request's history — but only the CURRENT revision's
    # steps should be shown as "the approval timeline" (see `steps` below),
    # otherwise old and new revisions' rows mix together with only `step_no`
    # to sort by, which is unstable across ties and randomly resurfaces
    # stale/returned steps from a prior revision.
    step_ids = [s.id for s in all_steps]
    is_candidate = bool(step_ids) and (await db.execute(select(ExpenseApprovalCandidate.id).where(
        ExpenseApprovalCandidate.request_step_id.in_(step_ids),
        ExpenseApprovalCandidate.user_id == current_user.id,
    ).limit(1))).scalar_one_or_none() is not None
    legacy_steps = []
    if not [s for s in all_steps if s.revision == req.current_revision]:
        legacy_steps = (
            await db.execute(
                select(ExpenseRequestLegacyApprovalStep)
                .where(
                    ExpenseRequestLegacyApprovalStep.expense_request_id == request_id,
                    ExpenseRequestLegacyApprovalStep.revision == req.current_revision,
                )
                .order_by(ExpenseRequestLegacyApprovalStep.step_no)
            )
        ).scalars().all()
    legacy_approver_ids = {
        int(approver["user_id"])
        for step in legacy_steps
        for approver in (step.approvers or [])
        if approver.get("user_id") is not None
    }
    is_participant = req.requester_user_id == current_user.id or is_candidate or current_user.id in legacy_approver_ids or any(
        s.resolved_approver_user_id == current_user.id for s in all_steps
    )
    steps = [s for s in all_steps if s.revision == req.current_revision]
    if not (is_participant or await _is_company_accounting(db, current_user, company.id)):
        raise HTTPException(403, "คุณไม่มีสิทธิ์ดูคำขอนี้")

    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    base = await _request_to_out(db, req, include_sensitive=True)
    items = await _request_items(db, request_id)
    attachments = await _request_attachments(db, request_id)
    requirement_ids = {item.requirement_id for item in attachments if item.requirement_id is not None}
    requirements_by_id = {
        requirement.id: requirement
        for requirement in (
            await db.execute(
                select(ExpenseAttachmentRequirement).where(
                    ExpenseAttachmentRequirement.company_id == company.id,
                    ExpenseAttachmentRequirement.id.in_(requirement_ids),
                )
            )
        ).scalars().all()
    } if requirement_ids else {}
    siblings = []
    if req.installment_chain_root_id is not None:
        siblings = (await db.execute(
            select(ExpenseRequest)
            .where(ExpenseRequest.installment_chain_root_id == req.installment_chain_root_id)
            .order_by(ExpenseRequest.installment_no)
        )).scalars().all()
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
                "id": item.id, "requirement_id": item.requirement_id,
                "attachment_type": item.attachment_type,
                "category": item.category,
                "file_name": item.file_name, "content_type": item.content_type,
                "file_size": item.file_size, "requires_signature": item.requires_signature,
                "has_signed_file": bool(item.signed_file_path), "created_at": item.created_at,
                "default_signature_page": requirements_by_id[item.requirement_id].default_signature_page
                    if item.requirement_id in requirements_by_id else None,
                "default_signature_x": requirements_by_id[item.requirement_id].default_signature_x
                    if item.requirement_id in requirements_by_id else None,
                "default_signature_y": requirements_by_id[item.requirement_id].default_signature_y
                    if item.requirement_id in requirements_by_id else None,
                "default_signature_width": requirements_by_id[item.requirement_id].default_signature_width
                    if item.requirement_id in requirements_by_id else None,
                "default_signature_height": requirements_by_id[item.requirement_id].default_signature_height
                    if item.requirement_id in requirements_by_id else None,
            }
            for item in attachments
        ],
        steps=[
            {
                "id": s.id, "step_no": s.step_no,
                "name": s.name,
                "approver_position_id": s.approver_position_id,
                "approver_position_name": positions.get(s.approver_position_id),
                "resolved_approver_user_id": s.resolved_approver_user_id,
                "resolved_approver_name": users.get(s.resolved_approver_user_id) if s.resolved_approver_user_id else None,
                "status": s.status, "comment": s.comment,
                "decided_by": s.decided_by, "decided_at": s.decided_at,
                "approvers": [{
                    "user_id": s.resolved_approver_user_id,
                    "name": users.get(s.resolved_approver_user_id),
                    "position_name": positions.get(s.approver_position_id),
                    "status": s.status,
                    "comments": s.comment,
                    "acted_at": s.decided_at,
                }] if s.resolved_approver_user_id else [],
            }
            for s in steps
        ] if steps else [
            {
                "id": -s.id,
                "step_no": s.step_no,
                "name": s.name,
                "approver_position_id": None,
                "approver_position_name": s.name,
                "resolved_approver_user_id": (s.approvers or [{}])[0].get("user_id"),
                "resolved_approver_name": (s.approvers or [{}])[0].get("name"),
                "status": s.status,
                "comment": (s.approvers or [{}])[0].get("comments"),
                "decided_by": None,
                "decided_at": (s.approvers or [{}])[0].get("acted_at") or s.completed_at,
                "approvers": s.approvers or [],
                "is_legacy": True,
            }
            for s in legacy_steps
        ],
        installment_siblings=[
            {
                "id": s.id, "request_no": s.request_no, "installment_no": s.installment_no,
                "status": s.status, "amount": s.amount, "paid_amount": s.paid_amount,
            }
            for s in siblings
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
    if req.status not in {"draft", "returned_for_correction"}:
        raise HTTPException(400, "แก้ไขได้เฉพาะแบบร่างหรือคำขอที่ถูกส่งกลับเท่านั้น")

    data = payload.model_dump(exclude_unset=True)
    expected_version = data.pop("version", None)
    if expected_version is not None and expected_version != req.version:
        raise HTTPException(409, f"ข้อมูลถูกแก้ไขจากอีกหน้าจอ กรุณาโหลดใหม่ (version ปัจจุบัน {req.version})")
    previous_revision = req.current_revision
    revision_created = req.status == "returned_for_correction"
    if revision_created:
        old_supporting = (await db.execute(select(ExpenseRequestAttachment).where(
            ExpenseRequestAttachment.expense_request_id == request_id,
            ExpenseRequestAttachment.revision == previous_revision,
            ExpenseRequestAttachment.attachment_type == "supporting",
            ExpenseRequestAttachment.is_active.is_(True),
        ))).scalars().all()
        req.current_revision += 1
        req.status = "draft"
        req.signed_pdf_path = None
        req.signed_pdf_sha256 = None
        for attachment in old_supporting:
            suffix = Path(attachment.file_name).suffix.lower()
            stored_name = f"revision-{req.current_revision}-{uuid.uuid4().hex}{suffix}"
            new_path = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / stored_name
            new_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(attachment.file_path, new_path)
            db.add(ExpenseRequestAttachment(
                expense_request_id=request_id, company_id=company.id,
                requirement_id=attachment.requirement_id, revision=req.current_revision,
                category=attachment.category, attachment_type="supporting",
                file_name=attachment.file_name, stored_name=stored_name, file_path=str(new_path),
                content_type=attachment.content_type, file_size=attachment.file_size,
                sha256=attachment.sha256, requires_signature=attachment.requires_signature,
                uploaded_by=current_user.id,
            ))
    items_payload = data.pop("items", None)
    account_number = data.pop("bank_account_number", None)
    tax_id = data.pop("recipient_tax_id", None)
    legacy_tax_id = data.pop("taxpayer_id", None)
    position, department = await _employee_organization(
        db, current_user, company, data.get("requester_position_id", req.requester_position_id)
    )
    data["department_id"] = department.id if department else None
    req.department_name_snapshot = department.name if department else None
    req.requester_position_snapshot = position.name
    expense_type = await _get_company_row(
        db, ExpenseType, data.get("expense_type_id", req.expense_type_id), company.id, "ไม่พบประเภทการเบิก"
    )
    if data.get("request_format", req.request_format) not in (expense_type.allowed_kinds or []):
        raise HTTPException(400, "ประเภทการเบิกนี้ไม่รองรับรูปแบบคำขอที่เลือก")
    if (data.get("request_format", req.request_format) == "advance"
            and data.get("installment_enabled", req.installment_enabled)):
        raise HTTPException(400, "คำขอเงินทดรองไม่รองรับการแบ่งจ่ายเป็นงวด")

    for key, value in data.items():
        setattr(req, key, value)
    if account_number is not None:
        normalized = "".join(account_number.split())
        req.bank_account_number_encrypted = expense_request_service.encrypt_account_number(normalized)
        req.bank_account_last4 = normalized[-4:] or None
    tax_id = tax_id if tax_id is not None else legacy_tax_id
    if tax_id is not None:
        normalized_tax_id = "".join(tax_id.split())
        req.recipient_tax_id_encrypted = expense_request_service.encrypt_account_number(normalized_tax_id)
        req.recipient_tax_id_last4 = normalized_tax_id[-4:] or None
        req.taxpayer_id = None

    if items_payload is not None:
        await db.execute(delete(ExpenseRequestItem).where(
            ExpenseRequestItem.expense_request_id == request_id,
            ExpenseRequestItem.revision == req.current_revision,
        ))
        for index, item in enumerate(items_payload, start=1):
            line_total = expense_request_service.money(item["quantity"] * item["unit_price"])
            db.add(ExpenseRequestItem(
                expense_request_id=request_id, revision=req.current_revision, sort_order=index,
                description=item["description"].strip(), quantity=item["quantity"],
                unit=item["unit"].strip(), unit_price=item["unit_price"], line_total=line_total,
            ))
        await db.flush()
    elif revision_created:
        old_items = (await db.execute(select(ExpenseRequestItem).where(
            ExpenseRequestItem.expense_request_id == request_id,
            ExpenseRequestItem.revision == previous_revision,
        ).order_by(ExpenseRequestItem.sort_order))).scalars().all()
        for item in old_items:
            db.add(ExpenseRequestItem(
                expense_request_id=request_id, revision=req.current_revision,
                sort_order=item.sort_order, description=item.description,
                quantity=item.quantity, unit=item.unit, unit_price=item.unit_price,
                line_total=item.line_total,
            ))
        await db.flush()

    items = await _request_items(db, request_id)
    if req.installment_enabled and req.installment_payment_amount is not None and req.installment_chain_root_id is None:
        # First time this draft is split into installments: snapshot the full
        # (non-overridden) claim total as the fixed target the whole chain must
        # reach, then rename this document to be installment #1 of its own chain.
        original_override = req.installment_payment_amount
        req.installment_payment_amount = None
        full_totals = expense_request_service.calculate_totals(req, items)
        req.installment_payment_amount = original_override
        req.installment_target_amount = full_totals["payable_total"]
        req.installment_chain_root_id = req.id
        req.installment_no = 1
        req.request_no = f"{req.request_no}-1"
        req.installment_chain_status = "in_progress"
    if req.installment_payment_amount is not None:
        # An installment amount overrides the taxable base directly — discount
        # doesn't apply on top of it (avoids double-counting the reduction).
        req.discount_amount = Decimal("0")
    totals = expense_request_service.calculate_totals(req, items)
    if req.gross_up_enabled and req.requested_net_amount is not None:
        if not req.withholding_required or req.withholding_mode != "rate" or req.withholding_rate <= 0 or req.withholding_rate >= 100:
            raise HTTPException(400, "Gross-up ใช้ได้เมื่อเลือกต้องหัก ณ ที่จ่ายและระบุอัตรามากกว่า 0% แต่น้อยกว่า 100%")
        if req.requested_net_amount <= 0 or req.requested_net_amount <= totals["vat_amount"]:
            raise HTTPException(400, "ยอดที่ผู้รับเงินต้องได้สุทธิต้องมากกว่า 0 และมากกว่ายอด VAT")
        maximum_net = expense_request_service.money(totals["price_before_vat"] + totals["vat_amount"] - (totals["price_before_vat"] * req.withholding_rate / Decimal("100")))
        if req.requested_net_amount > maximum_net:
            raise HTTPException(400, f"ยอดที่ผู้รับเงินต้องได้สุทธิเกินยอดสูงสุดที่วงเงินนี้รองรับ ({maximum_net:,.2f} บาท)")
    req.amount = totals["grand_total"]
    req.subtotal_amount = totals["subtotal"]
    req.price_before_vat = totals["price_before_vat"]
    req.gross_amount = totals["grand_total"]
    req.net_amount = totals["payable_total"]
    req.remaining_amount = expense_request_service.money(totals["payable_total"] - req.paid_amount)
    req.vat_amount = totals["vat_amount"]
    req.withholding_amount = totals["withholding_amount"]
    req.gross_up_base_amount = (expense_request_service.money((req.requested_net_amount - totals["vat_amount"]) /
                                (Decimal("1") - req.withholding_rate / Decimal("100")))
                                if req.gross_up_enabled and req.requested_net_amount is not None and req.withholding_rate < 100
                                else (totals["grand_total"] if req.gross_up_enabled else None))
    req.updated_at = datetime.now(timezone.utc)
    req.version += 1
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


@router.post("/expense-requests/{request_id}/installments/next", response_model=ExpenseRequestOut, status_code=201)
async def create_next_installment(
    request_id: str,
    payload: ExpenseInstallmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    source = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    if source.requester_user_id != current_user.id:
        raise HTTPException(403, "คุณไม่ใช่เจ้าของคำขอนี้")
    if source.installment_chain_root_id is None:
        raise HTTPException(400, "ต้องบันทึกงวดแรกพร้อมระบุยอดแบ่งจ่ายก่อนจึงจะสร้างงวดถัดไปได้")

    root_id = source.installment_chain_root_id
    root = (await db.execute(
        select(ExpenseRequest).where(ExpenseRequest.id == root_id, ExpenseRequest.company_id == company.id)
        .with_for_update()
    )).scalar_one()
    siblings = (await db.execute(
        select(ExpenseRequest)
        .where(ExpenseRequest.installment_chain_root_id == root_id)
        .order_by(ExpenseRequest.installment_no)
    )).scalars().all()
    latest = siblings[-1]
    if latest.status != "completed":
        raise HTTPException(400, "ต้องจ่ายงวดปัจจุบันให้ครบก่อนจึงจะสร้างงวดถัดไปได้")

    chain_paid = sum((expense_request_service.money(s.paid_amount) for s in siblings), Decimal("0"))
    chain_remaining = expense_request_service.money((root.installment_target_amount or Decimal("0")) - chain_paid)
    if chain_remaining <= 0:
        raise HTTPException(400, "คำขอนี้แบ่งจ่ายครบยอดเต็มแล้ว ไม่ต้องสร้างงวดถัดไปอีก")
    if payload.installment_payment_amount > chain_remaining:
        raise HTTPException(400, f"ยอดงวดนี้ต้องไม่เกินยอดคงเหลือของคำขอ ({chain_remaining:,.2f} บาท)")

    base_no = re.sub(r"-\d+$", "", root.request_no or "")
    new_installment_no = (latest.installment_no or 1) + 1
    new_req = ExpenseRequest(
        company_id=latest.company_id, status="draft", version=1, current_revision=1,
        department_id=latest.department_id,
        company_name_snapshot=latest.company_name_snapshot,
        department_name_snapshot=latest.department_name_snapshot,
        requester_name_snapshot=latest.requester_name_snapshot,
        requester_position_snapshot=latest.requester_position_snapshot,
        requester_user_id=latest.requester_user_id, requester_position_id=latest.requester_position_id,
        expense_type_id=latest.expense_type_id,
        amount=Decimal("0"), title=latest.title, description=latest.description,
        request_date=datetime.now(timezone.utc).date(), required_date=latest.required_date,
        request_format=latest.request_format, payer_company_name=latest.payer_company_name,
        recipient_type=latest.recipient_type, recipient_name=latest.recipient_name,
        bank_name=latest.bank_name, bank_account_name=latest.bank_account_name,
        bank_account_number_encrypted=latest.bank_account_number_encrypted, bank_account_last4=latest.bank_account_last4,
        recipient_tax_id_encrypted=latest.recipient_tax_id_encrypted, recipient_tax_id_last4=latest.recipient_tax_id_last4,
        recipient_address=latest.recipient_address, service_description=latest.service_description,
        discount_amount=Decimal("0"), subtotal_amount=Decimal("0"), price_before_vat=Decimal("0"),
        gross_amount=Decimal("0"), net_amount=Decimal("0"), paid_amount=Decimal("0"), remaining_amount=Decimal("0"),
        price_mode=latest.price_mode, vat_mode=latest.vat_mode, vat_rate=latest.vat_rate, vat_amount=Decimal("0"),
        withholding_required=latest.withholding_required, withholding_mode=latest.withholding_mode,
        withholding_rate=latest.withholding_rate, withholding_amount=Decimal("0"),
        requester_withholding_status=latest.requester_withholding_status,
        gross_up_enabled=latest.gross_up_enabled,
        installment_enabled=True, installment_chain_root_id=root_id, installment_no=new_installment_no,
        installment_target_amount=root.installment_target_amount,
        installment_payment_amount=payload.installment_payment_amount,
        installment_chain_status=root.installment_chain_status,
        taxpayer_name=latest.taxpayer_name, taxpayer_type=latest.taxpayer_type,
        taxpayer_branch=latest.taxpayer_branch, taxpayer_id=latest.taxpayer_id,
        taxpayer_address=latest.taxpayer_address,
        request_no=f"{base_no}-{new_installment_no}",
    )
    db.add(new_req)
    await db.flush()

    source_items = await _request_items(db, latest.id)
    for item in source_items:
        db.add(ExpenseRequestItem(
            expense_request_id=new_req.id, revision=1, sort_order=item.sort_order,
            description=item.description, quantity=item.quantity, unit=item.unit,
            unit_price=item.unit_price, line_total=item.line_total,
        ))
    await db.flush()

    new_items = await _request_items(db, new_req.id)
    totals = expense_request_service.calculate_totals(new_req, new_items)
    new_req.amount = totals["grand_total"]
    new_req.subtotal_amount = totals["subtotal"]
    new_req.price_before_vat = totals["price_before_vat"]
    new_req.gross_amount = totals["grand_total"]
    new_req.net_amount = totals["payable_total"]
    new_req.remaining_amount = totals["payable_total"]
    new_req.vat_amount = totals["vat_amount"]
    new_req.withholding_amount = totals["withholding_amount"]

    db.add(ExpenseRequestHistory(company_id=company.id, expense_request_id=new_req.id,
        revision=1, event="installment_created", from_status=None, to_status="draft",
        actor_user_id=current_user.id, snapshot={"installment_no": new_installment_no, "source_request_id": latest.id}))
    db.add(ExpenseRequestHistory(company_id=company.id, expense_request_id=latest.id,
        revision=latest.current_revision, event="installment_child_created", from_status=latest.status, to_status=latest.status,
        actor_user_id=current_user.id, snapshot={"new_request_no": new_req.request_no}))
    await db.commit()
    await db.refresh(new_req)
    return await _request_to_out(db, new_req, include_sensitive=True)


@router.post("/expense-requests/{request_id}/attachments", status_code=201)
async def upload_expense_request_attachment(
    request_id: str,
    file: UploadFile = File(...),
    requirement_id: Optional[int] = Form(None),
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
    requirement = None
    if requirement_id is not None:
        requirement = (await db.execute(select(ExpenseAttachmentRequirement).where(
            ExpenseAttachmentRequirement.id == requirement_id,
            ExpenseAttachmentRequirement.expense_type_id == req.expense_type_id,
            ExpenseAttachmentRequirement.company_id == company.id,
            ExpenseAttachmentRequirement.is_active.is_(True),
        ))).scalar_one_or_none()
        if not requirement:
            raise HTTPException(400, "ข้อกำหนดเอกสารไม่ถูกต้องหรือไม่ตรงกับประเภทการเบิก")
        if file.content_type and requirement.allowed_mime_types and file.content_type not in requirement.allowed_mime_types:
            raise HTTPException(400, f"ชนิดไฟล์ไม่ตรงกับข้อกำหนด {requirement.name}")
    existing = await _request_attachments(db, request_id)
    if len([item for item in existing if item.attachment_type == "supporting"]) >= 10:
        raise HTTPException(400, "แนบเอกสารประกอบได้สูงสุด 10 ไฟล์")
    content = await file.read(10 * 1024 * 1024 + 1)
    size_limit = requirement.max_file_size if requirement else 10 * 1024 * 1024
    if len(content) > size_limit:
        raise HTTPException(400, f"ไฟล์ต้องมีขนาดไม่เกิน {max(1, size_limit // 1024 // 1024)} MB")

    stored_name = f"{uuid.uuid4().hex}{extension}"
    path = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / stored_name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    attachment = ExpenseRequestAttachment(
        expense_request_id=request_id, company_id=company.id, requirement_id=requirement_id,
        revision=req.current_revision,
        attachment_type="supporting", category="supporting",
        file_name=filename, stored_name=stored_name, file_path=str(path),
        content_type=file.content_type or mimetypes.guess_type(filename)[0],
        file_size=len(content), sha256=hashlib.sha256(content).hexdigest(),
        requires_signature=bool(requirement and requirement.requires_signature), uploaded_by=current_user.id,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return {
        "id": attachment.id, "requirement_id": attachment.requirement_id,
        "attachment_type": attachment.attachment_type,
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
    department_id = req.department_id or (position.department_id if position else None)
    department = await db.get(Department, department_id) if department_id else None
    route = await approval_service.preview_route(
        db, company.id, req.requester_position_id, req.expense_type_id, approval_service.routing_amount(req)
    )
    signature_cells = [{
        "role": f"ผู้อนุมัติลำดับ {step['step_no']} - {step['approver_position_name']}",
        "name": step["resolved_approver_name"] or "รอระบุผู้อนุมัติ",
        "is_requester": False,
    } for step in route.get("steps", [])]
    filename = "เอกสารหลักสำหรับอนุมัติ (PDF).pdf"
    stored_name = f"primary-{uuid.uuid4().hex}.pdf"
    path = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / stored_name
    expense_request_service.render_payment_approval_pdf(
        req, items, company, current_user,
        position.name if position else "-", expense_type.name if expense_type else "-", path,
        department.name if department else "-", signature_cells,
    )
    attachment = ExpenseRequestAttachment(
        expense_request_id=request_id, company_id=company.id, revision=req.current_revision,
        attachment_type="primary", category="system_document", requires_signature=True,
        file_name=filename, stored_name=stored_name, file_path=str(path),
        content_type="application/pdf", file_size=path.stat().st_size,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    req.request_pdf_path = str(path)
    req.request_pdf_sha256 = attachment.sha256
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
    signed: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _get_company_row(db, ExpenseRequest, request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
    steps = (await db.execute(select(ApprovalRequestStep).where(
        ApprovalRequestStep.expense_request_id == request_id,
        ApprovalRequestStep.resolved_approver_user_id == current_user.id,
    ))).scalars().all()
    if not (req.requester_user_id == current_user.id or steps or await _is_company_accounting(db, current_user, company.id)):
        raise HTTPException(403, "คุณไม่มีสิทธิ์ดูเอกสารนี้")
    attachment = (await db.execute(select(ExpenseRequestAttachment).where(
        ExpenseRequestAttachment.id == attachment_id,
        ExpenseRequestAttachment.expense_request_id == request_id,
    ))).scalar_one_or_none()
    selected_path = None
    if attachment:
        selected_path = attachment.signed_file_path if signed and attachment.signed_file_path else attachment.file_path
    if not attachment or not selected_path or not Path(selected_path).is_file():
        raise HTTPException(404, "ไม่พบไฟล์แนบนี้")
    return FileResponse(
        selected_path,
        media_type=attachment.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(attachment.file_name)}",
            # Draft primary PDFs are regenerated in-place while preserving the
            # attachment ID. Never let a browser reuse the older rendered form.
            "Cache-Control": "private, no-store, max-age=0",
            "Pragma": "no-cache",
        },
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
    if req.withholding_required and not all([
        req.taxpayer_name, req.taxpayer_type,
        (req.recipient_tax_id_encrypted or req.taxpayer_id),
        req.taxpayer_address, req.service_description,
    ]):
        missing.append("ข้อมูลภาษีสำหรับฝ่ายบัญชี")
    if not any(item.attachment_type == "primary" for item in attachments):
        missing.append("เอกสารหลักสำหรับอนุมัติ")
    if not any(item.attachment_type == "supporting" for item in attachments):
        missing.append("เอกสารประกอบเพิ่มเติม")
    required_docs = (await db.execute(select(ExpenseAttachmentRequirement).where(
        ExpenseAttachmentRequirement.expense_type_id == req.expense_type_id,
        ExpenseAttachmentRequirement.is_required.is_(True), ExpenseAttachmentRequirement.is_active.is_(True),
    ))).scalars().all()
    uploaded_requirement_ids = {a.requirement_id for a in attachments if a.attachment_type == "supporting" and a.is_active}
    missing_requirement_names = [doc.name for doc in required_docs if doc.id not in uploaded_requirement_ids]
    legacy_unassigned_count = len([
        a for a in attachments
        if a.attachment_type == "supporting" and a.is_active and a.requirement_id is None
    ])
    if legacy_unassigned_count:
        # Attachments created before requirement_id was exposed by the API remain
        # valid and satisfy required document slots in configured order.
        missing_requirement_names = missing_requirement_names[legacy_unassigned_count:]
    if missing_requirement_names:
        missing.append("เอกสารบังคับ: " + ", ".join(missing_requirement_names))
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
    if req.status not in {"draft", "returned_for_correction"}:
        raise HTTPException(400, "ผู้ขอยกเลิกได้เฉพาะแบบร่างหรือรายการที่ถูกส่งกลับ")
    req.status = "cancelled"
    req.cancelled_at = datetime.now(timezone.utc)
    req.cancelled_by = current_user.id
    db.add(ExpenseRequestHistory(company_id=company.id, expense_request_id=req.id,
        revision=req.current_revision, event="cancelled", from_status="draft", to_status="cancelled",
        actor_user_id=current_user.id, snapshot={}))
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
    payment_exists = (await db.execute(select(ExpensePayment.id).where(
        ExpensePayment.expense_request_id == request_id
    ).limit(1))).scalar_one_or_none()
    if payment_exists:
        raise HTTPException(400, "ลบคำขอที่มีประวัติการจ่ายเงินไม่ได้")

    attachments = (await db.execute(select(ExpenseRequestAttachment).where(
        ExpenseRequestAttachment.expense_request_id == request_id
    ))).scalars().all()
    for attachment in attachments:
        for stored_path in {attachment.file_path, attachment.signed_file_path}:
            if not stored_path:
                continue
            try:
                Path(stored_path).unlink(missing_ok=True)
            except OSError:
                pass
    await db.delete(req)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Approver — inbox & decisions
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/approvals/inbox", response_model=list[InboxItemOut])
async def get_inbox(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    conditions = [
        ApprovalRequestStep.status == "pending",
        ExpenseRequest.company_id == company.id,
    ]
    # scope=all is only honored for super_admin/platform_admin — everyone else's
    # "รอฉันอนุมัติ" stays scoped to steps actually resolved to them.
    if scope == "mine" or not await _can_view_all_company_requests(db, current_user, company.id):
        conditions.append(ApprovalRequestStep.resolved_approver_user_id == current_user.id)
    rows = (
        await db.execute(
            select(ApprovalRequestStep, ExpenseRequest)
            .join(ExpenseRequest, ExpenseRequest.id == ApprovalRequestStep.expense_request_id)
            .where(*conditions)
            .order_by(ExpenseRequest.submitted_at)
        )
    ).all()
    positions = {p.id: p.name for p in (await db.execute(select(Position).where(Position.company_id == company.id))).scalars().all()}
    users = {u.id: (u.full_name or u.username) for u in (await db.execute(select(User))).scalars().all()}
    expense_types = {e.id: e.name for e in (await db.execute(select(ExpenseType).where(ExpenseType.company_id == company.id))).scalars().all()}
    return [
        InboxItemOut(
            step_id=step.id, step_no=step.step_no, expense_request_id=req.id,
            request_no=req.request_no,
            title=req.title, amount=req.amount, requester_user_id=req.requester_user_id,
            requester_name=users.get(req.requester_user_id),
            requester_position_name=positions.get(req.requester_position_id),
            department_name=req.department_name_snapshot,
            expense_type_name=expense_types.get(req.expense_type_id),
            request_date=req.request_date, submitted_at=req.submitted_at,
        )
        for step, req in rows
    ]


@router.post("/approval-steps/{step_id}/decisions", response_model=ExpenseRequestDetailOut)
async def decide_approval_step(
    step_id: int,
    payload: DecisionIn,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    if payload.action in {"return", "reject"} and not (payload.comment or "").strip():
        raise HTTPException(400, "กรุณาระบุเหตุผลที่ส่งคืนหรือไม่อนุมัติ")
    signature_data_url = payload.signature_data_url
    if payload.action == "approve" and payload.use_saved_signature:
        try:
            signature_data_url = expense_signature_service.saved_signature_data_url(current_user.signature_path)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    if payload.action == "approve":
        step_row = await db.get(ApprovalRequestStep, step_id)
        if not step_row:
            raise HTTPException(404, "ไม่พบขั้นตอนอนุมัตินี้")
        req_row = await _get_company_row(db, ExpenseRequest, step_row.expense_request_id, company.id, "ไม่พบคำขอเบิกเงินนี้")
        required_signature_ids = list((await db.execute(select(ExpenseRequestAttachment.id).where(
            ExpenseRequestAttachment.expense_request_id == req_row.id,
            ExpenseRequestAttachment.revision == req_row.current_revision,
            ExpenseRequestAttachment.is_active.is_(True),
            (ExpenseRequestAttachment.attachment_type == "primary") | ExpenseRequestAttachment.requires_signature.is_(True),
        ))).scalars().all())
        if required_signature_ids and not signature_data_url:
            raise HTTPException(400, "กรุณาวาดหรือเลือกใช้ลายเซ็นก่อนอนุมัติ")
        placement_ids = {str(item.get("attachment_id")) for item in payload.placements if item.get("attachment_id")}
        if any(str(attachment_id) not in placement_ids for attachment_id in required_signature_ids):
            raise HTTPException(400, "กรุณาเปิด PDF และกำหนดตำแหน่งลายเซ็นให้ครบทุกเอกสาร")
        for placement in payload.placements:
            try:
                page_number = int(placement.get("page_number", 0))
                x, y = float(placement.get("x", -1)), float(placement.get("y", -1))
                width, height = float(placement.get("width", 0)), float(placement.get("height", 0))
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, "ตำแหน่งลายเซ็นไม่ถูกต้อง") from exc
            if (page_number < 1 or x < 0 or y < 0 or width < .04 or height < .02
                    or x + width > 1 or y + height > 1):
                raise HTTPException(400, "ตำแหน่งหรือขนาดลายเซ็นอยู่นอกขอบเอกสาร")
        is_candidate = (await db.execute(select(ExpenseApprovalCandidate.id).where(
            ExpenseApprovalCandidate.request_step_id == step_id,
            ExpenseApprovalCandidate.user_id == current_user.id,
            ExpenseApprovalCandidate.status == "pending",
        ).limit(1))).scalar_one_or_none()
        if step_row.resolved_approver_user_id != current_user.id and not is_candidate:
            raise HTTPException(403, "คุณไม่ใช่ผู้อนุมัติของขั้นตอนนี้")
        try:
            await expense_signature_service.stamp_required_documents(
                db, req_row, step_row, current_user.id, signature_data_url, payload.placements
            )
            if payload.save_signature and payload.signature_data_url:
                current_user.signature_path = expense_signature_service.save_user_signature(current_user.id, payload.signature_data_url)
            await db.flush()
        except ValueError as exc:
            await db.rollback()
            raise HTTPException(400, str(exc))
    try:
        step = await approval_service.decide_step(
            db, step_id, current_user.id, payload.action, payload.comment, payload.idempotency_key,
            http_request.client.host if http_request.client else None,
            http_request.headers.get("user-agent"),
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    return await get_expense_request(step.expense_request_id, db, current_user, company)
