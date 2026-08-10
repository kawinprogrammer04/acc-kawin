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


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    # ar | ap
    invoice_type: Mapped[str] = mapped_column(String(2), nullable=False)
    invoice_number: Mapped[str] = mapped_column(String(30), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(100))
    invoice_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    party_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("parties.id"), nullable=False)
    period_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounting_periods.id"), nullable=False)

    ar_ap_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), nullable=False)
    revenue_expense_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))

    subtotal: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    taxable_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    vat_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    wht_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    paid_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)

    # draft | sent | partial | paid | overdue | voided
    status: Mapped[str] = mapped_column(String(10), default="draft")
    is_vat_included: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    journal_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("journals.id"))
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    party: Mapped["Party"] = relationship("Party", back_populates="invoices")  # noqa: F821
    period: Mapped["AccountingPeriod"] = relationship("AccountingPeriod")  # noqa: F821
    ar_ap_account: Mapped["Account"] = relationship("Account", foreign_keys=[ar_ap_account_id])  # noqa: F821
    lines: Mapped[list["InvoiceLine"]] = relationship(
        "InvoiceLine", back_populates="invoice", cascade="all, delete-orphan", order_by="InvoiceLine.line_number"
    )

    __table_args__ = (
        CheckConstraint("invoice_type IN ('ar', 'ap')", name="chk_invoice_type"),
        UniqueConstraint("company_id", "invoice_number", name="uq_invoice_company_number"),
    )

    @property
    def balance_due(self) -> float:
        return float(self.total_amount) - float(self.paid_amount)


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    line_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(12, 4), default=1)
    unit: Mapped[str | None] = mapped_column(String(30))
    unit_price: Mapped[float] = mapped_column(Numeric(15, 4), nullable=False)
    discount_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    line_total: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    # 3 | 5 | 15 | 1 | 2
    wht_type: Mapped[str | None] = mapped_column(String(2))
    wht_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    wht_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0)

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="lines")
    account: Mapped["Account | None"] = relationship("Account")  # noqa: F821
