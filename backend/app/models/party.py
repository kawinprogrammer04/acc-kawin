from datetime import datetime
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Party(Base):
    __tablename__ = "parties"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    # customer | vendor | both
    party_type: Mapped[str] = mapped_column(String(10), nullable=False)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name_th: Mapped[str] = mapped_column(String(300), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(300))
    tax_id: Mapped[str | None] = mapped_column(String(13))
    branch_code: Mapped[str] = mapped_column(String(5), default="00000")
    branch_name: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(Text)
    district: Mapped[str | None] = mapped_column(String(100))
    province: Mapped[str | None] = mapped_column(String(100))
    postal_code: Mapped[str | None] = mapped_column(String(10))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(200))
    credit_days: Mapped[int] = mapped_column(SmallInteger, default=30)
    credit_limit: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    ar_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    ap_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    is_vat_registered: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    ar_account: Mapped["Account | None"] = relationship("Account", foreign_keys=[ar_account_id])  # noqa: F821
    ap_account: Mapped["Account | None"] = relationship("Account", foreign_keys=[ap_account_id])  # noqa: F821
    invoices: Mapped[list["Invoice"]] = relationship("Invoice", back_populates="party")  # noqa: F821
