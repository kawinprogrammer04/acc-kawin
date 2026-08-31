from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.approval import ApprovalRequestStep, ExpenseRequest
from app.models.company import Company, UserCompany
from app.models.user import User
from app.schemas.integration import (
    HrApprovalAction,
    HrApprovalCompanySummary,
    HrApprovalSummary,
)
from app.services.hr_kawin import (
    HrTokenError,
    fetch_employee_me,
    find_active_accounting_user,
)

router = APIRouter(prefix="/integrations/hr", tags=["HR Integrations"])
hr_bearer = HTTPBearer(auto_error=False)
INBOX_PATH = "/approvals/inbox"


def _hr_http_error(exc: HrTokenError) -> HTTPException:
    status_code = exc.status_code if exc.status_code in (401, 403) else status.HTTP_502_BAD_GATEWAY
    headers = {"Cache-Control": "no-store"}
    if status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return HTTPException(status_code=status_code, detail=str(exc), headers=headers)


async def _accessible_company_roles(
    db: AsyncSession, user: User,
) -> list[tuple[Company, str | None]]:
    if user.is_platform_admin:
        companies = (await db.execute(
            select(Company).where(Company.is_active.is_(True)).order_by(Company.id)
        )).scalars().all()
        return [(company, None) for company in companies]

    return list((await db.execute(
        select(Company, UserCompany.role)
        .join(UserCompany, UserCompany.company_id == Company.id)
        .where(
            UserCompany.user_id == user.id,
            UserCompany.is_active.is_(True),
            Company.is_active.is_(True),
        )
        .order_by(Company.id)
    )).all())


async def _pending_count_for_company(
    db: AsyncSession,
    user: User,
    company: Company,
    company_role: str | None,
) -> int:
    # Expense workflow tables use PostgreSQL RLS. Re-bind the tenant before
    # every company query so a multi-company summary cannot leak across tenants.
    await db.execute(
        text("SELECT set_config('app.current_company_id', :company_id, true)"),
        {"company_id": str(company.id)},
    )
    conditions = [
        ApprovalRequestStep.status == "pending",
        ExpenseRequest.company_id == company.id,
    ]
    if not user.is_platform_admin and company_role != "super_admin":
        conditions.append(ApprovalRequestStep.resolved_approver_user_id == user.id)

    count = (await db.execute(
        select(func.count(ApprovalRequestStep.id))
        .join(ExpenseRequest, ExpenseRequest.id == ApprovalRequestStep.expense_request_id)
        .where(*conditions)
    )).scalar_one()
    return int(count or 0)


@router.get("/approval-summary", response_model=HrApprovalSummary)
async def get_hr_approval_summary(
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(hr_bearer),
    db: AsyncSession = Depends(get_db),
):
    """Return pending approval counts for the HR backend without exposing requests."""
    response.headers["Cache-Control"] = "no-store"
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ต้องส่ง HR token แบบ Bearer",
            headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"},
        )

    try:
        employee = await fetch_employee_me(credentials.credentials)
        user = await find_active_accounting_user(db, employee.employee_id)
    except HrTokenError as exc:
        raise _hr_http_error(exc) from exc

    company_summaries: list[HrApprovalCompanySummary] = []
    total = 0
    for company, company_role in await _accessible_company_roles(db, user):
        count = await _pending_count_for_company(db, user, company, company_role)
        total += count
        company_summaries.append(HrApprovalCompanySummary(
            company_id=company.id,
            company_code=company.code,
            company_name=company.name_th,
            pending_approval_count=count,
        ))

    return HrApprovalSummary(
        pending_approval_count=total,
        companies=company_summaries,
        action=HrApprovalAction(
            sso_url=f"{settings.ACC_PUBLIC_BASE_URL.rstrip('/')}/login",
            next=INBOX_PATH,
        ),
        generated_at=datetime.now(ZoneInfo("Asia/Bangkok")),
    )
