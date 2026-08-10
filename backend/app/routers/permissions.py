from fastapi import APIRouter, Depends, HTTPException, Request, status
from types import SimpleNamespace
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_platform_admin
from app.models.approval import Position
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
from app.schemas.permission import (
    AppMenuCreate,
    AppMenuOut,
    AppMenuUpdate,
    DiscoveredRouteOut,
    MenuGroupUpdate,
    MenuPermissionOut,
    MenuSortUpdate,
    PermissionItemCreate,
    PermissionItemOut,
    PermissionItemUpdate,
    PermissionSetCreate,
    PermissionSetOut,
    PermissionSetUpdate,
    PositionPermissionCatalogOut,
    PositionPermissionCatalogUpdate,
    UserPermissionCatalogOut,
    UserPermissionCatalogUpdate,
    UserPermissionOverrideOut,
    UserPermissionOut,
    UserPermissionUpdate,
)
from app.services.permission_discovery import discover_permission_routes

router = APIRouter(prefix="/permissions", tags=["Permissions"])

ACTION_FIELDS = ("can_view", "can_create", "can_update", "can_delete", "can_approve", "can_export")
CATALOG_SETUP_DETAIL = (
    "ยังไม่ได้สร้างตาราง Permission Catalog ในฐานข้อมูล "
    "ให้รันไฟล์ db/08_menu_permissions_manual.sql แล้ว restart backend"
)


async def _raise_catalog_setup_error(db: AsyncSession, exc: SQLAlchemyError) -> None:
    await db.rollback()
    raise HTTPException(status_code=400, detail=CATALOG_SETUP_DETAIL) from exc


def _permission_out(user_id: int, menu: AppMenu, permission: MenuPermission | None) -> MenuPermissionOut:
    values = {field: bool(getattr(permission, field)) if permission else False for field in ACTION_FIELDS}
    return MenuPermissionOut(
        id=permission.id if permission else None,
        user_id=user_id,
        menu_id=menu.id,
        menu_key=menu.key,
        **values,
    )


def _permission_item_out(item: PermissionItem, menu: AppMenu | None = None) -> PermissionItemOut:
    return PermissionItemOut(
        id=item.id,
        key=item.key,
        menu_id=item.menu_id,
        menu_key=item.menu_key,
        menu_label=menu.label if menu else None,
        action_key=item.action_key,
        label=item.label,
        route_method=item.route_method,
        route_path=item.route_path,
        source=item.source,
        sort_order=item.sort_order,
        is_active=item.is_active,
    )


async def _permission_set_out(db: AsyncSession, permission_set: PermissionSet) -> PermissionSetOut:
    item_ids = (
        await db.execute(
            select(PermissionSetItem.permission_item_id)
            .where(PermissionSetItem.permission_set_id == permission_set.id)
            .order_by(PermissionSetItem.permission_item_id)
        )
    ).scalars().all()
    return PermissionSetOut(
        id=permission_set.id,
        name=permission_set.name,
        description=permission_set.description,
        is_active=permission_set.is_active,
        is_system=permission_set.is_system,
        permission_item_ids=list(item_ids),
    )


async def _load_item_menus(db: AsyncSession, items: list[PermissionItem]) -> dict[int, AppMenu]:
    menu_ids = sorted({item.menu_id for item in items if item.menu_id})
    if not menu_ids:
        return {}
    menus = (await db.execute(select(AppMenu).where(AppMenu.id.in_(menu_ids)))).scalars().all()
    return {menu.id: menu for menu in menus}


async def _apply_permission_set_items(db: AsyncSession, permission_set_id: int, item_ids: list[int]) -> None:
    if item_ids:
        existing_items = (
            await db.execute(select(PermissionItem.id).where(PermissionItem.id.in_(item_ids)))
        ).scalars().all()
        if len(set(existing_items)) != len(set(item_ids)):
            raise HTTPException(status_code=400, detail="มี permission item ที่ไม่ถูกต้อง")
    await db.execute(delete(PermissionSetItem).where(PermissionSetItem.permission_set_id == permission_set_id))
    for item_id in sorted(set(item_ids)):
        db.add(PermissionSetItem(permission_set_id=permission_set_id, permission_item_id=item_id))


