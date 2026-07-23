"""
Company management endpoints
  GET    /api/companies            — list accessible companies
  POST   /api/companies            — create (admin)
  GET    /api/companies/{id}       — get one
  PATCH  /api/companies/{id}       — update (admin)
  DELETE /api/companies/{id}       — deactivate (admin)
  GET    /api/companies/{id}/users — list members (admin)
  POST   /api/companies/{id}/users — grant user access (admin)
  DELETE /api/companies/{id}/users/{user_id} — revoke (admin)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.models.company import Company, UserCompany
from app.models.user import User

router = APIRouter(prefix="/companies", tags=["Companies"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CompanyOut(BaseModel):
    id: int
    code: str
    name_th: str
    name_en: Optional[str]
    tax_id: Optional[str]
    address: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    website: Optional[str]
    logo_url: Optional[str]
    fiscal_year_start_month: int
    default_currency: str
    vat_rate: float
    is_active: bool
    model_config = {"from_attributes": True}


class CompanyIn(BaseModel):
    code: str
    name_th: str
    name_en: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    fiscal_year_start_month: int = 1
    default_currency: str = "THB"
    vat_rate: float = 7.0


class CompanyUpdate(BaseModel):
    name_th: Optional[str] = None
    name_en: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    fiscal_year_start_month: Optional[int] = None
    default_currency: Optional[str] = None
    vat_rate: Optional[float] = None
    is_active: Optional[bool] = None


class GrantUserIn(BaseModel):
    user_id: int


class UserCompanyOut(BaseModel):
    user_id: int
    username: str
    full_name: Optional[str]
    role: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_accessible_company(company_id: int, current_user: User, db: AsyncSession) -> Company:
    result = await db.execute(
        select(Company).where(Company.id == company_id, Company.is_active == True)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "ไม่พบบริษัท")
    if current_user.role == "admin":
        return company
    access = await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == current_user.id,
            UserCompany.company_id == company_id,
        )
    )
    if not access.scalar_one_or_none():
        raise HTTPException(403, "ไม่มีสิทธิ์เข้าถึงบริษัทนี้")
    return company


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CompanyOut])
async def list_companies(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return companies accessible to the current user."""
    if current_user.role == "admin":
        result = await db.execute(
            select(Company).where(Company.is_active == True).order_by(Company.id)
        )
    else:
        result = await db.execute(
            select(Company)
            .join(UserCompany, Company.id == UserCompany.company_id)
            .where(UserCompany.user_id == current_user.id, Company.is_active == True)
            .order_by(Company.id)
        )
    return result.scalars().all()


@router.post("", response_model=CompanyOut, status_code=201)
async def create_company(
    payload: CompanyIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    existing = await db.execute(select(Company).where(Company.code == payload.code))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Company code ซ้ำ")
    company = Company(**payload.model_dump())
    db.add(company)
    await db.commit()
    await db.refresh(company)

    # Seed the default category set so a new company is usable immediately.
    # Company 1 holds the canonical defaults; copy them to the new company.
    await db.execute(text("""
        INSERT INTO cashflow_categories (type, name, parent_id, color, icon, sort_order, is_active, company_id)
        SELECT type, name, NULL, color, icon, sort_order, is_active, :cid
        FROM cashflow_categories WHERE company_id = 1
    """), {"cid": company.id})
    await db.commit()

    return company


@router.get("/{company_id}", response_model=CompanyOut)
async def get_company(
    company_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_accessible_company(company_id, current_user, db)


@router.patch("/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: int,
    payload: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "ไม่พบบริษัท")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(company, field, value)
    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def deactivate_company(
    company_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "ไม่พบบริษัท")
    company.is_active = False
    await db.commit()


@router.get("/{company_id}/users", response_model=list[UserCompanyOut])
async def list_company_users(
    company_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(User, UserCompany)
        .join(UserCompany, User.id == UserCompany.user_id)
        .where(UserCompany.company_id == company_id)
        .order_by(User.id)
    )
    rows = result.all()
    return [{"user_id": u.id, "username": u.username, "full_name": u.full_name, "role": u.role}
            for u, _ in rows]


@router.post("/{company_id}/users", status_code=201)
async def grant_company_access(
    company_id: int,
    payload: GrantUserIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    company = await _get_accessible_company(company_id, current_user, db)
    user_result = await db.execute(select(User).where(User.id == payload.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "ไม่พบผู้ใช้งาน")
    existing = await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == payload.user_id,
            UserCompany.company_id == company_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"detail": "มีสิทธิ์อยู่แล้ว"}
    uc = UserCompany(user_id=payload.user_id, company_id=company_id, granted_by=current_user.id)
    db.add(uc)
    await db.commit()
    return {"detail": "เพิ่มสิทธิ์เรียบร้อย"}


@router.delete("/{company_id}/users/{user_id}", status_code=204)
async def revoke_company_access(
    company_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == user_id,
            UserCompany.company_id == company_id,
        )
    )
    uc = result.scalar_one_or_none()
    if not uc:
        raise HTTPException(404, "ไม่พบการกำหนดสิทธิ์")
    await db.delete(uc)
    await db.commit()
