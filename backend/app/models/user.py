from datetime import datetime
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(200))
    # admin | approver | accountant | viewer
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="accountant")
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    signature_path: Mapped[str | None] = mapped_column(Text)
    # Links this account to an HR employee id so the "ระบบบัญชี" button in HR
    # can SSO in via /auth/sso/hr-login. Admin-managed only — never set from
    # anything the caller supplies directly. NULL = not linked (no SSO access).
    hr_employee_id: Mapped[str | None] = mapped_column(String(30), unique=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