async def _build_user_catalog_out(db: AsyncSession, user: User) -> UserPermissionCatalogOut:
    assigned_set_ids = (
        await db.execute(
            select(UserPermissionSet.permission_set_id)
            .join(PermissionSet, PermissionSet.id == UserPermissionSet.permission_set_id)
            .where(UserPermissionSet.user_id == user.id, PermissionSet.is_active == True)  # noqa: E712
            .order_by(UserPermissionSet.permission_set_id)
        )
    ).scalars().all()

    allowed_keys = set(
        (
            await db.execute(
                select(PermissionItem.key)
                .join(PermissionSetItem, PermissionSetItem.permission_item_id == PermissionItem.id)
                .join(PermissionSet, PermissionSet.id == PermissionSetItem.permission_set_id)
                .join(UserPermissionSet, UserPermissionSet.permission_set_id == PermissionSet.id)
                .where(
                    UserPermissionSet.user_id == user.id,
                    PermissionSet.is_active == True,  # noqa: E712
                    PermissionItem.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all()
    )

    override_rows = (
        await db.execute(
            select(UserPermissionOverride, PermissionItem)
            .join(PermissionItem, PermissionItem.id == UserPermissionOverride.permission_item_id)
            .where(UserPermissionOverride.user_id == user.id, PermissionItem.is_active == True)  # noqa: E712
            .order_by(PermissionItem.key)
        )
    ).all()
    overrides: list[UserPermissionOverrideOut] = []
    for override, item in override_rows:
        if override.is_allowed:
            allowed_keys.add(item.key)
        else:
            allowed_keys.discard(item.key)
        overrides.append(
            UserPermissionOverrideOut(
                permission_item_id=item.id,
                permission_key=item.key,
                is_allowed=override.is_allowed,
            )
        )

    return UserPermissionCatalogOut(
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        permission_set_ids=list(assigned_set_ids),
        overrides=overrides,
        effective_permission_keys=sorted(allowed_keys),
    )


async def _get_menu(db: AsyncSession, menu_id: int) -> AppMenu:
    menu = (await db.execute(select(AppMenu).where(AppMenu.id == menu_id))).scalar_one_or_none()
    if not menu:
        raise HTTPException(status_code=404, detail="ไม่พบเมนู")
    return menu


async def _build_user_permission_out(db: AsyncSession, user: User) -> UserPermissionOut:
    menus = (await db.execute(select(AppMenu).order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id))).scalars().all()
    permission_rows = (
        await db.execute(select(MenuPermission).where(MenuPermission.user_id == user.id))
    ).scalars().all()
    by_menu_id = {permission.menu_id: permission for permission in permission_rows}
    return UserPermissionOut(
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        permissions=[_permission_out(user.id, menu, by_menu_id.get(menu.id)) for menu in menus],
    )


@router.get("/menus", response_model=list[AppMenuOut])
async def list_menus(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AppMenu).order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id))
    return result.scalars().all()


@router.get("/discovered-routes", response_model=list[DiscoveredRouteOut])
async def list_discovered_routes(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        menus = (await db.execute(select(AppMenu).order_by(AppMenu.sort_order, AppMenu.id))).scalars().all()
    except SQLAlchemyError:
        await db.rollback()
        menus = []
    discovery_menus = [
        SimpleNamespace(id=menu.id, key=menu.key, label=menu.label, path=menu.path)
        for menu in menus
    ]
    try:
        existing_keys = set((await db.execute(select(PermissionItem.key))).scalars().all())
    except SQLAlchemyError:
        await db.rollback()
        existing_keys = set()
    try:
        discovered = discover_permission_routes(request.app, discovery_menus)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"อ่าน route จาก backend ไม่สำเร็จ: {exc}") from exc
    return [
        DiscoveredRouteOut(
            method=item.method,
            path=item.path,
            name=item.name,
            permission_key=item.permission_key,
            action_key=item.action_key,
            action_label=item.action_label,
            menu_id=item.menu_id,
            menu_key=item.menu_key,
            menu_label=item.menu_label,
            is_synced=item.permission_key in existing_keys,
        )
        for item in discovered
    ]


