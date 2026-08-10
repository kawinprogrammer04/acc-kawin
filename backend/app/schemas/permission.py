from pydantic import BaseModel


class AppMenuBase(BaseModel):
    key: str
    label: str
    path: str | None = None
    icon: str | None = None
    group_key: str | None = None
    group_label: str | None = None
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True
    is_system: bool = False


class AppMenuCreate(AppMenuBase):
    pass


class AppMenuUpdate(BaseModel):
    label: str | None = None
    path: str | None = None
    icon: str | None = None
    group_key: str | None = None
    group_label: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class AppMenuOut(AppMenuBase):
    id: int
    model_config = {"from_attributes": True}


class MenuPermissionBase(BaseModel):
    menu_id: int
    can_view: bool = False
    can_create: bool = False
    can_update: bool = False
    can_delete: bool = False
    can_approve: bool = False
    can_export: bool = False


class MenuPermissionUpdate(MenuPermissionBase):
    pass


class MenuPermissionOut(MenuPermissionBase):
    id: int | None = None
    user_id: int
    menu_key: str
    model_config = {"from_attributes": True}


class UserPermissionOut(BaseModel):
    user_id: int
    username: str
    full_name: str | None
    permissions: list[MenuPermissionOut]


class UserPermissionUpdate(BaseModel):
    permissions: list[MenuPermissionUpdate]


class MenuSortItem(BaseModel):
    id: int
    sort_order: int
    group_key: str | None = None
    group_label: str | None = None


class MenuSortUpdate(BaseModel):
    items: list[MenuSortItem]


class MenuGroupUpdate(BaseModel):
    group_label: str


class DiscoveredRouteOut(BaseModel):
    method: str
    path: str
    name: str | None = None
    permission_key: str
    action_key: str
    action_label: str
    menu_id: int | None = None
    menu_key: str | None = None
    menu_label: str | None = None
    is_synced: bool = False


class PermissionItemBase(BaseModel):
    key: str
    menu_id: int | None = None
    menu_key: str | None = None
    action_key: str
    label: str
    route_method: str | None = None
    route_path: str | None = None
    source: str = "custom"
    sort_order: int = 0
    is_active: bool = True


class PermissionItemCreate(PermissionItemBase):
    pass


class PermissionItemUpdate(BaseModel):
    key: str | None = None
    menu_id: int | None = None
    menu_key: str | None = None
    action_key: str | None = None
    label: str | None = None
    route_method: str | None = None
    route_path: str | None = None
    source: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PermissionItemOut(PermissionItemBase):
    id: int
    menu_label: str | None = None
    model_config = {"from_attributes": True}


class PermissionSetBase(BaseModel):
    name: str
    description: str | None = None
    is_active: bool = True
    is_system: bool = False


class PermissionSetCreate(PermissionSetBase):
    permission_item_ids: list[int] = []


class PermissionSetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None
    is_system: bool | None = None
    permission_item_ids: list[int] | None = None


class PermissionSetOut(PermissionSetBase):
    id: int
    permission_item_ids: list[int] = []
    model_config = {"from_attributes": True}


class UserPermissionOverrideOut(BaseModel):
    permission_item_id: int
    permission_key: str
    is_allowed: bool


class UserPermissionOverrideUpdate(BaseModel):
    permission_item_id: int
    is_allowed: bool


class UserPermissionCatalogOut(BaseModel):
    user_id: int
    username: str
    full_name: str | None
    permission_set_ids: list[int] = []
    overrides: list[UserPermissionOverrideOut] = []
    effective_permission_keys: list[str] = []


class UserPermissionCatalogUpdate(BaseModel):
    permission_set_ids: list[int] = []
    overrides: list[UserPermissionOverrideUpdate] = []


class PositionPermissionCatalogOut(BaseModel):
    position_id: int
    position_name: str
    permission_set_ids: list[int] = []
    effective_permission_keys: list[str] = []


class PositionPermissionCatalogUpdate(BaseModel):
    permission_set_ids: list[int] = []
