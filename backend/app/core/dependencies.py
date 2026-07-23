from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# Role hierarchy: admin > approver > accountant > viewer
ROLE_LEVELS = {"admin": 4, "approver": 3, "accountant": 2, "viewer": 1}


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


def require_role(*roles: str):
    """Factory that returns a dependency requiring one of the given roles."""
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles and current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ต้องการสิทธิ์: {', '.join(roles)}",
            )
        return current_user
    return _check


def require_min_role(min_role: str):
    """Require a role at or above the given minimum in the hierarchy."""
    min_level = ROLE_LEVELS.get(min_role, 0)

    async def _check(current_user: User = Depends(get_current_user)) -> User:
        user_level = ROLE_LEVELS.get(current_user.role, 0)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ต้องการสิทธิ์ระดับ {min_role} ขึ้นไป",
            )
        return current_user
    return _check


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
    """Validate the X-Company-Id header and return the company object.
    Admin users bypass the user_companies check.
    If header is missing, defaults to the first company the user has access to.
    """
    from app.models.company import Company, UserCompany

    if x_company_id is None:
        # Default: first accessible company
        if current_user.role == "admin":
            result = await db.execute(
                select(Company).where(Company.is_active == True).order_by(Company.id).limit(1)
            )
        else:
            result = await db.execute(
                select(Company)
                .join(UserCompany, Company.id == UserCompany.company_id)
                .where(UserCompany.user_id == current_user.id, Company.is_active == True)
                .order_by(Company.id)
                .limit(1)
            )
        company = result.scalar_one_or_none()
        if not company:
            raise HTTPException(status_code=403, detail="ผู้ใช้งานไม่มีสิทธิ์เข้าถึงบริษัทใด")
        return company

    result = await db.execute(
        select(Company).where(Company.id == x_company_id, Company.is_active == True)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="ไม่พบบริษัท")

    # Admin bypasses access check
    if current_user.role == "admin":
        return company

    # Non-admin: verify user_companies
    access = await db.execute(
        select(UserCompany).where(
            UserCompany.user_id == current_user.id,
            UserCompany.company_id == x_company_id,
        )
    )
    if not access.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์เข้าถึงบริษัทนี้")
    return company
