from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VatRecord(Base):
    __tablename__ = "vat_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    # output | input
    record_type: Mapped[str] = mapped_column(String(10), nullable=False)
    tax_invoice_number: Mapped[str] = mapped_column(String(50), nullable=False)
    tax_invoice_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    party_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("parties.id"))
    party_name: Mapped[str] = mapped_column(String(300), nullable=False)
    party_tax_id: Mapped[str | None] = mapped_column(String(13))
    party_branch: Mapped[str | None] = mapped_column(String(5))
    taxable_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    vat_rate: Mapped[float] = mapped_column(Numeric(4, 2), default=7.00)
    vat_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    invoice_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("invoices.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    party: Mapped["Party | None"] = relationship("Party")  # noqa: F821

    __table_args__ = (
        CheckConstraint("record_type IN ('output', 'input')", name="chk_vat_type"),
        UniqueConstraint(
            "company_id", "record_type", "tax_invoice_number",
            name="uq_vat_record_company",
        ),
    )


class WhtRecord(Base):
    __tablename__ = "wht_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    wht_number: Mapped[str | None] = mapped_column(String(30))
    transaction_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    payer_tax_id: Mapped[str | None] = mapped_column(String(13))
    payee_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("parties.id"))
    payee_name: Mapped[str] = mapped_column(String(300), nullable=False)
    payee_tax_id: Mapped[str | None] = mapped_column(String(13))
    income_type: Mapped[str | None] = mapped_column(String(100))
    wht_type: Mapped[str] = mapped_column(String(2), nullable=False)
    wht_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    income_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    wht_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    invoice_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("invoices.id"))
    payment_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("payments.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    payee: Mapped["Party | None"] = relationship("Party")  # noqa: F821


class TaxInvoiceRecord(Base):
    __tablename__ = "tax_invoice_records"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    invoice_number: Mapped[str] = mapped_column(String(50), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    order_numbers: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    source: Mapped[str | None] = mapped_column(String(20))
    copy_type: Mapped[str] = mapped_column(String(20), nullable=False, default="customer")

    customer_name: Mapped[str] = mapped_column(String(300), nullable=False)
    customer_address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    customer_tax_id: Mapped[str | None] = mapped_column(String(20))
    customer_branch: Mapped[str | None] = mapped_column(String(50))
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False, default="transfer")
    credit_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    subtotal: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    taxable_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    vat_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=7)
    vat_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text)

    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lines: Mapped[list["TaxInvoiceRecordLine"]] = relationship(
        "TaxInvoiceRecordLine",
        back_populates="tax_invoice",
        cascade="all, delete-orphan",
        order_by="TaxInvoiceRecordLine.line_number",
    )

    __table_args__ = (
        CheckConstraint(
            "copy_type IN ('customer', 'company', 'accounting', 'all')",
            name="chk_tax_invoice_record_copy_type",
        ),
        CheckConstraint(
            "payment_method IN ('cash', 'credit', 'transfer', 'other')",
            name="chk_tax_invoice_record_payment_method",
        ),
        UniqueConstraint("company_id", "invoice_number", name="uq_tax_invoice_record_company_number"),
    )


class TaxInvoiceRecordLine(Base):
    __tablename__ = "tax_invoice_record_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tax_invoice_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("tax_invoice_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    line_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    order_number: Mapped[str | None] = mapped_column(String(100))
    product_code: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False, default=1)
    unit: Mapped[str | None] = mapped_column(String(30))
    unit_price: Mapped[float] = mapped_column(Numeric(15, 4), nullable=False, default=0)
    line_total: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0)

    tax_invoice: Mapped["TaxInvoiceRecord"] = relationship("TaxInvoiceRecord", back_populates="lines")

    __table_args__ = (
        UniqueConstraint("tax_invoice_id", "line_number", name="uq_tax_invoice_record_line_number"),
    )
