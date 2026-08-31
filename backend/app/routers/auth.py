from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_platform_admin
from app.core.roles import role_is_active
from app.core.security import create_access_token, hash_password, verify_password
from app.models.approval import Position, UserPosition
from app.models.company import Company, UserCompany
from app.models.expense_finance import Department
from app.models.role import Role
from app.models.permission import (
    AppMenu,
    MenuPermission,
    PermissionItem,
    PermissionSet,
    PermissionSetItem,
    PositionPermissionSet,
    UserPermissionOverride,
    UserPermissionSet,
)
from app.models.user import User
from app.services import expense_signature_service
from app.services.hr_kawin import HrTokenError, fetch_employee_me, find_active_accounting_user
from app.schemas.auth import (
    HrSsoLoginRequest,
    LoginRequest,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    TokenResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

ACTION_FIELDS = ("can_view", "can_create", "can_update", "can_delete", "can_approve", "can_export")


class CompanyBrief(BaseModel):
    id: int
    code: str
    name_th: str
    name_en: Optional[str]
    is_active: bool
    role: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    model_config = {"from_attributes": True}


class UserMeOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str]
    role: str
    is_platform_admin: bool
    is_active: bool
    companies: list[CompanyBrief] = []
    permissions_configured: bool = False
    menu_permissions: list[dict] = []
    menus: list[dict] = []
    allowed_menus: list[dict] = []
    allowed_permissions: list[str] = []
    permission_sets: list[dict] = []
    has_saved_signature: bool = False
    model_config = {"from_attributes": True}


def _menu_payload(menu: AppMenu) -> dict:
    return {
        "id": menu.id,
        "key": menu.key,
        "label": menu.label,
        "path": menu.path,
        "icon": menu.icon,
        "group_key": menu.group_key,
        "group_label": menu.group_label,
        "description": menu.description,
        "sort_order": menu.sort_order,
        "is_active": menu.is_active,
        "is_system": menu.is_system,
    }


async def _load_permission_payload(db: AsyncSession, user: User) -> tuple[bool, list[dict], list[dict]]:
    active_menus = (
        await db.execute(
            select(AppMenu)
            .where(AppMenu.is_active == True)  # noqa: E712
            .order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id)
        )
    ).scalars().all()

    if user.is_platform_admin:
        menu_permissions = [
            {
                "menu_id": menu.id,
                "menu_key": menu.key,
                **{field: True for field in ACTION_FIELDS},
            }
            for menu in active_menus
        ]
        return True, menu_permissions, [_menu_payload(menu) for menu in active_menus]

    permission_rows = (
        await db.execute(select(MenuPermission).where(MenuPermission.user_id == user.id))
    ).scalars().all()
    permissions_configured = len(permission_rows) > 0
    if not permissions_configured:
        menu_permissions = [
            {
                "menu_id": menu.id,
                "menu_key": menu.key,
                **{field: True for field in ACTION_FIELDS},
            }
            for menu in active_menus
        ]
        return False, menu_permissions, [_menu_payload(menu) for menu in active_menus]

    active_menu_by_id = {menu.id: menu for menu in active_menus}
    menu_permissions = [
        {
            "menu_id": permission.menu_id,
            "menu_key": active_menu_by_id[permission.menu_id].key,
            **{field: bool(getattr(permission, field)) for field in ACTION_FIELDS},
        }
        for permission in permission_rows
        if permission.menu_id in active_menu_by_id
    ]
    allowed_menu_ids = {
        permission["menu_id"]
        for permission in menu_permissions
        if permission["can_view"]
    }
    menus = [_menu_payload(menu) for menu in active_menus if menu.id in allowed_menu_ids]
    return permissions_configured, menu_permissions, menus


def _legacy_allowed_permissions(menu_permissions: list[dict]) -> list[str]:
    action_by_field = {
        "can_view": "view",
        "can_create": "create",
        "can_update": "update",
        "can_delete": "delete",
        "can_approve": "approve",
        "can_export": "export",
    }
    allowed: list[str] = []
    for permission in menu_permissions:
        menu_key = permission.get("menu_key")
        if not menu_key:
            continue
        for field, action in action_by_field.items():
            if permission.get(field):
                allowed.append(f"{menu_key}.{action}")
    return sorted(set(allowed))


