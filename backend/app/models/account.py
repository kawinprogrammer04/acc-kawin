from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name_th: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(200))
    # asset | liability | equity | revenue | expense
    account_type: Mapped[str] = mapped_column(String(20), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    # debit | credit
    normal_balance: Mapped[str] = mapped_column(String(6), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    level: Mapped[int] = mapped_column(Integer, default=1)
    is_header: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    parent: Mapped["Account | None"] = relationship(
        "Account", remote_side="Account.id", foreign_keys=[parent_id], back_populates="children"
    )
    children: Mapped[list["Account"]] = relationship(
        "Account", foreign_keys=[parent_id], back_populates="parent"
    )
    journal_lines: Mapped[list["JournalLine"]] = relationship("JournalLine", back_populates="account")  # noqa: F821

    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_account_company_code"),
    )
