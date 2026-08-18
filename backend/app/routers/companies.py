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

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_platform_admin
from app.core.roles import get_role_level, get_role_levels, role_is_active
from app.core.security import hash_password
from app.models.company import Company, UserCompany
from app.models.approval import Position, UserPosition
from app.models.expense_finance import Department
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
    role: str = "viewer"
    department_id: Optional[int] = None
    # None means "do not change positions" so existing callers that only grant
    # company access remain backwards-compatible. An explicit list replaces the
    # user's positions for this company atomically with the membership update.
    position_ids: Optional[list[int]] = None


class InviteCompanyUserIn(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: str = "viewer"
    department_id: Optional[int] = None


class UserCompanyOut(BaseModel):
    user_id: int
    username: str
    full_name: Optional[str]
    role: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    position_ids: list[int] = Field(default_factory=list)
    position_names: list[str] = Field(default_factory=list)


class UserSearchOut(BaseModel):
    id: int
    username: str
    full_name: Optional[str]
    email: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_accessible_company(company_id: int, current_user: User, db: AsyncSession) -> Company:
    result = await db.execute(
        select(Company).where(Company.id == company_id, Company.is_active == True)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "ไม่พบบริษัท")
    if current_user.is_platform_admin:
        return company
    access = await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == current_user.id,
            UserCompany.company_id == company_id,
            UserCompany.is_active == True,
        )
    )
    if not access.scalar_one_or_none():
        raise HTTPException(403, "ไม่มีสิทธิ์เข้าถึงบริษัทนี้")
    return company


async def _require_company_admin(
    company_id: int,
    current_user: User,
    db: AsyncSession,
) -> Company:
    company = await _get_accessible_company(company_id, current_user, db)
    if current_user.is_platform_admin:
        return company
    membership = (await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == current_user.id,
            UserCompany.company_id == company_id,
            UserCompany.is_active == True,
        )
    )).scalar_one_or_none()
    admin_level = await get_role_level(db, "admin")
    if not membership or await get_role_level(db, membership.role) < admin_level:
        raise HTTPException(403, "ต้องการสิทธิ์ผู้ดูแลบริษัท")
    return company


