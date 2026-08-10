from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AppMenu(Base):
    __tablename__ = "app_menus"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    path: Mapped[str | None] = mapped_column(String(300))
    icon: Mapped[str | None] = mapped_column(String(80))
    group_key: Mapped[str | None] = mapped_column(String(80))
    group_label: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    permissions: Mapped[list["MenuPermission"]] = relationship(
        back_populates="menu",
        cascade="all, delete-orphan",
    )
    permission_items: Mapped[list["PermissionItem"]] = relationship(back_populates="menu")


class MenuPermission(Base):
    __tablename__ = "menu_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    menu_id: Mapped[int] = mapped_column(Integer, ForeignKey("app_menus.id", ondelete="CASCADE"), nullable=False)
    can_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_create: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_update: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_approve: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_export: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    menu: Mapped[AppMenu] = relationship(back_populates="permissions")

    __table_args__ = (
        UniqueConstraint("user_id", "menu_id", name="uq_menu_permissions_user_menu"),
    )


class PermissionItem(Base):
    __tablename__ = "permission_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    menu_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("app_menus.id", ondelete="SET NULL"))
    menu_key: Mapped[str | None] = mapped_column(String(80))
    action_key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    route_method: Mapped[str | None] = mapped_column(String(12))
    route_path: Mapped[str | None] = mapped_column(String(400))
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="route")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    menu: Mapped[AppMenu | None] = relationship(back_populates="permission_items")
    set_items: Mapped[list["PermissionSetItem"]] = relationship(back_populates="permission_item")


class PermissionSet(Base):
    __tablename__ = "permission_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items: Mapped[list["PermissionSetItem"]] = relationship(
        back_populates="permission_set",
        cascade="all, delete-orphan",
    )
    users: Mapped[list["UserPermissionSet"]] = relationship(
        back_populates="permission_set",
        cascade="all, delete-orphan",
    )


class PermissionSetItem(Base):
    __tablename__ = "permission_set_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    permission_set_id: Mapped[int] = mapped_column(Integer, ForeignKey("permission_sets.id", ondelete="CASCADE"), nullable=False)
    permission_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("permission_items.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    permission_set: Mapped[PermissionSet] = relationship(back_populates="items")
    permission_item: Mapped[PermissionItem] = relationship(back_populates="set_items")

    __table_args__ = (
        UniqueConstraint("permission_set_id", "permission_item_id", name="uq_permission_set_items_set_item"),
    )


class UserPermissionSet(Base):
    __tablename__ = "user_permission_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    permission_set_id: Mapped[int] = mapped_column(Integer, ForeignKey("permission_sets.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    permission_set: Mapped[PermissionSet] = relationship(back_populates="users")

    __table_args__ = (
        UniqueConstraint("user_id", "permission_set_id", name="uq_user_permission_sets_user_set"),
    )


class PositionPermissionSet(Base):
    __tablename__ = "position_permission_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id", ondelete="CASCADE"), nullable=False)
    permission_set_id: Mapped[int] = mapped_column(Integer, ForeignKey("permission_sets.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("position_id", "permission_set_id", name="uq_position_permission_sets_position_set"),
    )


class UserPermissionOverride(Base):
    __tablename__ = "user_permission_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    permission_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("permission_items.id", ondelete="CASCADE"), nullable=False)
    is_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    permission_item: Mapped[PermissionItem] = relationship()

    __table_args__ = (
        UniqueConstraint("user_id", "permission_item_id", name="uq_user_permission_overrides_user_item"),
    )
