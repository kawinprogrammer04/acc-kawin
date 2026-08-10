"""Persistent bank statement imports and reconciliation audit records."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BankStatementImport(Base):
    __tablename__ = "bank_statement_imports"

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    wallet_account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("wallet_accounts.id"), nullable=False
    )
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String(150))
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    date_from: Mapped[Optional[date]] = mapped_column(Date)
    date_to: Mapped[Optional[date]] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="processed")
    source_type: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    trust_level: Mapped[str] = mapped_column(String(30), nullable=False, default="unverified")
    processing_method: Mapped[Optional[str]] = mapped_column(String(30))
    parse_message: Mapped[Optional[str]] = mapped_column(Text)
    uploaded_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    archived_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BankStatementLine(Base):
    __tablename__ = "bank_statement_lines"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    import_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("bank_statement_imports.id", ondelete="CASCADE"),
        nullable=False,
    )
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    wallet_account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("wallet_accounts.id"), nullable=False
    )
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    transaction_time: Mapped[Optional[str]] = mapped_column(String(8))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    reference: Mapped[Optional[str]] = mapped_column(String(200))
    channel: Mapped[Optional[str]] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    row_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="unmatched")
    suggested_cash_transaction_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("cash_transactions.id", ondelete="SET NULL")
    )
    suggested_cash_transaction_ids: Mapped[Optional[list[int]]] = mapped_column(JSONB)
    suggested_score: Mapped[Optional[int]] = mapped_column(Integer)
    suggestion_dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reconciled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BankReconciliation(Base):
    __tablename__ = "bank_reconciliations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    wallet_account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("wallet_accounts.id"), nullable=False
    )
    statement_line_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("bank_statement_lines.id"), nullable=False
    )
    cash_transaction_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("cash_transactions.id"), nullable=False
    )
    group_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    match_score: Mapped[Optional[int]] = mapped_column(Integer)
    match_method: Mapped[str] = mapped_column(String(30), nullable=False, default="automatic")
    matched_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    matched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    cancelled_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
