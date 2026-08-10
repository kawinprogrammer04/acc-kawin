from datetime import datetime
from uuid import uuid4
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    payment_number: Mapped[str] = mapped_column(String(30), nullable=False)
    payment_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invoice_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("invoices.id"), nullable=False)
    party_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("parties.id"), nullable=False)
    period_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounting_periods.id"), nullable=False)
    # cash | bank_transfer | cheque | credit_card
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    bank_account: Mapped[str | None] = mapped_column(String(100))
    cheque_number: Mapped[str | None] = mapped_column(String(50))
    cheque_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reference: Mapped[str | None] = mapped_column(String(100))
    cash_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), nullable=False)
    journal_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("journals.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    invoice: Mapped["Invoice"] = relationship("Invoice")  # noqa: F821
    party: Mapped["Party"] = relationship("Party")  # noqa: F821
    cash_account: Mapped["Account"] = relationship("Account")  # noqa: F821

    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_payment_positive"),
        UniqueConstraint("company_id", "payment_number", name="uq_payment_company_number"),
    )