@router.post("/sync-routes", response_model=list[PermissionItemOut])
async def sync_discovered_routes(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        menus = (await db.execute(select(AppMenu).order_by(AppMenu.sort_order, AppMenu.id))).scalars().all()
        existing = (await db.execute(select(PermissionItem))).scalars().all()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    menus_by_id = {menu.id: menu for menu in menus}
    discovered = discover_permission_routes(request.app, menus)
    existing_by_key = {item.key: item for item in existing}
    synced: list[PermissionItem] = []

    for index, route in enumerate(discovered):
        item = existing_by_key.get(route.permission_key)
        if not item:
            item = PermissionItem(
                key=route.permission_key,
                source="route",
                sort_order=index,
                is_active=True,
            )
            db.add(item)
        item.menu_id = route.menu_id
        item.menu_key = route.menu_key
        item.action_key = route.action_key
        item.label = route.action_label
        item.route_method = route.method
        item.route_path = route.path
        synced.append(item)

    await db.commit()
    refreshed = (
        await db.execute(select(PermissionItem).order_by(PermissionItem.menu_key, PermissionItem.sort_order, PermissionItem.key))
    ).scalars().all()
    return [_permission_item_out(item, menus_by_id.get(item.menu_id or 0)) for item in refreshed]


@router.get("/items", response_model=list[PermissionItemOut])
async def list_permission_items(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        items = (
            await db.execute(select(PermissionItem).order_by(PermissionItem.menu_key, PermissionItem.sort_order, PermissionItem.key))
        ).scalars().all()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    menus_by_id = await _load_item_menus(db, items)
    return [_permission_item_out(item, menus_by_id.get(item.menu_id or 0)) for item in items]


@router.post("/items", response_model=PermissionItemOut, status_code=status.HTTP_201_CREATED)
async def create_permission_item(
    payload: PermissionItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        existing = await db.execute(select(PermissionItem).where(PermissionItem.key == payload.key))
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="รหัสสิทธิ์นี้ถูกใช้งานแล้ว")

    menu = None
    values = payload.model_dump()
    if payload.menu_id:
        menu = await _get_menu(db, payload.menu_id)
        values["menu_key"] = menu.key
    item = PermissionItem(**values)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _permission_item_out(item, menu)


@router.patch("/items/{item_id}", response_model=PermissionItemOut)
async def update_permission_item(
    item_id: int,
    payload: PermissionItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        item = (await db.execute(select(PermissionItem).where(PermissionItem.id == item_id))).scalar_one_or_none()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    if not item:
        raise HTTPException(status_code=404, detail="ไม่พบสิทธิ์")

    values = payload.model_dump(exclude_unset=True)
    menu = None
    if "key" in values and values["key"] != item.key:
        existing = await db.execute(select(PermissionItem).where(PermissionItem.key == values["key"]))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="รหัสสิทธิ์นี้ถูกใช้งานแล้ว")
    if "menu_id" in values:
        if values["menu_id"] is None:
            values["menu_key"] = None
        else:
            menu = await _get_menu(db, values["menu_id"])
            values["menu_key"] = menu.key

    for key, value in values.items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    if item.menu_id and menu is None:
        menu = await _get_menu(db, item.menu_id)
    return _permission_item_out(item, menu)


@router.delete("/items/{item_id}", status_code=204)
async def delete_permission_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        item = (await db.execute(select(PermissionItem).where(PermissionItem.id == item_id))).scalar_one_or_none()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    if not item:
        raise HTTPException(status_code=404, detail="ไม่พบสิทธิ์")
    item.is_active = False
    await db.commit()


@router.get("/sets", response_model=list[PermissionSetOut])
async def list_permission_sets(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        permission_sets = (await db.execute(select(PermissionSet).order_by(PermissionSet.name))).scalars().all()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    return [await _permission_set_out(db, permission_set) for permission_set in permission_sets]


@router.post("/sets", response_model=PermissionSetOut, status_code=status.HTTP_201_CREATED)
async def create_permission_set(
    payload: PermissionSetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        existing = await db.execute(select(PermissionSet).where(PermissionSet.name == payload.name))
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="ชื่อชุดสิทธิ์นี้ถูกใช้งานแล้ว")
    permission_set = PermissionSet(
        name=payload.name,
        description=payload.description,
        is_active=payload.is_active,
        is_system=payload.is_system,
    )
    db.add(permission_set)
    await db.flush()
    await _apply_permission_set_items(db, permission_set.id, payload.permission_item_ids)
    await db.commit()
    await db.refresh(permission_set)
    return await _permission_set_out(db, permission_set)


@router.patch("/sets/{set_id}", response_model=PermissionSetOut)
async def update_permission_set(
    set_id: int,
    payload: PermissionSetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        permission_set = (await db.execute(select(PermissionSet).where(PermissionSet.id == set_id))).scalar_one_or_none()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    if not permission_set:
        raise HTTPException(status_code=404, detail="ไม่พบชุดสิทธิ์")

    values = payload.model_dump(exclude_unset=True)
    item_ids = values.pop("permission_item_ids", None)
    if "name" in values and values["name"] != permission_set.name:
        existing = await db.execute(select(PermissionSet).where(PermissionSet.name == values["name"]))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="ชื่อชุดสิทธิ์นี้ถูกใช้งานแล้ว")
    for key, value in values.items():
        setattr(permission_set, key, value)
    if item_ids is not None:
        await _apply_permission_set_items(db, permission_set.id, item_ids)
    await db.commit()
    await db.refresh(permission_set)
    return await _permission_set_out(db, permission_set)


@router.delete("/sets/{set_id}", status_code=204)
async def delete_permission_set(
    set_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    try:
        permission_set = (await db.execute(select(PermissionSet).where(PermissionSet.id == set_id))).scalar_one_or_none()
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)
    if not permission_set:
        raise HTTPException(status_code=404, detail="ไม่พบชุดสิทธิ์")
    permission_set.is_active = False
    await db.commit()


@router.get("/users/{user_id}/catalog", response_model=UserPermissionCatalogOut)
async def get_user_permission_catalog(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งาน")
    try:
        return await _build_user_catalog_out(db, user)
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)


@router.put("/users/{user_id}/catalog", response_model=UserPermissionCatalogOut)
async def update_user_permission_catalog(
    user_id: int,
    payload: UserPermissionCatalogUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งาน")

    try:
        if payload.permission_set_ids:
            valid_set_ids = set(
                (
                    await db.execute(
                        select(PermissionSet.id).where(
                            PermissionSet.id.in_(payload.permission_set_ids),
                            PermissionSet.is_active == True,  # noqa: E712
                        )
                    )
                ).scalars().all()
            )
            if valid_set_ids != set(payload.permission_set_ids):
                raise HTTPException(status_code=400, detail="มีชุดสิทธิ์ที่ไม่ถูกต้อง")
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)

    override_item_ids = [override.permission_item_id for override in payload.overrides]
    try:
        if override_item_ids:
            valid_item_ids = set(
                (
                    await db.execute(
                        select(PermissionItem.id).where(
                            PermissionItem.id.in_(override_item_ids),
                            PermissionItem.is_active == True,  # noqa: E712
                        )
                    )
                ).scalars().all()
            )
            if valid_item_ids != set(override_item_ids):
                raise HTTPException(status_code=400, detail="มี permission override ที่ไม่ถูกต้อง")
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)

    await db.execute(delete(UserPermissionSet).where(UserPermissionSet.user_id == user_id))
    for set_id in sorted(set(payload.permission_set_ids)):
        db.add(UserPermissionSet(user_id=user_id, permission_set_id=set_id))

    await db.execute(delete(UserPermissionOverride).where(UserPermissionOverride.user_id == user_id))
    for override in payload.overrides:
        db.add(
            UserPermissionOverride(
                user_id=user_id,
                permission_item_id=override.permission_item_id,
                is_allowed=override.is_allowed,
            )
        )

    await db.commit()
    return await _build_user_catalog_out(db, user)


async def _build_position_catalog_out(db: AsyncSession, position: Position) -> PositionPermissionCatalogOut:
    assigned_set_ids = (
        await db.execute(
            select(PositionPermissionSet.permission_set_id)
            .join(PermissionSet, PermissionSet.id == PositionPermissionSet.permission_set_id)
            .where(PositionPermissionSet.position_id == position.id, PermissionSet.is_active == True)  # noqa: E712
            .order_by(PositionPermissionSet.permission_set_id)
        )
    ).scalars().all()

    allowed_keys = set(
        (
            await db.execute(
                select(PermissionItem.key)
                .join(PermissionSetItem, PermissionSetItem.permission_item_id == PermissionItem.id)
                .join(PermissionSet, PermissionSet.id == PermissionSetItem.permission_set_id)
                .join(PositionPermissionSet, PositionPermissionSet.permission_set_id == PermissionSet.id)
                .where(
                    PositionPermissionSet.position_id == position.id,
                    PermissionSet.is_active == True,  # noqa: E712
                    PermissionItem.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all()
    )

    return PositionPermissionCatalogOut(
        position_id=position.id,
        position_name=position.name,
        permission_set_ids=list(assigned_set_ids),
        effective_permission_keys=sorted(allowed_keys),
    )


@router.get("/positions/{position_id}/catalog", response_model=PositionPermissionCatalogOut)
async def get_position_permission_catalog(
    position_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    position = (await db.execute(select(Position).where(Position.id == position_id))).scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=404, detail="ไม่พบตำแหน่งนี้")
    try:
        return await _build_position_catalog_out(db, position)
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)


@router.put("/positions/{position_id}/catalog", response_model=PositionPermissionCatalogOut)
async def update_position_permission_catalog(
    position_id: int,
    payload: PositionPermissionCatalogUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    position = (await db.execute(select(Position).where(Position.id == position_id))).scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=404, detail="ไม่พบตำแหน่งนี้")

    try:
        if payload.permission_set_ids:
            valid_set_ids = set(
                (
                    await db.execute(
                        select(PermissionSet.id).where(
                            PermissionSet.id.in_(payload.permission_set_ids),
                            PermissionSet.is_active == True,  # noqa: E712
                        )
                    )
                ).scalars().all()
            )
            if valid_set_ids != set(payload.permission_set_ids):
                raise HTTPException(status_code=400, detail="มีชุดสิทธิ์ที่ไม่ถูกต้อง")
    except SQLAlchemyError as exc:
        await _raise_catalog_setup_error(db, exc)

    await db.execute(delete(PositionPermissionSet).where(PositionPermissionSet.position_id == position_id))
    for set_id in sorted(set(payload.permission_set_ids)):
        db.add(PositionPermissionSet(position_id=position_id, permission_set_id=set_id))

    await db.commit()
    return await _build_position_catalog_out(db, position)


@router.post("/menus", response_model=AppMenuOut, status_code=status.HTTP_201_CREATED)
async def create_menu(
    payload: AppMenuCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    existing = await db.execute(select(AppMenu).where(AppMenu.key == payload.key))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="รหัสเมนูนี้ถูกใช้งานแล้ว")
    menu = AppMenu(**payload.model_dump())
    db.add(menu)
    await db.commit()
    await db.refresh(menu)
    return menu


@router.patch("/menus/{menu_id}", response_model=AppMenuOut)
async def update_menu(
    menu_id: int,
    payload: AppMenuUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    menu = await _get_menu(db, menu_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(menu, key, value)
    await db.commit()
    await db.refresh(menu)
    return menu


@router.post("/menus/reorder", response_model=list[AppMenuOut])
async def reorder_menus(
    payload: MenuSortUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    ids = [item.id for item in payload.items]
    result = await db.execute(select(AppMenu).where(AppMenu.id.in_(ids)))
    menus = {menu.id: menu for menu in result.scalars().all()}
    for item in payload.items:
        if item.id in menus:
            menus[item.id].sort_order = item.sort_order
            menus[item.id].group_key = item.group_key
            menus[item.id].group_label = item.group_label
    await db.commit()
    result = await db.execute(select(AppMenu).order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id))
    return result.scalars().all()


@router.delete("/menus/{menu_id}", status_code=204)
async def delete_menu(
    menu_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    menu = await _get_menu(db, menu_id)
    await db.execute(delete(MenuPermission).where(MenuPermission.menu_id == menu_id))
    await db.delete(menu)
    await db.commit()


@router.patch("/menu-groups/{group_key}", response_model=list[AppMenuOut])
async def update_menu_group(
    group_key: str,
    payload: MenuGroupUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    result = await db.execute(select(AppMenu).where(AppMenu.group_key == group_key))
    menus = result.scalars().all()
    if not menus:
        raise HTTPException(status_code=404, detail="ไม่พบเมนูใหญ่")
    for menu in menus:
        menu.group_label = payload.group_label
    await db.commit()
    result = await db.execute(select(AppMenu).order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id))
    return result.scalars().all()


@router.delete("/menu-groups/{group_key}", status_code=204)
async def delete_menu_group(
    group_key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    result = await db.execute(select(AppMenu.id).where(AppMenu.group_key == group_key).limit(1))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="ไม่สามารถลบเมนูใหญ่ได้ เพราะยังมีเมนูย่อยอยู่ในนั้น")
    await db.commit()


@router.get("/users/{user_id}", response_model=UserPermissionOut)
async def get_user_permissions(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งาน")

    return await _build_user_permission_out(db, user)


@router.put("/users/{user_id}", response_model=UserPermissionOut)
async def update_user_permissions(
    user_id: int,
    payload: UserPermissionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้งาน")

    menu_ids = [item.menu_id for item in payload.permissions]
    menus = (await db.execute(select(AppMenu).where(AppMenu.id.in_(menu_ids)))).scalars().all()
    menus_by_id = {menu.id: menu for menu in menus}
    if len(menus_by_id) != len(set(menu_ids)):
        raise HTTPException(status_code=400, detail="มีเมนูที่ไม่ถูกต้อง")

    existing_rows = (
        await db.execute(select(MenuPermission).where(MenuPermission.user_id == user_id))
    ).scalars().all()
    existing_by_menu_id = {permission.menu_id: permission for permission in existing_rows}

    for item in payload.permissions:
        row = existing_by_menu_id.get(item.menu_id)
        if not row:
            row = MenuPermission(user_id=user_id, menu_id=item.menu_id)
            db.add(row)
        for field in ACTION_FIELDS:
            setattr(row, field, getattr(item, field))

    await db.commit()
    return await _build_user_permission_out(db, user)


@router.get("/my-menus", response_model=list[AppMenuOut])
async def list_my_menus(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.is_platform_admin:
        result = await db.execute(
            select(AppMenu)
            .where(AppMenu.is_active == True)  # noqa: E712
            .order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id)
        )
        return result.scalars().all()

    result = await db.execute(
        select(AppMenu)
        .join(MenuPermission, MenuPermission.menu_id == AppMenu.id)
        .where(
            MenuPermission.user_id == current_user.id,
            MenuPermission.can_view == True,  # noqa: E712
            AppMenu.is_active == True,  # noqa: E712
        )
        .order_by(AppMenu.sort_order, AppMenu.group_key, AppMenu.id)
    )
    return result.scalars().all()
