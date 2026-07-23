from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VatRecord(Base):
    __tablename__ = "vat_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
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
    )


class WhtRecord(Base):
    __tablename__ = "wht_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
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