async def _load_catalog_permission_payload(
    db: AsyncSession,
    user: User,
    legacy_configured: bool,
    legacy_permissions: list[dict],
    legacy_menus: list[dict],
) -> tuple[bool, list[dict], list[str], list[dict]]:
    try:
        active_menus = (
            await db.execute(
                select(AppMenu)
                .where(AppMenu.is_active == True)  # noqa: E712
                .order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id)
            )
        ).scalars().all()
        active_menu_by_id = {menu.id: menu for menu in active_menus}

        if user.is_platform_admin:
            items = (
                await db.execute(
                    select(PermissionItem)
                    .where(PermissionItem.is_active == True)  # noqa: E712
                    .order_by(PermissionItem.key)
                )
            ).scalars().all()
            allowed_permissions = sorted({item.key for item in items})
            return True, [_menu_payload(menu) for menu in active_menus], allowed_permissions, []

        assigned_sets = (
            await db.execute(
                select(PermissionSet)
                .join(UserPermissionSet, UserPermissionSet.permission_set_id == PermissionSet.id)
                .where(
                    UserPermissionSet.user_id == user.id,
                    PermissionSet.is_active == True,  # noqa: E712
                )
                .order_by(PermissionSet.name)
            )
        ).scalars().all()
        # Sets granted via any of the user's active positions (see app/models/approval.py
        # UserPosition) — a position-based alternative to assigning sets per-user directly.
        position_sets = (
            await db.execute(
                select(PermissionSet)
                .join(PositionPermissionSet, PositionPermissionSet.permission_set_id == PermissionSet.id)
                .join(UserPosition, UserPosition.position_id == PositionPermissionSet.position_id)
                .where(
                    UserPosition.user_id == user.id,
                    UserPosition.is_active == True,  # noqa: E712
                    PermissionSet.is_active == True,  # noqa: E712
                )
                .order_by(PermissionSet.name)
            )
        ).scalars().all()
        override_rows = (
            await db.execute(
                select(UserPermissionOverride, PermissionItem)
                .join(PermissionItem, PermissionItem.id == UserPermissionOverride.permission_item_id)
                .where(UserPermissionOverride.user_id == user.id, PermissionItem.is_active == True)  # noqa: E712
            )
        ).all()
        catalog_configured = bool(assigned_sets or position_sets or override_rows)
        if not catalog_configured:
            return legacy_configured, legacy_menus, _legacy_allowed_permissions(legacy_permissions), []

        all_sets = {s.id: s for s in (*assigned_sets, *position_sets)}
        allowed_items = (
            await db.execute(
                select(PermissionItem)
                .join(PermissionSetItem, PermissionSetItem.permission_item_id == PermissionItem.id)
                .where(
                    PermissionSetItem.permission_set_id.in_(all_sets.keys()),
                    PermissionItem.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all() if all_sets else []

        allowed_by_id = {item.id: item for item in allowed_items}
        for override, item in override_rows:
            if override.is_allowed:
                allowed_by_id[item.id] = item
            else:
                allowed_by_id.pop(item.id, None)

        allowed_permissions = sorted({item.key for item in allowed_by_id.values()})
        visible_menu_ids = {
            item.menu_id
            for item in allowed_by_id.values()
            if item.menu_id and item.action_key == "view"
        }
        allowed_menus = [_menu_payload(menu) for menu_id, menu in active_menu_by_id.items() if menu_id in visible_menu_ids]
        permission_sets = [
            {
                "id": permission_set.id,
                "name": permission_set.name,
                "description": permission_set.description,
                "is_active": permission_set.is_active,
                "is_system": permission_set.is_system,
                "permission_item_ids": [],
            }
            for permission_set in all_sets.values()
        ]
        return True, allowed_menus, allowed_permissions, permission_sets
    except SQLAlchemyError:
        return legacy_configured, legacy_menus, _legacy_allowed_permissions(legacy_permissions), []


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="บัญชีถูกระงับการใช้งาน")

    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, user_id=user.id, username=user.username, role=user.role)


@router.post("/sso/hr-login", response_model=TokenResponse)
async def sso_hr_login(payload: HrSsoLoginRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a short-lived HR token (from the "ระบบบัญชี" button in HR) for
    our own session. Identity comes ONLY from HR's response to this token —
    never from anything the caller claims directly — so a forged employee id
    can't be smuggled in."""
    try:
        employee = await fetch_employee_me(payload.token)
    except HrTokenError as exc:
        status_code = exc.status_code if exc.status_code in (401, 403) else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    # The HR employee id is the accounting username by contract. Both SSO and
    # the HR integration API use this resolver so their access rules cannot drift.
    try:
        user = await find_active_accounting_user(db, employee.employee_id)
    except HrTokenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, user_id=user.id, username=user.username, role=user.role)


@router.get("/me", response_model=UserMeOut)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Fetch accessible companies
    if current_user.is_platform_admin:
        memberships = {
            membership.company_id: (membership, department_name)
            for membership, department_name in (await db.execute(
                select(UserCompany, Department.name)
                .outerjoin(Department, Department.id == UserCompany.department_id)
                .where(UserCompany.user_id == current_user.id, UserCompany.is_active.is_(True))
            )).all()
        }
        result = await db.execute(
            select(Company).where(Company.is_active == True).order_by(Company.id)
        )
        companies = [
            {
                "id": company.id,
                "code": company.code,
                "name_th": company.name_th,
                "name_en": company.name_en,
                "is_active": company.is_active,
                "role": "admin",
                "department_id": memberships.get(company.id, (None, None))[0].department_id
                    if memberships.get(company.id, (None, None))[0] else None,
                "department_name": memberships.get(company.id, (None, None))[1],
            }
            for company in result.scalars().all()
        ]
    else:
        result = await db.execute(
            select(Company, UserCompany, Department.name)
            .join(UserCompany, Company.id == UserCompany.company_id)
            .outerjoin(Department, Department.id == UserCompany.department_id)
            .where(
                UserCompany.user_id == current_user.id,
                UserCompany.is_active == True,
                Company.is_active == True,
            )
            .order_by(Company.id)
        )
        companies = [
            {
                "id": company.id,
                "code": company.code,
                "name_th": company.name_th,
                "name_en": company.name_en,
                "is_active": company.is_active,
                "role": membership.role,
                "department_id": membership.department_id,
                "department_name": department_name,
            }
            for company, membership, department_name in result.all()
        ]

    permissions_configured, menu_permissions, menus = await _load_permission_payload(db, current_user)
    (
        catalog_configured,
        allowed_menus,
        allowed_permissions,
        permission_sets,
    ) = await _load_catalog_permission_payload(db, current_user, permissions_configured, menu_permissions, menus)

    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "is_platform_admin": current_user.is_platform_admin,
        "is_active": current_user.is_active,
        "companies": companies,
        "permissions_configured": catalog_configured,
        "menu_permissions": menu_permissions,
        "menus": menus,
        "allowed_menus": allowed_menus,
        "allowed_permissions": allowed_permissions,
        "permission_sets": permission_sets,
        "has_saved_signature": bool(current_user.signature_path),
    }


