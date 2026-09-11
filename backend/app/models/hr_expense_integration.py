"""Read models and delivery state for the HR-owned expense integration."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class HrExpenseRequestProjection(Base):
    __tablename__ = "hr_expense_request_projections"

    integration_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    hr_request_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    company_code: Mapped[str] = mapped_column(String(80), nullable=False)
    request_no: Mapped[str] = mapped_column(String(30), nullable=False)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    allowed_actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    department_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("departments.id", ondelete="SET NULL"))
    department_name: Mapped[Optional[str]] = mapped_column(String(180))
    expense_type_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("expense_types.id", ondelete="SET NULL"))
    expense_type_name: Mapped[Optional[str]] = mapped_column(String(180))
    request_kind: Mapped[Optional[str]] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    requester_name: Mapped[Optional[str]] = mapped_column(String(300))
    recipient_name: Mapped[Optional[str]] = mapped_column(String(300))
    bank_name: Mapped[Optional[str]] = mapped_column(String(150))
    bank_account_name: Mapped[Optional[str]] = mapped_column(String(300))
    bank_account_number_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    bank_account_last4: Mapped[Optional[str]] = mapped_column(String(4))
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    source_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    withholding_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    remaining_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    withholding_related: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    last_event_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class HrExpenseIntegrationState(Base):
    __tablename__ = "hr_expense_integration_states"

    provider: Mapped[str] = mapped_column(String(30), primary_key=True, default="hr")
    last_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class HrExpenseIntegrationEvent(Base):
    __tablename__ = "hr_expense_integration_events"

    event_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    aggregate_integration_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False)
    aggregate_version: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