async def _seed_new_company(db: AsyncSession, company_id: int) -> None:
    """Clone safe master data from company 1 into a newly-created tenant."""
    await db.execute(text("""
        INSERT INTO cashflow_categories
            (type, name, parent_id, color, icon, sort_order, is_active, company_id)
        SELECT type, name, NULL, color, icon, sort_order, is_active, :cid
        FROM cashflow_categories
        WHERE company_id = 1
        ON CONFLICT DO NOTHING
    """), {"cid": company_id})

    await db.execute(text("""
        INSERT INTO accounts
            (code, name_th, name_en, account_type, category, normal_balance,
             parent_id, level, is_header, is_active, description, company_id)
        SELECT code, name_th, name_en, account_type, category, normal_balance,
               NULL, level, is_header, is_active, description, :cid
        FROM accounts
        WHERE company_id = 1
        ON CONFLICT (company_id, code) DO NOTHING
    """), {"cid": company_id})
    await db.execute(text("""
        UPDATE accounts target
        SET parent_id = target_parent.id
        FROM accounts source
        JOIN accounts source_parent ON source_parent.id = source.parent_id
        JOIN accounts target_parent
          ON target_parent.company_id = :cid
         AND target_parent.code = source_parent.code
        WHERE source.company_id = 1
          AND target.company_id = :cid
          AND target.code = source.code
    """), {"cid": company_id})

    await db.execute(text("""
        INSERT INTO fiscal_years
            (name, start_date, end_date, is_closed, company_id)
        SELECT name, start_date, end_date, FALSE, :cid
        FROM fiscal_years
        WHERE company_id = 1
        ON CONFLICT (company_id, name) DO NOTHING
    """), {"cid": company_id})
    await db.execute(text("""
        INSERT INTO accounting_periods
            (fiscal_year_id, period_number, start_date, end_date, is_closed, company_id)
        SELECT target_fy.id, source_period.period_number,
               source_period.start_date, source_period.end_date, FALSE, :cid
        FROM accounting_periods source_period
        JOIN fiscal_years source_fy ON source_fy.id = source_period.fiscal_year_id
        JOIN fiscal_years target_fy
          ON target_fy.company_id = :cid
         AND target_fy.name = source_fy.name
        WHERE source_period.company_id = 1
        ON CONFLICT (company_id, fiscal_year_id, period_number) DO NOTHING
    """), {"cid": company_id})


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CompanyOut])
async def list_companies(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return companies accessible to the current user."""
    if current_user.is_platform_admin:
        result = await db.execute(
            select(Company).where(Company.is_active == True).order_by(Company.id)
        )
    else:
        result = await db.execute(
            select(Company)
            .join(UserCompany, Company.id == UserCompany.company_id)
            .where(
                UserCompany.user_id == current_user.id,
                UserCompany.is_active == True,
                Company.is_active == True,
            )
            .order_by(Company.id)
        )
    return result.scalars().all()


@router.post("", response_model=CompanyOut, status_code=201)
async def create_company(
    payload: CompanyIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    existing = await db.execute(select(Company).where(Company.code == payload.code))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Company code ซ้ำ")
    company = Company(**payload.model_dump())
    db.add(company)
    await db.flush()
    await db.execute(
        text("SELECT set_config('app.current_company_id', :company_id, true)"),
        {"company_id": str(company.id)},
    )

    await _seed_new_company(db, company.id)
    db.add(UserCompany(
        user_id=current_user.id,
        company_id=company.id,
        granted_by=current_user.id,
        role="admin",
    ))
    await db.commit()
    await db.refresh(company)

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
    current_user: User = Depends(get_current_user),
):
    company = await _require_company_admin(company_id, current_user, db)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(company, field, value)
    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def deactivate_company(
    company_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
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
    current_user: User = Depends(get_current_user),
):
    await _require_company_admin(company_id, current_user, db)
    result = await db.execute(
        select(User, UserCompany, Department.name)
        .join(UserCompany, User.id == UserCompany.user_id)
        .outerjoin(Department, Department.id == UserCompany.department_id)
        .where(UserCompany.company_id == company_id)
        .order_by(User.id)
    )
    rows = result.all()
    active_user_ids = [user.id for user, membership, _ in rows if membership.is_active]
    positions_by_user: dict[int, list[tuple[int, str]]] = {}
    if active_user_ids:
        position_rows = (await db.execute(
            select(UserPosition.user_id, Position.id, Position.name)
            .join(Position, Position.id == UserPosition.position_id)
            .where(
                UserPosition.company_id == company_id,
                UserPosition.user_id.in_(active_user_ids),
                UserPosition.is_active.is_(True),
                Position.is_active.is_(True),
            )
            .order_by(UserPosition.user_id, Position.name)
        )).all()
        for user_id, position_id, position_name in position_rows:
            positions_by_user.setdefault(user_id, []).append((position_id, position_name))
    return [{
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": membership.role,
        "department_id": membership.department_id,
        "department_name": department_name,
        "position_ids": [position_id for position_id, _ in positions_by_user.get(user.id, [])],
        "position_names": [position_name for _, position_name in positions_by_user.get(user.id, [])],
    } for user, membership, department_name in rows if membership.is_active]


@router.get("/{company_id}/users/search", response_model=list[UserSearchOut])
async def search_users_to_grant(
    company_id: int,
    q: str = Query(min_length=2),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find existing, active users not yet granted access to this company."""
    await _require_company_admin(company_id, current_user, db)
    pattern = f"%{q}%"
    result = await db.execute(
        select(User)
        .where(
            (User.username.ilike(pattern)) | (User.email.ilike(pattern)) | (User.full_name.ilike(pattern)),
            User.is_active == True,
            ~User.id.in_(
                select(UserCompany.user_id).where(
                    UserCompany.company_id == company_id, UserCompany.is_active == True
                )
            ),
        )
        .order_by(User.username)
        .limit(20)
    )
    return result.scalars().all()


@router.post("/{company_id}/users", status_code=201)
async def grant_company_access(
    company_id: int,
    payload: GrantUserIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    company = await _require_company_admin(company_id, current_user, db)
    if not await role_is_active(db, payload.role):
        raise HTTPException(400, "ไม่พบบทบาทนี้ หรือบทบาทนี้ถูกปิดใช้งานแล้ว")
    if payload.department_id is not None:
        department = (await db.execute(select(Department).where(
            Department.id == payload.department_id,
            Department.company_id == company_id,
            Department.is_active.is_(True),
        ))).scalar_one_or_none()
        if not department:
            raise HTTPException(400, "แผนกไม่ถูกต้องหรือไม่ได้อยู่ในบริษัทที่เลือก")
    desired_position_ids: set[int] | None = None
    if payload.position_ids is not None:
        desired_position_ids = set(payload.position_ids)
        if len(desired_position_ids) != len(payload.position_ids):
            raise HTTPException(400, "พบตำแหน่งซ้ำในรายการที่เลือก")
        if desired_position_ids:
            valid_position_ids = set((await db.execute(
                select(Position.id).where(
                    Position.id.in_(desired_position_ids),
                    Position.company_id == company_id,
                    Position.is_active.is_(True),
                )
            )).scalars().all())
            if valid_position_ids != desired_position_ids:
                raise HTTPException(400, "พบตำแหน่งที่ไม่ถูกต้องหรือไม่ได้อยู่ในบริษัทที่เลือก")
    levels = await get_role_levels(db)
    if payload.user_id == current_user.id and levels.get(payload.role, 0) < levels.get("admin", 0):
        raise HTTPException(400, "ไม่สามารถลดสิทธิ์ผู้ดูแลของบัญชีตัวเองได้")
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
    membership = existing.scalar_one_or_none()
    if membership:
        membership.role = payload.role
        membership.department_id = payload.department_id
        membership.is_active = True
    else:
        db.add(UserCompany(
            user_id=payload.user_id,
            company_id=company.id,
            department_id=payload.department_id,
            granted_by=current_user.id,
            role=payload.role,
        ))
    if desired_position_ids is not None:
        existing_position_rows = (await db.execute(
            select(UserPosition).where(
                UserPosition.user_id == payload.user_id,
                UserPosition.company_id == company_id,
            )
        )).scalars().all()
        existing_by_position = {row.position_id: row for row in existing_position_rows}

        for position_id, row in existing_by_position.items():
            if position_id in desired_position_ids:
                row.is_active = True
            else:
                await db.delete(row)

        for position_id in desired_position_ids - existing_by_position.keys():
            db.add(UserPosition(
                company_id=company_id,
                user_id=payload.user_id,
                position_id=position_id,
            ))
    await db.commit()
    return {
        "detail": "บันทึกสิทธิ์และตำแหน่งเรียบร้อย",
        "position_ids": sorted(desired_position_ids) if desired_position_ids is not None else None,
    }


@router.post("/{company_id}/users/invite", response_model=UserCompanyOut, status_code=201)
async def invite_company_user(
    company_id: int,
    payload: InviteCompanyUserIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_company_admin(company_id, current_user, db)
    if not await role_is_active(db, payload.role):
        raise HTTPException(400, "ไม่พบบทบาทนี้ หรือบทบาทนี้ถูกปิดใช้งานแล้ว")
    if payload.department_id is not None:
        department = (await db.execute(select(Department).where(
            Department.id == payload.department_id,
            Department.company_id == company_id,
            Department.is_active.is_(True),
        ))).scalar_one_or_none()
        if not department:
            raise HTTPException(400, "แผนกไม่ถูกต้องหรือไม่ได้อยู่ในบริษัทที่เลือก")
    existing = (await db.execute(
        select(User).where(
            (User.username == payload.username) | (User.email == payload.email)
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(
            400,
            "Username หรือ Email มีอยู่แล้ว ให้ผู้ดูแลแพลตฟอร์มเพิ่มบัญชีเดิมเข้าบริษัท",
        )

    user = User(
        username=payload.username.strip(),
        email=str(payload.email).lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role="viewer",
    )
    db.add(user)
    await db.flush()
    db.add(UserCompany(
        user_id=user.id,
        company_id=company_id,
        department_id=payload.department_id,
        granted_by=current_user.id,
        role=payload.role,
    ))
    await db.commit()
    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": payload.role,
        "department_id": payload.department_id,
        "department_name": department.name if payload.department_id is not None else None,
    }


@router.delete("/{company_id}/users/{user_id}", status_code=204)
async def revoke_company_access(
    company_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_company_admin(company_id, current_user, db)
    if user_id == current_user.id:
        raise HTTPException(400, "ไม่สามารถถอนสิทธิ์ของบัญชีตัวเองได้")
    result = await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == user_id,
            UserCompany.company_id == company_id,
        )
    )
    uc = result.scalar_one_or_none()
    if not uc:
        raise HTTPException(404, "ไม่พบการกำหนดสิทธิ์")
    uc.is_active = False
    await db.commit()