@router.get("/me/signature")
async def get_my_saved_signature(current_user: User = Depends(get_current_user)):
    """Preview the caller's saved signature so they can decide whether to reuse
    it or redraw before approving — never used to actually sign anything."""
    try:
        data_url = expense_signature_service.saved_signature_data_url(current_user.signature_path)
    except ValueError:
        raise HTTPException(404, "ยังไม่มีลายเซ็นที่บันทึกไว้")
    return {"signature_data_url": data_url}


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    existing = await db.execute(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username หรือ Email ซ้ำ")

    if not await role_is_active(db, payload.role):
        raise HTTPException(status_code=400, detail="ไม่พบบทบาทนี้ หรือบทบาทนี้ถูกปิดใช้งานแล้ว")

    if payload.company_id is not None:
        company = await db.get(Company, payload.company_id)
        if not company or not company.is_active:
            raise HTTPException(status_code=404, detail="ไม่พบบริษัทที่เลือก")

    if payload.department_id is not None:
        if payload.company_id is None:
            raise HTTPException(status_code=400, detail="ต้องเลือกบริษัทก่อนจึงจะกำหนดแผนกได้")
        department = (await db.execute(select(Department).where(
            Department.id == payload.department_id,
            Department.company_id == payload.company_id,
            Department.is_active.is_(True),
        ))).scalar_one_or_none()
        if not department:
            raise HTTPException(status_code=400, detail="แผนกไม่ถูกต้องหรือไม่ได้อยู่ในบริษัทที่เลือก")

    if payload.position_ids and payload.company_id is None:
        raise HTTPException(status_code=400, detail="ต้องเลือกบริษัทก่อนจึงจะกำหนดตำแหน่งได้")

    if payload.hr_employee_id:
        conflict = await db.execute(
            select(User.id).where(User.hr_employee_id == payload.hr_employee_id)
        )
        if conflict.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="employee_id นี้ถูกผูกกับผู้ใช้งานอื่นแล้ว")

    if payload.position_ids:
        if len(set(payload.position_ids)) != len(payload.position_ids):
            raise HTTPException(status_code=400, detail="พบตำแหน่งซ้ำในรายการที่เลือก")
        valid_ids = (
            await db.execute(
                select(Position.id).where(
                    Position.id.in_(payload.position_ids),
                    Position.company_id == payload.company_id,
                )
            )
        ).scalars().all()
        if set(valid_ids) != set(payload.position_ids):
            raise HTTPException(status_code=400, detail="พบตำแหน่งที่ไม่ถูกต้องหรือไม่ได้อยู่ในบริษัทที่เลือก")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        hr_employee_id=payload.hr_employee_id or None,
    )
    db.add(user)
    await db.flush()

    if payload.company_id is not None:
        db.add(UserCompany(
            user_id=user.id,
            company_id=payload.company_id,
            department_id=payload.department_id,
            granted_by=current_user.id,
            role=payload.role,
        ))

    for position_id in payload.position_ids:
        db.add(UserPosition(
            company_id=payload.company_id,
            user_id=user.id,
            position_id=position_id,
        ))

    await db.commit()
    await db.refresh(user)
    return user


