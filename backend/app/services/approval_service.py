"""Business logic for the position-based, multi-step expense approval workflow.

Routing model: a company's approval matrix is versioned (approval_policy_versions).
Only one version is ACTIVE per company. Each rule maps
(requester_position, expense_type, amount_range) -> an ordered list of approver
positions (approval_rule_steps, unlimited length). When a request is submitted,
the matching rule's steps are resolved to concrete users (primary approver, or
an active delegate) and snapshotted onto the request so later changes to the
matrix or to who holds a position never affect requests already in flight.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval import (
    ApprovalAction,
    ApprovalDelegation,
    ApprovalPolicyVersion,
    ApprovalRequestStep,
    ApprovalRule,
    ApprovalRuleStep,
    ExpenseRequest,
    Position,
    PositionPrimaryApprover,
    UserPosition,
)
from app.models.user import User
from app.models.expense_finance import ExpenseApprovalCandidate, ExpenseRequestHistory, SystemNotification


async def get_active_policy_version(db: AsyncSession, company_id: int) -> Optional[ApprovalPolicyVersion]:
    result = await db.execute(
        select(ApprovalPolicyVersion).where(
            ApprovalPolicyVersion.company_id == company_id,
            ApprovalPolicyVersion.status == "active",
        )
    )
    return result.scalar_one_or_none()


async def find_matching_rule(
    db: AsyncSession,
    policy_version_id: int,
    requester_position_id: int,
    expense_type_id: int,
    amount: Decimal,
) -> Optional[ApprovalRule]:
    result = await db.execute(
        select(ApprovalRule).where(
            ApprovalRule.policy_version_id == policy_version_id,
            ApprovalRule.requester_position_id == requester_position_id,
            ApprovalRule.expense_type_id == expense_type_id,
            ApprovalRule.amount_range.contains(amount),
        )
    )
    exact = result.scalar_one_or_none()
    if exact:
        return exact
    # HR matrix semantics: if an amount falls in a configured gap, escalate to
    # the next range instead of returning no route.
    fallback = await db.execute(
        select(ApprovalRule).where(
            ApprovalRule.policy_version_id == policy_version_id,
            ApprovalRule.requester_position_id == requester_position_id,
            ApprovalRule.expense_type_id == expense_type_id,
            func.lower(ApprovalRule.amount_range) >= amount,
        ).order_by(func.lower(ApprovalRule.amount_range)).limit(1)
    )
    return fallback.scalar_one_or_none()


async def get_rule_steps(db: AsyncSession, rule_id: int) -> list[ApprovalRuleStep]:
    result = await db.execute(
        select(ApprovalRuleStep)
        .where(ApprovalRuleStep.approval_rule_id == rule_id)
        .order_by(ApprovalRuleStep.step_no)
    )
    return list(result.scalars().all())


async def resolve_approver_for_position(
    db: AsyncSession, position_id: int, at_time: datetime
) -> Optional[int]:
    """An active delegation covering `at_time` takes priority over the primary approver."""
    delegation = (
        await db.execute(
            select(ApprovalDelegation).where(
                ApprovalDelegation.position_id == position_id,
                ApprovalDelegation.starts_at <= at_time,
                ApprovalDelegation.ends_at > at_time,
            )
        )
    ).scalar_one_or_none()
    if delegation:
        return delegation.delegate_user_id

    primary = (
        await db.execute(
            select(PositionPrimaryApprover).where(
                PositionPrimaryApprover.position_id == position_id,
                PositionPrimaryApprover.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if primary:
        return primary.user_id

    # Employee setup is the source of truth. When exactly one active employee
    # holds this position, use that employee without requiring a duplicate
    # "primary approver" mapping in expense settings.
    assigned_users = list((await db.execute(
        select(UserPosition.user_id)
        .join(User, User.id == UserPosition.user_id)
        .where(
            UserPosition.position_id == position_id,
            UserPosition.is_active.is_(True),
            User.is_active.is_(True),
        )
        .distinct()
        .limit(2)
    )).scalars().all())
    return assigned_users[0] if len(assigned_users) == 1 else None


async def _position_name(db: AsyncSession, position_id: int) -> str:
    result = await db.execute(select(Position.name).where(Position.id == position_id))
    return result.scalar_one_or_none() or f"ตำแหน่ง #{position_id}"


async def _user_display_name(db: AsyncSession, user_id: int) -> str:
    result = await db.execute(select(User.full_name, User.username).where(User.id == user_id))
    row = result.first()
    if not row:
        return f"ผู้ใช้ #{user_id}"
    return row[0] or row[1]


async def preview_route(
    db: AsyncSession,
    company_id: int,
    requester_position_id: int,
    expense_type_id: int,
    amount: Decimal,
    at_time: Optional[datetime] = None,
) -> dict:
    at_time = at_time or datetime.now(timezone.utc)
    policy_version = await get_active_policy_version(db, company_id)
    if not policy_version:
        return {"matched": False, "message": "บริษัทนี้ยังไม่มีสายอนุมัติที่เปิดใช้งาน (ACTIVE)", "rule_id": None, "steps": []}

    rule = await find_matching_rule(db, policy_version.id, requester_position_id, expense_type_id, amount)
    if not rule:
        return {
            "matched": False,
            "message": "ไม่พบกฎการอนุมัติสำหรับตำแหน่ง/ประเภทการเบิก/ยอดเงินนี้ กรุณาติดต่อผู้ดูแลระบบ",
            "rule_id": None,
            "steps": [],
        }

    rule_steps = await get_rule_steps(db, rule.id)
    steps = []
    for rs in rule_steps:
        approver_user_id = await resolve_approver_for_position(db, rs.approver_position_id, at_time)
        steps.append({
            "step_no": rs.step_no,
            "approver_position_id": rs.approver_position_id,
            "approver_position_name": await _position_name(db, rs.approver_position_id),
            "resolved_approver_user_id": approver_user_id,
            "resolved_approver_name": await _user_display_name(db, approver_user_id) if approver_user_id else None,
            "warning": None if approver_user_id else "ยังไม่ได้กำหนดผู้อนุมัติหลักสำหรับตำแหน่งนี้",
        })
    return {"matched": True, "message": None, "rule_id": rule.id, "steps": steps}


def routing_amount(request: ExpenseRequest) -> Decimal:
    """Amount the approval matrix routes on.

    A request that's part of an installment chain (installment_payment_amount
    set) still needs approval sized to the WHOLE claim — installment_target_amount
    is the full, non-overridden claim total snapshotted when the chain was
    created — not just what this particular installment happens to disburse.
    Everything else routes on its own amount, unchanged.
    """
    target = getattr(request, "installment_target_amount", None)
    return target if target is not None else request.amount


async def submit_expense_request(db: AsyncSession, request: ExpenseRequest) -> ExpenseRequest:
    if request.status not in {"draft", "settlement_due"}:
        raise ValueError(f"คำขอนี้ถูกส่งไปแล้ว (สถานะ: {request.status})")

    now = datetime.now(timezone.utc)
    policy_version = await get_active_policy_version(db, request.company_id)
    if not policy_version:
        raise ValueError("บริษัทนี้ยังไม่มีสายอนุมัติที่เปิดใช้งาน (ACTIVE) กรุณาติดต่อผู้ดูแลระบบ")

    rule = await find_matching_rule(
        db, policy_version.id, request.requester_position_id, request.expense_type_id, routing_amount(request)
    )
    if not rule:
        raise ValueError("ไม่พบกฎการอนุมัติสำหรับตำแหน่ง/ประเภทการเบิก/ยอดเงินนี้ กรุณาติดต่อผู้ดูแลระบบ")

    rule_steps = await get_rule_steps(db, rule.id)
    if not rule_steps:
        raise ValueError("กฎการอนุมัตินี้ยังไม่ได้กำหนดขั้นตอนผู้อนุมัติ")

    resolved: list[tuple[ApprovalRuleStep, Optional[int]]] = []
    for rs in rule_steps:
        approver_user_id = await resolve_approver_for_position(db, rs.approver_position_id, now)
        if approver_user_id is None:
            position_name = await _position_name(db, rs.approver_position_id)
            raise ValueError(f"ยังไม่ได้กำหนดผู้อนุมัติหลักสำหรับตำแหน่ง '{position_name}' กรุณาติดต่อผู้ดูแลระบบก่อนส่งคำขอ")
        resolved.append((rs, approver_user_id))

    request.policy_version_id = policy_version.id
    request.approval_rule_id = rule.id
    previous_status = request.status
    request.status = "pending_adjustment_approval" if previous_status == "settlement_due" else "pending_approval"
    request.current_step_no = resolved[0][0].step_no
    request.submitted_at = now

    for rs, approver_user_id in resolved:
        db.add(ApprovalRequestStep(
            expense_request_id=request.id,
            revision=request.current_revision,
            step_no=rs.step_no,
            name=await _position_name(db, rs.approver_position_id),
            approver_position_id=rs.approver_position_id,
            resolved_approver_user_id=approver_user_id,
            status="pending" if rs.step_no == request.current_step_no else "waiting",
            activated_at=now if rs.step_no == request.current_step_no else None,
        ))

    await db.flush()
    new_steps = (await db.execute(select(ApprovalRequestStep).where(
        ApprovalRequestStep.expense_request_id == request.id,
        ApprovalRequestStep.revision == request.current_revision,
    ))).scalars().all()
    for row in new_steps:
        if row.resolved_approver_user_id:
            db.add(ExpenseApprovalCandidate(
                company_id=request.company_id, request_step_id=row.id,
                user_id=row.resolved_approver_user_id, source_id=row.approver_position_id,
            ))
            if row.status == "pending":
                db.add(SystemNotification(
                    company_id=request.company_id, user_id=row.resolved_approver_user_id,
                    expense_request_id=request.id, type="approval_requested",
                    title="มีรายการเบิกรออนุมัติ", message=f"{request.request_no}: {request.title}",
                    action_url=f"/expense-requests/{request.id}",
                    dedupe_key=f"approval:{request.id}:{request.current_revision}:{row.step_no}",
                ))
    db.add(ExpenseRequestHistory(
        company_id=request.company_id, expense_request_id=request.id,
        revision=request.current_revision, event="submitted", from_status=previous_status,
        to_status=request.status, actor_user_id=request.requester_user_id,
        snapshot={"amount": str(request.amount), "routing_amount": str(routing_amount(request)), "rule_id": rule.id},
    ))

    await db.commit()
    await db.refresh(request)
    return request


async def decide_step(
    db: AsyncSession,
    step_id: int,
    actor_user_id: int,
    action: str,
    comment: Optional[str],
    idempotency_key: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> ApprovalRequestStep:
    existing_action = (
        await db.execute(select(ApprovalAction).where(ApprovalAction.idempotency_key == idempotency_key))
    ).scalar_one_or_none()
    if existing_action:
        step = await db.get(ApprovalRequestStep, existing_action.request_step_id)
        if not step:
            raise ValueError("ไม่พบขั้นตอนอนุมัตินี้")
        return step

    step = (
        await db.execute(
            select(ApprovalRequestStep).where(ApprovalRequestStep.id == step_id).with_for_update()
        )
    ).scalar_one_or_none()
    if not step:
        raise ValueError("ไม่พบขั้นตอนอนุมัตินี้")
    if step.status != "pending":
        raise ValueError(f"ขั้นตอนนี้ไม่ได้รออนุมัติอยู่ (สถานะ: {step.status})")
    candidate = (await db.execute(select(ExpenseApprovalCandidate).where(
        ExpenseApprovalCandidate.request_step_id == step.id,
        ExpenseApprovalCandidate.user_id == actor_user_id,
    ).with_for_update())).scalar_one_or_none()
    if not candidate and step.resolved_approver_user_id != actor_user_id:
        raise PermissionError("คุณไม่ใช่ผู้อนุมัติของขั้นตอนนี้")
    if candidate and candidate.status != "pending":
        raise ValueError("คุณได้บันทึกผลสำหรับขั้นตอนนี้แล้ว")

    request = (
        await db.execute(
            select(ExpenseRequest).where(ExpenseRequest.id == step.expense_request_id).with_for_update()
        )
    ).scalar_one_or_none()
    if not request:
        raise ValueError("ไม่พบคำขอเบิกเงินนี้")

    now = datetime.now(timezone.utc)
    step.decided_by = actor_user_id
    step.decided_at = now
    step.comment = comment

    if action == "approve":
        if candidate:
            candidate.status = "approved"
            candidate.decided_at = now
        if step.approve_mode == "all":
            remaining_candidates = (await db.execute(select(func.count()).select_from(ExpenseApprovalCandidate).where(
                ExpenseApprovalCandidate.request_step_id == step.id,
                ExpenseApprovalCandidate.status == "pending",
                ExpenseApprovalCandidate.user_id != actor_user_id,
            ))).scalar_one()
            if remaining_candidates:
                db.add(ApprovalAction(request_step_id=step.id, actor_user_id=actor_user_id,
                    action=action, comment=comment, idempotency_key=idempotency_key,
                    ip_address=ip_address, user_agent=user_agent))
                db.add(ExpenseRequestHistory(company_id=request.company_id, expense_request_id=request.id,
                    revision=request.current_revision, event="candidate_approved", from_status=request.status,
                    to_status=request.status, actor_user_id=actor_user_id, note=comment,
                    snapshot={"step_id": step.id, "approve_mode": "all"},
                    ip_address=ip_address, user_agent=user_agent))
                await db.commit(); await db.refresh(step)
                return step
        elif candidate:
            await db.execute(ExpenseApprovalCandidate.__table__.update().where(
                ExpenseApprovalCandidate.request_step_id == step.id,
                ExpenseApprovalCandidate.status == "pending",
                ExpenseApprovalCandidate.user_id != actor_user_id,
            ).values(status="skipped", decided_at=now))
        step.status = "approved"
        next_step = (
            await db.execute(
                select(ApprovalRequestStep)
                .where(
                    ApprovalRequestStep.expense_request_id == request.id,
                    ApprovalRequestStep.revision == request.current_revision,
                    ApprovalRequestStep.step_no > step.step_no,
                )
                .order_by(ApprovalRequestStep.step_no)
                .limit(1)
            )
        ).scalar_one_or_none()
        if next_step:
            next_step.status = "pending"
            next_step.activated_at = now
            request.current_step_no = next_step.step_no
            if next_step.resolved_approver_user_id:
                db.add(SystemNotification(
                    company_id=request.company_id, user_id=next_step.resolved_approver_user_id,
                    expense_request_id=request.id, type="approval_requested",
                    title="มีรายการเบิกรออนุมัติ", message=f"{request.request_no}: {request.title}",
                    action_url=f"/expense-requests/{request.id}",
                    dedupe_key=f"approval:{request.id}:{request.current_revision}:{next_step.step_no}",
                ))
        else:
            request.status = "ready_to_pay"
            request.current_step_no = None
            request.decided_at = now
            request.approved_at = now
            db.add(SystemNotification(
                company_id=request.company_id, user_id=request.requester_user_id,
                expense_request_id=request.id, type="ready_to_pay", title="คำขอได้รับอนุมัติแล้ว",
                message=f"{request.request_no} พร้อมให้ฝ่ายบัญชีตรวจจ่าย",
                action_url=f"/expense-requests/{request.id}", dedupe_key=f"ready:{request.id}:{request.current_revision}",
            ))
    elif action == "return":
        if candidate:
            candidate.status = "returned"
            candidate.decided_at = now
        step.status = "returned"
        request.status = "returned_for_correction"
        request.current_step_no = None
        request.decided_at = now
        await db.execute(ApprovalRequestStep.__table__.update().where(
            ApprovalRequestStep.expense_request_id == request.id,
            ApprovalRequestStep.revision == request.current_revision,
            ApprovalRequestStep.status == "waiting",
        ).values(status="skipped"))
        db.add(SystemNotification(
            company_id=request.company_id, user_id=request.requester_user_id,
            expense_request_id=request.id, type="returned", title="คำขอถูกส่งกลับให้แก้ไข",
            message=comment or request.request_no, action_url=f"/expense-requests/{request.id}",
            dedupe_key=f"returned:{request.id}:{request.current_revision}",
        ))
    else:
        if candidate:
            candidate.status = "rejected"
            candidate.decided_at = now
        step.status = "rejected"
        request.status = "rejected"
        request.current_step_no = None
        request.decided_at = now
        await db.execute(
            ApprovalRequestStep.__table__.update()
            .where(
                ApprovalRequestStep.expense_request_id == request.id,
                ApprovalRequestStep.status == "waiting",
            )
            .values(status="skipped")
        )
        db.add(SystemNotification(
            company_id=request.company_id, user_id=request.requester_user_id,
            expense_request_id=request.id, type="rejected", title="คำขอไม่ได้รับอนุมัติ",
            message=comment or request.request_no, action_url=f"/expense-requests/{request.id}",
            dedupe_key=f"rejected:{request.id}:{request.current_revision}",
        ))

    db.add(ExpenseRequestHistory(
        company_id=request.company_id, expense_request_id=request.id,
        revision=request.current_revision, event=action, from_status="pending_approval",
        to_status=request.status, actor_user_id=actor_user_id, note=comment,
        snapshot={"step_id": step.id, "step_no": step.step_no},
        ip_address=ip_address, user_agent=user_agent,
    ))

    db.add(ApprovalAction(
        request_step_id=step.id,
        actor_user_id=actor_user_id,
        action=action,
        comment=comment,
        idempotency_key=idempotency_key,
        ip_address=ip_address,
        user_agent=user_agent,
    ))

    try:
        await db.commit()
    except IntegrityError:
        # Lost the idempotency-key race to a concurrent identical retry.
        await db.rollback()
        existing_action = (
            await db.execute(select(ApprovalAction).where(ApprovalAction.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if existing_action:
            return await db.get(ApprovalRequestStep, existing_action.request_step_id)
        raise
    await db.refresh(step)
    return step
