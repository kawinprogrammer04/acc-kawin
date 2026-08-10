from datetime import datetime
from uuid import uuid4
from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Integer,
    Numeric, SmallInteger, String, Text, func,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Journal(Base):
    __tablename__ = "journals"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    entry_number: Mapped[str] = mapped_column(String(20), nullable=False)
    entry_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounting_periods.id"), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(100))
    source_type: Mapped[str | None] = mapped_column(String(50))
    source_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    # draft | posted | voided
    status: Mapped[str] = mapped_column(String(10), default="draft")
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    posted_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    void_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    period: Mapped["AccountingPeriod"] = relationship("AccountingPeriod")  # noqa: F821
    lines: Mapped[list["JournalLine"]] = relationship(
        "JournalLine", back_populates="journal", cascade="all, delete-orphan", order_by="JournalLine.line_number"
    )
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by])  # noqa: F821
    poster: Mapped["User | None"] = relationship("User", foreign_keys=[posted_by])  # noqa: F821

    __table_args__ = (
        UniqueConstraint("company_id", "entry_number", name="uq_journal_company_number"),
    )


class JournalLine(Base):
    __tablename__ = "journal_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journal_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("journals.id", ondelete="CASCADE"), nullable=False)
    line_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    account_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    debit: Mapped[float] = mapped_column(Numeric(15, 2), default=0, nullable=False)
    credit: Mapped[float] = mapped_column(Numeric(15, 2), default=0, nullable=False)
    party_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("parties.id"))

    journal: Mapped["Journal"] = relationship("Journal", back_populates="lines")
    account: Mapped["Account"] = relationship("Account", back_populates="journal_lines")  # noqa: F821
    party: Mapped["Party | None"] = relationship("Party")  # noqa: F821

    __table_args__ = (
        CheckConstraint("debit >= 0 AND credit >= 0", name="chk_line_non_negative"),
        CheckConstraint("NOT (debit > 0 AND credit > 0)", name="chk_line_single_side"),
    )