@router.get("/users", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), _: User = Depends(require_platform_admin)):
    result = await db.execute(select(User).order_by(User.id))
    return result.scalars().all()


@router.get("/users/{user_id}/companies")
async def get_user_companies(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    """Every company this user currently has active membership in, for the edit-user modal."""
    result = await db.execute(
        select(Company, UserCompany, Department.name)
        .join(UserCompany, Company.id == UserCompany.company_id)
        .outerjoin(Department, Department.id == UserCompany.department_id)
        .where(UserCompany.user_id == user_id, UserCompany.is_active == True)  # noqa: E712
        .order_by(Company.id)
    )
    return [
        {
            "company_id": company.id,
            "code": company.code,
            "name_th": company.name_th,
            "role": membership.role,
            "department_id": membership.department_id,
            "department_name": department_name,
        }
        for company, membership, department_name in result.all()
    ]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งาน")
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role is not None:
        if not await role_is_active(db, payload.role):
            raise HTTPException(status_code=400, detail="ไม่พบบทบาทนี้ หรือบทบาทนี้ถูกปิดใช้งานแล้ว")
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if "hr_employee_id" in payload.model_fields_set:
        new_hr_employee_id = payload.hr_employee_id.strip() if payload.hr_employee_id else None
        if new_hr_employee_id:
            conflict = await db.execute(
                select(User.id).where(
                    User.hr_employee_id == new_hr_employee_id,
                    User.id != user.id,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="employee_id นี้ถูกผูกกับผู้ใช้งานอื่นแล้ว")
        user.hr_employee_id = new_hr_employee_id
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_platform_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีตัวเองได้")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งาน")
    user.is_active = False
    await db.commit()


# ── Roles ──────────────────────────────────────────────────────────────────
# The 4 system roles (admin/approver/accountant/viewer) are referenced by literal
# string throughout the routers (require_viewer/require_accountant/etc. in
# dependencies.py) — they can never be deleted, and their `code` never changes.
# Everything else about the role list (custom roles, labels, levels) is
# database-driven; see app/core/roles.py for how levels are resolved.

@router.get("/roles", response_model=list[RoleOut])
async def list_roles(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(Role).order_by(Role.level.desc()))
    return result.scalars().all()


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    payload: RoleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    existing = (await db.execute(select(Role).where(Role.code == payload.code))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="มีบทบาทรหัสนี้อยู่แล้ว")
    role = Role(
        code=payload.code, label=payload.label, level=payload.level,
        is_active=payload.is_active, is_system=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: int,
    payload: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="ไม่พบบทบาทนี้")
    if payload.label is not None:
        role.label = payload.label
    if payload.level is not None:
        role.level = payload.level
    if payload.is_active is not None:
        if role.is_system and not payload.is_active:
            raise HTTPException(status_code=400, detail="ไม่สามารถปิดใช้งานบทบาทหลักของระบบได้")
        role.is_active = payload.is_active
    await db.commit()
    await db.refresh(role)
    return role


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="ไม่พบบทบาทนี้")
    if role.is_system:
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบทบาทหลักของระบบได้")

    # Historical (even inactive/revoked) rows still hold a DB foreign key to this
    # role code, so any past usage blocks a hard delete — use PATCH is_active=false
    # ("ปิดใช้งาน") instead for roles that have ever been assigned.
    users_count = (await db.execute(
        select(func.count()).select_from(User).where(User.role == role.code)
    )).scalar_one()
    memberships_count = (await db.execute(
        select(func.count()).select_from(UserCompany).where(UserCompany.role == role.code)
    )).scalar_one()
    if users_count or memberships_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"เคยมีการใช้บทบาทนี้อยู่ {users_count + memberships_count} รายการ (รวมรายการที่ถูกถอนสิทธิ์แล้ว) "
                "ไม่สามารถลบได้ ใช้ปุ่มปิดใช้งานแทน"
            ),
        )

    await db.delete(role)
    await db.commit()
