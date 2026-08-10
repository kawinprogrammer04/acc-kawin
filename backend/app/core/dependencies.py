from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.roles import get_role_levels
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token ไม่ถูกต้องหรือหมดอายุ",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    user_id: int | None = payload.get("sub")
    if not user_id:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise credentials_exception
    return user


async def _resolve_company_access(
    x_company_id: Optional[int],
    current_user: User,
    db: AsyncSession,
):
    """Resolve a tenant and the user's role, then bind it to this transaction."""
    from app.models.company import Company, UserCompany

    if current_user.is_platform_admin:
        stmt = select(Company).where(Company.is_active == True)  # noqa: E712
        if x_company_id is not None:
            stmt = stmt.where(Company.id == x_company_id)
        else:
            stmt = stmt.order_by(Company.id).limit(1)
        company = (await db.execute(stmt)).scalar_one_or_none()
        role = "admin"
    else:
        stmt = (
            select(Company, UserCompany.role)
            .join(UserCompany, Company.id == UserCompany.company_id)
            .where(
                UserCompany.user_id == current_user.id,
                UserCompany.is_active == True,  # noqa: E712
                Company.is_active == True,  # noqa: E712
            )
        )
        if x_company_id is not None:
            stmt = stmt.where(Company.id == x_company_id)
        else:
            stmt = stmt.order_by(Company.id).limit(1)
        row = (await db.execute(stmt)).first()
        company, role = row if row else (None, None)

    if not company:
        detail = "ไม่พบบริษัท" if x_company_id is not None else "ผู้ใช้งานไม่มีสิทธิ์เข้าถึงบริษัทใด"
        raise HTTPException(status_code=403, detail=detail)

    await db.execute(
        text("SELECT set_config('app.current_company_id', :company_id, true)"),
        {"company_id": str(company.id)},
    )
    return company, role


def require_role(*roles: str):
    """Require one of the selected company's membership roles."""
    async def _check(
        x_company_id: Optional[int] = Header(None, alias="X-Company-Id"),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        _, role = await _resolve_company_access(x_company_id, current_user, db)
        if role not in roles and role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ต้องการสิทธิ์ในบริษัท: {', '.join(roles)}",
            )
        return current_user
    return _check


def require_min_role(min_role: str):
    """Require a membership role at or above the selected company's minimum.

    Levels are read from the database (via a process-local cache) rather than
    a fixed dict, so newly-added custom roles slot into the hierarchy without
    a code change — see app/core/roles.py.
    """
    async def _check(
        x_company_id: Optional[int] = Header(None, alias="X-Company-Id"),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        _, role = await _resolve_company_access(x_company_id, current_user, db)
        levels = await get_role_levels(db)
        user_level = levels.get(role, 0)
        min_level = levels.get(min_role, 0)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ต้องการสิทธิ์ระดับ {min_role} ขึ้นไปในบริษัทนี้",
            )
        return current_user
    return _check


async def require_platform_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ต้องการสิทธิ์ผู้ดูแลระบบแพลตฟอร์ม",
        )
    return current_user


# Pre-built dependency shortcuts
require_viewer = require_min_role("viewer")
require_accountant = require_min_role("accountant")
require_approver = require_min_role("approver")
require_admin = require_min_role("admin")


async def get_current_company(
    x_company_id: Optional[int] = Header(None, alias="X-Company-Id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Validate tenant access and bind company_id for PostgreSQL RLS."""
    company, _ = await _resolve_company_access(x_company_id, current_user, db)
    return company
