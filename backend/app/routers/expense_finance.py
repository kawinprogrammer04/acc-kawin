"""Accounting, settlement, finance settings, histories and notifications."""
from calendar import monthrange
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlalchemy import and_, case, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import (
    get_current_company,
    get_current_user,
    has_company_permission,
    require_permission,
)
from app.models.approval import ApprovalRequestStep, ExpenseRequest, ExpenseType, Position
from app.models.company import Company, UserCompany
from app.models.expense_finance import (
    Department, ExpenseAttachmentRequirement, ExpensePayment, ExpenseRequestHistory,
    ExpenseRequestLegacyApprovalStep,
    ExpenseSettlement, ExpenseWithholdingTaxCertificate, SystemNotification,
)
from app.models.user import User
from app.schemas.expense_finance import (
    AccountingCancelIn, AccountingReturnIn, AccountingStatsOut,
    AttachmentRequirementIn, AttachmentRequirementOut, DepartmentIn, DepartmentOut,
    HistoryOut, NotificationOut, PaymentIn, PaymentOut,
    PaymentProofReplaceIn, PaymentVoidIn, SettlementIn, SettlementOut, SettlementReviewIn,
    WithholdingCertificateOut,
)
from app.services import expense_finance_service, expense_request_service

router = APIRouter(tags=["Expense Finance"])

accounting_view = require_permission("expense_accounting.view", legacy_min_role="accountant")
accounting_pay = require_permission("expense_accounting.create", legacy_min_role="accountant")
accounting_update = require_permission("expense_accounting.update", legacy_min_role="accountant")
accounting_cancel_permission = require_permission("expense_accounting.delete", legacy_min_role="accountant")
accounting_approve = require_permission("expense_accounting.approve", legacy_min_role="accountant")
accounting_export = require_permission("expense_accounting.export", legacy_min_role="accountant")
settings_view = require_permission("expense_settings.view", legacy_min_role="admin")
settings_create = require_permission("expense_settings.create", legacy_min_role="admin")
settings_update = require_permission("expense_settings.update", legacy_min_role="admin")
settings_delete = require_permission("expense_settings.delete", legacy_min_role="admin")


async def _request(db: AsyncSession, request_id: str, company_id: int, lock: bool = False) -> ExpenseRequest:
    query = select(ExpenseRequest).where(ExpenseRequest.id == request_id, ExpenseRequest.company_id == company_id)
    if lock:
        query = query.with_for_update()
    row = (await db.execute(query)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบคำขอเบิกเงินนี้")
    return row


async def _can_view(db: AsyncSession, req: ExpenseRequest, user: User, *, accounting: bool = False) -> None:
    if user.is_platform_admin or accounting or req.requester_user_id == user.id:
        return
    if await has_company_permission(
        db,
        user,
        req.company_id,
        "expense_accounting.view",
        legacy_min_role="accountant",
    ):
        return
    membership = (await db.execute(select(UserCompany.role).where(
        UserCompany.user_id == user.id, UserCompany.company_id == req.company_id,
        UserCompany.is_active.is_(True),
    ))).scalar_one_or_none()
    if membership in {"accountant", "admin", "super_admin"}:
        return
    participant = (await db.execute(select(ApprovalRequestStep.id).where(
        ApprovalRequestStep.expense_request_id == req.id,
        ApprovalRequestStep.resolved_approver_user_id == user.id,
    ).limit(1))).scalar_one_or_none()
    if not participant:
        raise HTTPException(403, "คุณไม่มีสิทธิ์ดูคำขอนี้")


ACCOUNTING_STATUSES = [
    "pending_approval", "pending_adjustment_approval", "accounting_review",
    "ready_to_pay", "partially_paid", "paid", "settlement_due", "settlement_review",
    "completed",
]


def _parse_csv_values(value: Optional[str]) -> list[str]:
    """Return unique, non-empty CSV values while preserving their order."""
    if not value:
        return []
    return list(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))


def _parse_csv_ints(value: Optional[str], field_name: str) -> list[int]:
    try:
        return [int(item) for item in _parse_csv_values(value)]
    except ValueError as exc:
        raise HTTPException(422, f"{field_name} ต้องเป็นรายการตัวเลขคั่นด้วยเครื่องหมายจุลภาค") from exc


