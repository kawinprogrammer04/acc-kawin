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


async def _catalog_permission_state(
    db: AsyncSession, user: User, company_id: int, permission_key: str,
) -> tuple[bool, bool]:
    """Return (allowed, configured) for the permission catalog.

    Explicit user overrides win. A user is considered catalog-configured when
    they have an active user/position permission set or an override; callers
    may use the legacy role fallback only when no catalog assignment exists.
    """
    from app.models.approval import UserPosition
    from app.models.permission import (
        PermissionItem, PermissionSet, PermissionSetItem, PositionPermissionSet,
        UserPermissionOverride, UserPermissionSet,
    )

    item = (await db.execute(select(PermissionItem).where(
        PermissionItem.key == permission_key, PermissionItem.is_active.is_(True),
    ))).scalar_one_or_none()
    if not item:
        return False, False
    override = (await db.execute(select(UserPermissionOverride.is_allowed).where(
        UserPermissionOverride.user_id == user.id,
        UserPermissionOverride.permission_item_id == item.id,
    ))).scalar_one_or_none()
    if override is not None:
        return bool(override), True

    user_sets = (await db.execute(select(UserPermissionSet.permission_set_id).join(
        PermissionSet, PermissionSet.id == UserPermissionSet.permission_set_id
    ).where(UserPermissionSet.user_id == user.id, PermissionSet.is_active.is_(True)))).scalars().all()
    position_sets = (await db.execute(select(PositionPermissionSet.permission_set_id)
        .join(PermissionSet, PermissionSet.id == PositionPermissionSet.permission_set_id)
        .join(UserPosition, UserPosition.position_id == PositionPermissionSet.position_id)
        .where(
            UserPosition.user_id == user.id, UserPosition.company_id == company_id,
            UserPosition.is_active.is_(True), PermissionSet.is_active.is_(True),
        ))).scalars().all()
    assigned = set(user_sets) | set(position_sets)
    if not assigned:
        return False, False
    allowed = (await db.execute(select(PermissionSetItem.id).where(
        PermissionSetItem.permission_set_id.in_(assigned),
        PermissionSetItem.permission_item_id == item.id,
    ).limit(1))).scalar_one_or_none()
    return allowed is not None, True


def require_permission(permission_key: str, *, legacy_min_role: str | None = None):
    """Enforce a fine-grained permission with a migration-safe role fallback."""
    async def _check(
        x_company_id: Optional[int] = Header(None, alias="X-Company-Id"),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        company, role = await _resolve_company_access(x_company_id, current_user, db)
        if current_user.is_platform_admin:
            return current_user
        allowed, configured = await _catalog_permission_state(
            db, current_user, company.id, permission_key
        )
        if allowed:
            return current_user
        if not configured and legacy_min_role:
            levels = await get_role_levels(db)
            if levels.get(role, 0) >= levels.get(legacy_min_role, 0):
                return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"ไม่มีสิทธิ์ {permission_key}",
        )
    return _check