@router.get("/expense-requests/dashboard")
async def expense_dashboard(
    year: Optional[int] = None,
    department_ids: Optional[list[int]] = Query(None),
    position_ids: Optional[list[int]] = Query(None),
    requester_ids: Optional[list[int]] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    """ACC-native expense dashboard mirroring the HR expense dashboard.

    This endpoint intentionally reads only ACC tables.  HR is not queried and
    no HR data is mutated by viewing this dashboard.
    """
    selected_year = year or datetime.now(timezone.utc).year
    request_query = select(ExpenseRequest).where(
        ExpenseRequest.company_id == company.id,
        func.extract("year", ExpenseRequest.created_at) == selected_year,
    )
    if department_ids:
        request_query = request_query.where(ExpenseRequest.department_id.in_(department_ids))
    if position_ids:
        request_query = request_query.where(ExpenseRequest.requester_position_id.in_(position_ids))
    if requester_ids:
        request_query = request_query.where(ExpenseRequest.requester_user_id.in_(requester_ids))

    rows = list((await db.execute(request_query)).scalars().all())
    status_groups = {
        "requested": ["draft", "returned_for_correction"],
        "pending_approval": ["pending_approval", "pending_adjustment_approval"],
        "approved": ["approved", "ready_to_pay", "settlement_due", "settlement_review"],
        "paid": ["completed"],
        "cancelled": ["cancelled"],
    }
    status_counts = {
        key: sum(row.status in statuses for row in rows)
        for key, statuses in status_groups.items()
    }
    used_statuses = set(status_groups["approved"] + status_groups["paid"])

    # ACC's generic budgets table supports monthly, quarterly, yearly and
    # custom ranges. Allocate each active budget to the months it covers so
    # the dashboard remains useful without introducing an HR-specific table.
    budget_rows = (await db.execute(
        text("""
            SELECT period_type, start_date, end_date, amount
            FROM budgets
            WHERE company_id = :company_id AND is_active = TRUE
              AND budget_type IN ('expense', 'overall')
              AND start_date <= :year_end AND end_date >= :year_start
        """),
        {
            "company_id": company.id,
            "year_start": date(selected_year, 1, 1),
            "year_end": date(selected_year, 12, 31),
        },
    )).mappings().all()
    monthly_budget = [0.0] * 12
    for budget in budget_rows:
        start = max(budget["start_date"], date(selected_year, 1, 1))
        end = min(budget["end_date"], date(selected_year, 12, 31))
        covered = [month for month in range(1, 13) if
                   date(selected_year, month, monthrange(selected_year, month)[1]) >= start and
                   date(selected_year, month, 1) <= end]
        if not covered:
            continue
        amount = float(budget["amount"] or 0)
        allocation = amount / (12 if budget["period_type"] == "yearly" else
                               3 if budget["period_type"] == "quarterly" else
                               len(covered) if budget["period_type"] == "custom" else 1)
        for month in covered:
            monthly_budget[month - 1] += allocation

    month_labels = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    monthly_used = [0.0] * 12
    category_totals: dict[int, float] = {}
    for row in rows:
        if row.status not in used_statuses:
            continue
        amount = float(row.gross_amount or row.amount or 0)
        month = row.created_at.month if row.created_at else row.request_date.month
        monthly_used[month - 1] += amount
        category_totals[row.expense_type_id] = category_totals.get(row.expense_type_id, 0.0) + amount

    type_ids = set(category_totals)
    type_names = dict((await db.execute(select(ExpenseType.id, ExpenseType.name).where(
        ExpenseType.id.in_(type_ids)
    ))).all()) if type_ids else {}
    category_usage = [
        {"category": type_names.get(type_id, f"ประเภท #{type_id}"), "total": total}
        for type_id, total in sorted(category_totals.items(), key=lambda item: item[1], reverse=True)
    ]
    monthly = [
        {
            "month": index + 1,
            "label": month_labels[index],
            "budget": monthly_budget[index],
            "used": monthly_used[index],
            "remaining": monthly_budget[index] - monthly_used[index],
            "over_budget": monthly_used[index] > monthly_budget[index],
        }
        for index in range(12)
    ]

    all_years = (await db.execute(select(func.extract("year", ExpenseRequest.created_at)).where(
        ExpenseRequest.company_id == company.id
    ).distinct().order_by(func.extract("year", ExpenseRequest.created_at).desc()))).scalars().all()
    available_years = sorted({int(value) for value in all_years if value is not None} | {selected_year}, reverse=True)

    option_query = select(ExpenseRequest).where(ExpenseRequest.company_id == company.id)
    option_rows = list((await db.execute(option_query)).scalars().all())
    department_ids_used = {row.department_id for row in option_rows if row.department_id is not None}
    position_ids_used = {row.requester_position_id for row in option_rows if row.requester_position_id is not None}
    requester_ids_used = {row.requester_user_id for row in option_rows if row.requester_user_id is not None}
    departments = [
        {"id": item[0], "name": item[1]}
        for item in (await db.execute(select(Department.id, Department.name).where(
            Department.id.in_(department_ids_used)
        ).order_by(Department.name))).all()
    ] if department_ids_used else []
    positions = [
        {"id": item[0], "name": item[1]}
        for item in (await db.execute(select(Position.id, Position.name).where(
            Position.id.in_(position_ids_used)
        ).order_by(Position.name))).all()
    ] if position_ids_used else []
    users = [
        {"id": item[0], "name": item[1] or item[2]}
        for item in (await db.execute(select(User.id, User.full_name, User.username).where(
            User.id.in_(requester_ids_used)
        ).order_by(User.full_name, User.username))).all()
    ] if requester_ids_used else []

    total_budget = sum(item["budget"] for item in monthly)
    total_used = sum(item["used"] for item in monthly)
    return {
        "year": selected_year,
        "available_years": available_years,
        "status_counts": status_counts,
        "monthly": monthly,
        "total_budget": total_budget,
        "total_used": total_used,
        "total_remaining": total_budget - total_used,
        "category_usage": category_usage,
        "options": {"departments": departments, "positions": positions, "requesters": users},
        "selected": {
            "department_ids": department_ids or [],
            "position_ids": position_ids or [],
            "requester_ids": requester_ids or [],
        },
    }


def _accounting_query(
    company: Company, *, status: Optional[str] = None, statuses: Optional[list[str]] = None,
    department_id: Optional[int] = None, department_ids: Optional[list[int]] = None,
    type_id: Optional[int] = None, type_ids: Optional[list[int]] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
    withholding_only: bool = False, query: Optional[str] = None,
):
    stmt = select(ExpenseRequest).where(ExpenseRequest.company_id == company.id)
    selected_statuses = statuses or ([status] if status else [])
    if selected_statuses:
        stmt = stmt.where(ExpenseRequest.status.in_(selected_statuses))
    else:
        stmt = stmt.where(ExpenseRequest.status.in_(ACCOUNTING_STATUSES))
    # รายการที่อยู่หน้าบัญชีต้องอนุมัติครบทุก step ใน revision ปัจจุบันแล้ว
    incomplete_step = exists(select(1).where(
        ApprovalRequestStep.expense_request_id == ExpenseRequest.id,
        ApprovalRequestStep.revision == ExpenseRequest.current_revision,
        ApprovalRequestStep.status != "approved",
    ))
    stmt = stmt.where(or_(
        ~ExpenseRequest.status.in_(["accounting_review", "ready_to_pay"]),
        ~incomplete_step,
    ))
    selected_department_ids = department_ids or ([department_id] if department_id is not None else [])
    if selected_department_ids:
        stmt = stmt.where(ExpenseRequest.department_id.in_(selected_department_ids))
    selected_type_ids = type_ids or ([type_id] if type_id is not None else [])
    if selected_type_ids:
        stmt = stmt.where(ExpenseRequest.expense_type_id.in_(selected_type_ids))
    if date_from is not None:
        stmt = stmt.where(func.date(ExpenseRequest.submitted_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(ExpenseRequest.submitted_at) <= date_to)
    if withholding_only:
        stmt = stmt.where(or_(
            ExpenseRequest.withholding_required.is_(True),
            ExpenseRequest.requester_withholding_status == "already_withheld",
            ExpenseRequest.withholding_decision == "already_withheld",
        ))
    if query:
        term = f"%{query.strip()}%"
        stmt = stmt.where(ExpenseRequest.request_no.ilike(term) | ExpenseRequest.title.ilike(term) |
                          ExpenseRequest.recipient_name.ilike(term))
    return stmt


def _append_legacy_approval_steps(
    steps_by_request: dict[str, list[dict]],
    legacy_steps: list[ExpenseRequestLegacyApprovalStep],
    current_revisions: dict[str, int],
    native_step_request_ids: set[str],
) -> None:
    """Append every HR step only when the request has no native ACC route.

    Checking ``steps_by_request`` inside the loop is incorrect because adding
    the first legacy step makes the following legacy steps look like a native
    route. Keep the native-request set captured before appending instead.
    """
    for step in legacy_steps:
        if step.expense_request_id in native_step_request_ids:
            continue
        if step.revision != current_revisions.get(step.expense_request_id):
            continue
        steps_by_request[step.expense_request_id].append({
            "id": -step.id,
            "step_no": step.step_no,
            "name": step.name,
            "approver_position_name": None,
            "approver_name": None,
            "approvers": step.approvers,
            "status": step.status,
            "decided_at": step.completed_at,
            "is_legacy": True,
        })


def _apply_accounting_pagination(stmt, limit: int, offset: int):
    """A zero limit is the explicit "show all" mode used by accounting."""
    if limit == 0:
        return stmt
    return stmt.limit(limit).offset(offset)


def _is_adjustment_transfer(
    request: ExpenseRequest,
    paid_request_ids: set[str],
    settlements: dict[str, ExpenseSettlement],
) -> bool:
    settlement = settlements.get(request.id)
    return bool(
        request.id in paid_request_ids and settlement
        and settlement.settlement_type == "additional"
        and request.status in {"accounting_review", "ready_to_pay"}
    )


def _accounting_transfer_amount(
    request: ExpenseRequest,
    paid_request_ids: set[str],
    settlements: dict[str, ExpenseSettlement],
):
    if _is_adjustment_transfer(request, paid_request_ids, settlements):
        return settlements[request.id].difference_amount
    return request.remaining_amount


@router.get("/expense-requests/accounting/list")
async def accounting_list(
    status: Optional[str] = None, statuses: Optional[str] = None, query: Optional[str] = None,
    department_id: Optional[int] = None, department_ids: Optional[str] = None,
    type_id: Optional[int] = None, type_ids: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
    withholding_only: bool = False,
    limit: int = Query(100, ge=0, le=5000), offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    stmt = _accounting_query(
        company, status=status, statuses=_parse_csv_values(statuses),
        department_id=department_id, department_ids=_parse_csv_ints(department_ids, "department_ids"),
        type_id=type_id, type_ids=_parse_csv_ints(type_ids, "type_ids"),
        date_from=date_from, date_to=date_to, withholding_only=withholding_only,
        query=query,
    )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    ordered_stmt = stmt.order_by(
        case((ExpenseRequest.status.in_(["pending_approval", "pending_adjustment_approval"]), 0), else_=1),
        ExpenseRequest.approved_at.desc().nullslast(),
        ExpenseRequest.updated_at.desc(),
    )
    ordered_stmt = _apply_accounting_pagination(ordered_stmt, limit, offset)
    rows = (await db.execute(ordered_stmt)).scalars().all()
    if not rows:
        return {"items": [], "total": total, "limit": limit, "offset": offset}
    request_ids = [row.id for row in rows]
    type_names = dict((await db.execute(select(ExpenseType.id, ExpenseType.name).where(
        ExpenseType.id.in_({row.expense_type_id for row in rows})
    ))).all())
    department_names = dict((await db.execute(select(Department.id, Department.name).where(
        Department.id.in_({row.department_id for row in rows if row.department_id is not None})
    ))).all())
    paid_request_ids = set((await db.execute(select(ExpensePayment.expense_request_id).where(
        ExpensePayment.expense_request_id.in_(request_ids), ExpensePayment.voided_at.is_(None)
    ))).scalars().all())
    settlement_rows = (await db.execute(select(ExpenseSettlement).where(
        ExpenseSettlement.expense_request_id.in_(request_ids)
    ).order_by(ExpenseSettlement.created_at))).scalars().all()
    settlements = {item.expense_request_id: item for item in settlement_rows}
    approval_steps = (await db.execute(select(ApprovalRequestStep).where(
        ApprovalRequestStep.expense_request_id.in_(request_ids)
    ).order_by(ApprovalRequestStep.expense_request_id, ApprovalRequestStep.step_no))).scalars().all()
    current_revisions = {row.id: row.current_revision for row in rows}
    approval_steps = [
        step for step in approval_steps
        if step.revision == current_revisions.get(step.expense_request_id)
    ]
    position_ids = {step.approver_position_id for step in approval_steps if step.approver_position_id is not None}
    approver_user_ids = {step.resolved_approver_user_id for step in approval_steps if step.resolved_approver_user_id}
    position_names = dict((await db.execute(select(Position.id, Position.name).where(
        Position.id.in_(position_ids)
    ))).all()) if position_ids else {}
    approver_names = {
        user_id: full_name or username
        for user_id, full_name, username in (
            await db.execute(select(User.id, User.full_name, User.username).where(User.id.in_(approver_user_ids)))
        ).all()
    } if approver_user_ids else {}
    steps_by_request: dict[str, list[dict]] = {request_id: [] for request_id in request_ids}
    for step in approval_steps:
        position_name = position_names.get(step.approver_position_id)
        steps_by_request[step.expense_request_id].append({
            "id": step.id,
            "step_no": step.step_no,
            "name": step.name or position_name,
            "approver_position_name": position_name,
            "approver_name": approver_names.get(step.resolved_approver_user_id),
            "approvers": [{
                "user_id": step.resolved_approver_user_id,
                "name": approver_names.get(step.resolved_approver_user_id),
                "position_name": position_name,
                "status": step.status,
                "acted_at": step.decided_at,
            }] if step.resolved_approver_user_id else [],
            "status": step.status,
            "decided_at": step.decided_at,
        })
    native_step_request_ids = {
        request_id for request_id, steps in steps_by_request.items() if steps
    }
    legacy_steps = (await db.execute(select(ExpenseRequestLegacyApprovalStep).where(
        ExpenseRequestLegacyApprovalStep.expense_request_id.in_(request_ids)
    ).order_by(
        ExpenseRequestLegacyApprovalStep.expense_request_id,
        ExpenseRequestLegacyApprovalStep.step_no,
    ))).scalars().all()
    _append_legacy_approval_steps(
        steps_by_request, legacy_steps, current_revisions, native_step_request_ids,
    )
    items = [{
        "id": r.id, "request_no": r.request_no, "request_date": r.request_date,
        "title": r.title, "recipient_name": r.recipient_name,
        "requester_name": r.requester_name_snapshot, "request_format": r.request_format,
        "company_id": r.company_id, "company_name": r.company_name_snapshot or company.name_th,
        "department_id": r.department_id,
        "department_name": r.department_name_snapshot or department_names.get(r.department_id),
        "expense_type_id": r.expense_type_id, "expense_type_name": type_names.get(r.expense_type_id),
        "bank_name": r.bank_name, "bank_account_name": r.bank_account_name,
        "bank_account_number": expense_request_service.decrypt_account_number(r.bank_account_number_encrypted),
        "status": r.status, "gross": r.gross_amount, "vat": r.vat_amount,
        "withholding": r.withholding_amount, "net": r.net_amount,
        "paid": r.paid_amount, "remaining": r.remaining_amount,
        "installment_no": r.installment_no, "installment_chain_root_id": r.installment_chain_root_id,
        "installment_chain_status": r.installment_chain_status,
        "installment_payment_amount": r.installment_payment_amount,
        "settlement_due_date": r.settlement_due_date, "submitted_at": r.submitted_at,
        "approved_at": r.approved_at, "approval_steps": steps_by_request[r.id],
        "is_adjustment_transfer": _is_adjustment_transfer(r, paid_request_ids, settlements),
        "transfer_amount": _accounting_transfer_amount(r, paid_request_ids, settlements),
    } for r in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/expense-requests/accounting/stats", response_model=AccountingStatsOut)
async def accounting_stats(
    status: Optional[str] = None, statuses: Optional[str] = None, query: Optional[str] = None,
    department_id: Optional[int] = None, department_ids: Optional[str] = None,
    type_id: Optional[int] = None, type_ids: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
    withholding_only: bool = False,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    rows = (await db.execute(_accounting_query(
        company, status=status, statuses=_parse_csv_values(statuses),
        department_id=department_id, department_ids=_parse_csv_ints(department_ids, "department_ids"),
        type_id=type_id, type_ids=_parse_csv_ints(type_ids, "type_ids"),
        date_from=date_from, date_to=date_to, withholding_only=withholding_only,
        query=query,
    ))).scalars().all()
    today = datetime.now(timezone.utc).date()
    ready = [r for r in rows if r.status == "ready_to_pay"]
    request_ids = [r.id for r in rows]
    paid_request_ids: set[str] = set()
    settlements: dict[str, ExpenseSettlement] = {}
    if request_ids:
        paid_request_ids = set((await db.execute(select(ExpensePayment.expense_request_id).where(
            ExpensePayment.expense_request_id.in_(request_ids), ExpensePayment.voided_at.is_(None)
        ))).scalars().all())
        settlement_rows = (await db.execute(select(ExpenseSettlement).where(
            ExpenseSettlement.expense_request_id.in_(request_ids)
        ).order_by(ExpenseSettlement.created_at))).scalars().all()
        settlements = {item.expense_request_id: item for item in settlement_rows}
    return AccountingStatsOut(
        pending_approval_count=sum(
            r.status in {"pending_approval", "pending_adjustment_approval"} for r in rows
        ),
        accounting_review_count=sum(r.status == "accounting_review" for r in rows),
        ready_to_pay_count=len(ready), settlement_review_count=sum(r.status == "settlement_review" for r in rows),
        overdue_count=sum(r.status == "settlement_due" and r.settlement_due_date and r.settlement_due_date < today for r in rows),
        ready_to_pay_amount=sum((Decimal(r.remaining_amount or r.net_amount or 0) for r in ready), Decimal("0")),
        partially_paid_count=sum(r.status == "partially_paid" for r in rows),
        transfer_amount_total=sum((
            Decimal(_accounting_transfer_amount(r, paid_request_ids, settlements) or 0) for r in rows
        ), Decimal("0")),
    )


@router.get("/expense-requests/accounting/export")
async def export_accounting(
    status: Optional[str] = None, statuses: Optional[str] = None, query: Optional[str] = None,
    department_id: Optional[int] = None, department_ids: Optional[str] = None,
    type_id: Optional[int] = None, type_ids: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
    withholding_only: bool = False,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_export),
    company: Company = Depends(get_current_company),
):
    stmt = _accounting_query(
        company, status=status, statuses=_parse_csv_values(statuses),
        department_id=department_id, department_ids=_parse_csv_ints(department_ids, "department_ids"),
        type_id=type_id, type_ids=_parse_csv_ints(type_ids, "type_ids"),
        date_from=date_from, date_to=date_to, withholding_only=withholding_only,
        query=query,
    )
    rows = (await db.execute(stmt.order_by(ExpenseRequest.created_at.desc()))).scalars().all()
    request_ids = [row.id for row in rows]
    type_ids = {row.expense_type_id for row in rows}
    department_ids = {row.department_id for row in rows if row.department_id is not None}

    expense_type_names = dict((await db.execute(
        select(ExpenseType.id, ExpenseType.name).where(
            ExpenseType.company_id == company.id,
            ExpenseType.id.in_(type_ids),
        )
    )).all()) if type_ids else {}
    department_names = dict((await db.execute(
        select(Department.id, Department.name).where(
            Department.company_id == company.id,
            Department.id.in_(department_ids),
        )
    )).all()) if department_ids else {}
    payment_rows = (await db.execute(
        select(ExpensePayment).where(
            ExpensePayment.company_id == company.id,
            ExpensePayment.expense_request_id.in_(request_ids),
            ExpensePayment.voided_at.is_(None),
        ).order_by(ExpensePayment.paid_at, ExpensePayment.created_at)
    )).scalars().all() if request_ids else []
    payments_by_request_id: dict[str, list[ExpensePayment]] = {}
    for payment in payment_rows:
        payments_by_request_id.setdefault(payment.expense_request_id, []).append(payment)

    settlement_rows = (await db.execute(
        select(ExpenseSettlement).where(
            ExpenseSettlement.company_id == company.id,
            ExpenseSettlement.expense_request_id.in_(request_ids),
        ).order_by(ExpenseSettlement.created_at.desc())
    )).scalars().all() if request_ids else []
    settlements_by_request_id: dict[str, ExpenseSettlement] = {}
    for settlement in settlement_rows:
        settlements_by_request_id.setdefault(settlement.expense_request_id, settlement)

    data = expense_finance_service.excel_bytes(
        list(rows),
        expense_type_names=expense_type_names,
        department_names=department_names,
        payments_by_request_id=payments_by_request_id,
        settlements_by_request_id=settlements_by_request_id,
        company_name=company.name_th,
    )
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=expense-requests.xlsx"})


@router.get("/expense-requests/{request_id}/payments", response_model=list[PaymentOut])
async def list_payments(
    request_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    await _can_view(db, req, current_user)
    return (await db.execute(select(ExpensePayment).where(
        ExpensePayment.expense_request_id == request_id
    ).order_by(ExpensePayment.created_at))).scalars().all()


@router.post("/expense-requests/{request_id}/payments", response_model=PaymentOut, status_code=201)
async def create_payment(
    request_id: str, payload: PaymentIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_pay),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    try:
        return await expense_finance_service.record_payment(db, req, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/expense-requests/{request_id}/payments/{payment_id}/proof")
async def payment_proof(
    request_id: str, payment_id: str, inline: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user), company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    await _can_view(db, req, current_user)
    payment = (await db.execute(select(ExpensePayment).where(
        ExpensePayment.id == payment_id, ExpensePayment.expense_request_id == request_id,
        ExpensePayment.company_id == company.id,
    ))).scalar_one_or_none()
    if not payment or not payment.proof_file_path or not Path(payment.proof_file_path).is_file():
        raise HTTPException(404, "ไม่พบหลักฐานการจ่าย")
    filename = payment.proof_file_name or f"payment-proof-{payment.id}{Path(payment.proof_file_path).suffix}"
    media_type = {
        ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    }.get(Path(payment.proof_file_path).suffix.lower(), "application/octet-stream")
    return FileResponse(
        payment.proof_file_path,
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline" if inline else "attachment",
        headers={"Cache-Control": "private, no-store"},
    )


@router.patch("/expense-payments/{payment_id}/proof", response_model=PaymentOut)
async def replace_payment_proof(
    payment_id: str, payload: PaymentProofReplaceIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_view),
    company: Company = Depends(get_current_company),
):
    payment = (await db.execute(select(ExpensePayment).where(
        ExpensePayment.id == payment_id, ExpensePayment.company_id == company.id,
    ).with_for_update())).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "ไม่พบรายการจ่ายเงินนี้")
    try:
        return await expense_finance_service.replace_payment_proof(db, payment, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/expense-payments/{payment_id}/void", response_model=PaymentOut)
async def void_payment(
    payment_id: str, payload: PaymentVoidIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_cancel_permission),
    company: Company = Depends(get_current_company),
):
    payment = (await db.execute(select(ExpensePayment).where(
        ExpensePayment.id == payment_id, ExpensePayment.company_id == company.id,
    ).with_for_update())).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "ไม่พบรายการจ่ายเงินนี้")
    try:
        return await expense_finance_service.void_payment(db, payment, payload.reason, current_user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/expense-requests/{request_id}/accounting/return")
async def accounting_return(
    request_id: str, payload: AccountingReturnIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id, lock=True)
    if req.status not in {"ready_to_pay", "accounting_review"}:
        raise HTTPException(400, "ส่งกลับได้เฉพาะรายการที่รอตรวจจ่าย")
    previous = req.status
    req.status = "returned_for_correction"
    req.version += 1
    expense_finance_service.add_history(db, req, "accounting_returned", current_user.id, previous, payload.reason)
    expense_finance_service.notify(db, req, req.requester_user_id, "accounting_returned",
        "ฝ่ายบัญชีส่งคำขอกลับให้แก้ไข", payload.reason, f"accounting-return:{req.id}:{req.version}")
    await db.commit()
    return {"status": req.status}


@router.post("/expense-requests/{request_id}/accounting/review")
async def accounting_review_legacy(
    request_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    """Forward legacy accounting-review rows using requester-provided tax data.

    New approvals go directly to ready_to_pay.  This endpoint mirrors the HR
    compatibility action so migrated rows cannot remain stuck forever.
    """
    req = await _request(db, request_id, company.id, lock=True)
    if req.status != "accounting_review":
        raise HTTPException(400, "รายการนี้ไม่ได้อยู่ในขั้นบัญชีตรวจสอบ")
    incomplete = (await db.execute(select(ApprovalRequestStep.id).where(
        ApprovalRequestStep.expense_request_id == req.id,
        ApprovalRequestStep.revision == req.current_revision,
        ApprovalRequestStep.status != "approved",
    ).limit(1))).scalar_one_or_none()
    if incomplete:
        raise HTTPException(400, "รายการอนุมัติหรือลายเซ็นยังไม่ครบ บัญชียังไม่สามารถดำเนินการได้")
    previous = req.status
    req.status = "ready_to_pay"
    req.version += 1
    req.updated_at = datetime.now(timezone.utc)
    expense_finance_service.add_history(
        db, req, "withholding_applied_from_requester", current_user.id, previous,
        "ส่งต่อรายการเดิมด้วยข้อมูลภาษีที่ผู้ขอระบุ",
    )
    expense_finance_service.notify(
        db, req, req.requester_user_id, "ready_to_pay",
        "คำขอผ่านการตรวจจากฝ่ายบัญชีแล้ว", f"{req.request_no} พร้อมจ่าย",
        f"accounting-reviewed:{req.id}:{req.version}",
    )
    await db.commit()
    return {"status": req.status}


@router.post("/expense-requests/{request_id}/accounting/cancel")
async def accounting_cancel(
    request_id: str, payload: AccountingCancelIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_cancel_permission),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id, lock=True)
    previous = req.status
    req.status = "cancelled"
    req.cancelled_at = datetime.now(timezone.utc)
    req.cancelled_by = current_user.id
    req.cancellation_reason = payload.reason
    expense_finance_service.add_history(db, req, "accounting_cancelled", current_user.id, previous, payload.reason)
    await db.commit()
    return {"status": req.status}


@router.post("/expense-requests/{request_id}/settlements", response_model=SettlementOut, status_code=201)
async def create_settlement(
    request_id: str, payload: SettlementIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    try:
        return await expense_finance_service.submit_settlement(db, req, payload, current_user.id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/expense-requests/{request_id}/settlements", response_model=list[SettlementOut])
async def list_settlements(
    request_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    await _can_view(db, req, current_user)
    return (await db.execute(select(ExpenseSettlement).where(
        ExpenseSettlement.expense_request_id == request_id
    ).order_by(ExpenseSettlement.created_at))).scalars().all()


@router.post("/expense-settlements/{settlement_id}/review", response_model=SettlementOut)
async def review_settlement(
    settlement_id: str, payload: SettlementReviewIn,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_approve),
    company: Company = Depends(get_current_company),
):
    settlement = (await db.execute(select(ExpenseSettlement).where(
        ExpenseSettlement.id == settlement_id, ExpenseSettlement.company_id == company.id
    ))).scalar_one_or_none()
    if not settlement:
        raise HTTPException(404, "ไม่พบรายการเคลียร์เงิน")
    try:
        return await expense_finance_service.review_settlement(db, settlement, payload.action, payload.comment, current_user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/expense-requests/{request_id}/histories", response_model=list[HistoryOut])
async def histories(
    request_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    await _can_view(db, req, current_user)
    return (await db.execute(select(ExpenseRequestHistory).where(
        ExpenseRequestHistory.expense_request_id == request_id
    ).order_by(ExpenseRequestHistory.created_at))).scalars().all()


@router.post("/expense-requests/{request_id}/wht-certificate", status_code=201)
async def create_wht_certificate(
    request_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(accounting_update),
    company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    try:
        cert = await expense_finance_service.issue_wht_certificate(db, req, current_user.id)
        return {"id": cert.id, "certificate_no": cert.certificate_no, "sha256": cert.sha256}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get(
    "/expense-requests/{request_id}/wht-certificates",
    response_model=list[WithholdingCertificateOut],
)
async def list_wht_certificates(
    request_id: str, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user), company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    await _can_view(db, req, current_user)
    return (await db.execute(select(ExpenseWithholdingTaxCertificate).where(
        ExpenseWithholdingTaxCertificate.expense_request_id == request_id,
        ExpenseWithholdingTaxCertificate.company_id == company.id,
    ).order_by(ExpenseWithholdingTaxCertificate.issued_at))).scalars().all()


@router.get("/expense-requests/{request_id}/wht-certificate/{certificate_id}")
async def download_wht_certificate(
    request_id: str, certificate_id: str, inline: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user), company: Company = Depends(get_current_company),
):
    req = await _request(db, request_id, company.id)
    await _can_view(db, req, current_user)
    cert = (await db.execute(select(ExpenseWithholdingTaxCertificate).where(
        ExpenseWithholdingTaxCertificate.id == certificate_id,
        ExpenseWithholdingTaxCertificate.expense_request_id == request_id,
    ))).scalar_one_or_none()
    if not cert or not Path(cert.file_path).is_file():
        raise HTTPException(404, "ไม่พบหนังสือรับรอง")
    return FileResponse(
        cert.file_path,
        media_type="application/pdf",
        filename=f"{cert.certificate_no}.pdf",
        content_disposition_type="inline" if inline else "attachment",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/notifications", response_model=list[NotificationOut])
async def notifications(
    unread_only: bool = False, limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    stmt = select(SystemNotification).where(
        SystemNotification.company_id == company.id, SystemNotification.user_id == current_user.id
    )
    if unread_only:
        stmt = stmt.where(SystemNotification.read_at.is_(None))
    return (await db.execute(stmt.order_by(SystemNotification.created_at.desc()).limit(limit))).scalars().all()


@router.post("/notifications/{notification_id}/read")
async def read_notification(
    notification_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    row = (await db.execute(select(SystemNotification).where(
        SystemNotification.id == notification_id, SystemNotification.company_id == company.id,
        SystemNotification.user_id == current_user.id,
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบการแจ้งเตือน")
    row.read_at = datetime.now(timezone.utc)
    await db.commit()
    return {"read_at": row.read_at}


@router.get("/expense-settings/departments", response_model=list[DepartmentOut])
async def list_departments(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
                           company: Company = Depends(get_current_company)):
    return (await db.execute(select(Department).where(Department.company_id == company.id).order_by(Department.name))).scalars().all()


@router.post("/expense-settings/departments", response_model=DepartmentOut, status_code=201)
async def create_department(payload: DepartmentIn, db: AsyncSession = Depends(get_db),
                            current_user: User = Depends(settings_create), company: Company = Depends(get_current_company)):
    row = (await db.execute(select(Department).where(
        Department.company_id == company.id,
        Department.name == payload.name,
    ).with_for_update())).scalar_one_or_none()
    if row and row.is_active:
        raise HTTPException(409, "มีชื่อแผนกนี้อยู่แล้ว")
    if row:
        for key, value in payload.model_dump().items():
            setattr(row, key, value)
        row.is_active = True
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = Department(company_id=company.id, **payload.model_dump())
        db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "ชื่อหรือรหัสแผนกซ้ำกับข้อมูลที่มีอยู่") from exc
    await db.refresh(row)
    return row


@router.put("/expense-settings/departments/{department_id}", response_model=DepartmentOut)
async def update_department(department_id: int, payload: DepartmentIn,
                            db: AsyncSession = Depends(get_db), current_user: User = Depends(settings_update),
                            company: Company = Depends(get_current_company)):
    row = (await db.execute(select(Department).where(
        Department.id == department_id, Department.company_id == company.id,
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบแผนกนี้")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "ชื่อหรือรหัสแผนกซ้ำกับข้อมูลที่มีอยู่") from exc
    await db.refresh(row)
    return row


@router.delete("/expense-settings/departments/{department_id}", status_code=204)
async def delete_department(department_id: int, db: AsyncSession = Depends(get_db),
                            current_user: User = Depends(settings_delete),
                            company: Company = Depends(get_current_company)):
    row = (await db.execute(select(Department).where(
        Department.id == department_id, Department.company_id == company.id,
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบแผนกนี้")
    await db.execute(
        update(Position)
        .where(Position.company_id == company.id, Position.department_id == department_id)
        .values(department_id=None)
    )
    await db.execute(
        update(UserCompany)
        .where(UserCompany.company_id == company.id, UserCompany.department_id == department_id)
        .values(department_id=None)
    )
    row.is_active = False
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("/expense-types/{expense_type_id}/attachment-requirements", response_model=list[AttachmentRequirementOut])
async def requirements(expense_type_id: int, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user), company: Company = Depends(get_current_company)):
    expense_type = (await db.execute(select(ExpenseType).where(
        ExpenseType.id == expense_type_id, ExpenseType.company_id == company.id))).scalar_one_or_none()
    if not expense_type: raise HTTPException(404, "ไม่พบประเภทค่าใช้จ่าย")
    return (await db.execute(select(ExpenseAttachmentRequirement).where(
        ExpenseAttachmentRequirement.expense_type_id == expense_type_id,
        ExpenseAttachmentRequirement.company_id == company.id,
        ExpenseAttachmentRequirement.is_active.is_(True),
    ).order_by(ExpenseAttachmentRequirement.sort_order))).scalars().all()


@router.post("/expense-types/{expense_type_id}/attachment-requirements", response_model=AttachmentRequirementOut, status_code=201)
async def create_requirement(expense_type_id: int, payload: AttachmentRequirementIn,
                             db: AsyncSession = Depends(get_db), current_user: User = Depends(settings_create),
                             company: Company = Depends(get_current_company)):
    expense_type = (await db.execute(select(ExpenseType).where(
        ExpenseType.id == expense_type_id, ExpenseType.company_id == company.id))).scalar_one_or_none()
    if not expense_type: raise HTTPException(404, "ไม่พบประเภทค่าใช้จ่าย")
    row = ExpenseAttachmentRequirement(company_id=company.id, expense_type_id=expense_type_id, **payload.model_dump())
    db.add(row); await db.commit(); await db.refresh(row)
    return row


@router.put("/expense-types/{expense_type_id}/attachment-requirements/{requirement_id}", response_model=AttachmentRequirementOut)
async def update_requirement(expense_type_id: int, requirement_id: int, payload: AttachmentRequirementIn,
                             db: AsyncSession = Depends(get_db), current_user: User = Depends(settings_update),
                             company: Company = Depends(get_current_company)):
    row = (await db.execute(select(ExpenseAttachmentRequirement).where(
        ExpenseAttachmentRequirement.id == requirement_id,
        ExpenseAttachmentRequirement.expense_type_id == expense_type_id,
        ExpenseAttachmentRequirement.company_id == company.id,
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบข้อกำหนดเอกสารนี้")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    await db.commit(); await db.refresh(row)
    return row


@router.delete("/expense-types/{expense_type_id}/attachment-requirements/{requirement_id}", status_code=204)
async def delete_requirement(expense_type_id: int, requirement_id: int,
                             db: AsyncSession = Depends(get_db), current_user: User = Depends(settings_delete),
                             company: Company = Depends(get_current_company)):
    row = (await db.execute(select(ExpenseAttachmentRequirement).where(
        ExpenseAttachmentRequirement.id == requirement_id,
        ExpenseAttachmentRequirement.expense_type_id == expense_type_id,
        ExpenseAttachmentRequirement.company_id == company.id,
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "ไม่พบข้อกำหนดเอกสารนี้")
    row.is_active = False
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("/approval-matrix", include_in_schema=False)
async def old_approval_matrix_redirect():
    return RedirectResponse("/expense-requests/settings", status_code=307)
