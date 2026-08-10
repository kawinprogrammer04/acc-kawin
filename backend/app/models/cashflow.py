"""SQLAlchemy ORM models for Cash Flow Module"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import enum

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, Text, func
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB, INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WalletAccountType(str, enum.Enum):
    bank = "bank"
    cash = "cash"
    ewallet = "ewallet"
    credit_card = "credit_card"
    other = "other"


class MoneyOwnerType(str, enum.Enum):
    company = "company"
    personal = "personal"
    mixed = "mixed"


class HolderType(str, enum.Enum):
    company = "company"
    personal = "personal"
    tax = "tax"
    salary = "salary"
    project = "project"
    reserve = "reserve"
    stock = "stock"
    other = "other"


class CashflowCategoryType(str, enum.Enum):
    income = "income"
    expense = "expense"
    payable = "payable"
    receivable = "receivable"


class EntryStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    cancelled = "cancelled"


class PayableStatus(str, enum.Enum):
    unpaid = "unpaid"
    partial = "partial"
    paid = "paid"
    overdue = "overdue"
    cancelled = "cancelled"


class ReceivableStatus(str, enum.Enum):
    unreceived = "unreceived"
    partial = "partial"
    received = "received"
    overdue = "overdue"
    cancelled = "cancelled"


class TransferType(str, enum.Enum):
    account_to_account = "account_to_account"
    holder_to_holder = "holder_to_holder"
    account_to_holder = "account_to_holder"
    holder_to_account = "holder_to_account"
    owner_withdrawal = "owner_withdrawal"
    owner_advance = "owner_advance"
    salary = "salary"
    dividend = "dividend"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class CashDirection(str, enum.Enum):
    IN = "in"
    OUT = "out"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"


def enum_values(enum_class):
    """Persist the enum's public values, not Python member names.

    This matters for CashDirection, whose Python names are upper-case while the
    existing PostgreSQL enum values are lower-case.
    """
    return [member.value for member in enum_class]


# ─── WalletAccount ────────────────────────────────────────────
class WalletAccount(Base):
    __tablename__ = "wallet_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    account_type: Mapped[WalletAccountType] = mapped_column(
        Enum(WalletAccountType, name="wallet_account_type", create_type=False, values_callable=enum_values), default=WalletAccountType.bank
    )
    owner_type: Mapped[MoneyOwnerType] = mapped_column(
        Enum(MoneyOwnerType, name="money_owner_type", create_type=False, values_callable=enum_values), default=MoneyOwnerType.company
    )
    bank_name: Mapped[Optional[str]] = mapped_column(String(100))
    account_number: Mapped[Optional[str]] = mapped_column(String(50))
    account_holder: Mapped[Optional[str]] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(3), default="THB")
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    current_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Holder ───────────────────────────────────────────────────
class Holder(Base):
    __tablename__ = "holders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    holder_type: Mapped[HolderType] = mapped_column(
        Enum(HolderType, name="holder_type", create_type=False, values_callable=enum_values), default=HolderType.company
    )
    owner_type: Mapped[MoneyOwnerType] = mapped_column(
        Enum(MoneyOwnerType, name="money_owner_type", create_type=False, values_callable=enum_values), default=MoneyOwnerType.company
    )
    wallet_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    purpose: Mapped[Optional[str]] = mapped_column(Text)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    current_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    responsible_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── CashflowCategory ─────────────────────────────────────────
class CashflowCategory(Base):
    __tablename__ = "cashflow_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[CashflowCategoryType] = mapped_column(
        Enum(CashflowCategoryType, name="cashflow_category_type", create_type=False, values_callable=enum_values)
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cashflow_categories.id"))
    color: Mapped[Optional[str]] = mapped_column(String(7))
    icon: Mapped[Optional[str]] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── IncomeEntry ──────────────────────────────────────────────
class IncomeEntry(Base):
    __tablename__ = "income_entries"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    income_date: Mapped[date] = mapped_column(Date, nullable=False)
    document_no: Mapped[Optional[str]] = mapped_column(String(50))
    income_type: Mapped[Optional[str]] = mapped_column(String(50))
    category_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cashflow_categories.id"))
    customer_name: Mapped[Optional[str]] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    withholding_tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    payment_channel: Mapped[Optional[str]] = mapped_column(String(100))
    wallet_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    status: Mapped[EntryStatus] = mapped_column(
        Enum(EntryStatus, name="entry_status", create_type=False, values_callable=enum_values), default=EntryStatus.pending
    )
    received_date: Mapped[Optional[date]] = mapped_column(Date)
    owner_type: Mapped[MoneyOwnerType] = mapped_column(
        Enum(MoneyOwnerType, name="money_owner_type", create_type=False, values_callable=enum_values), default=MoneyOwnerType.company
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    receivable_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ExpenseEntry ─────────────────────────────────────────────
class ExpenseEntry(Base):
    __tablename__ = "expense_entries"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    document_no: Mapped[Optional[str]] = mapped_column(String(50))
    expense_type: Mapped[Optional[str]] = mapped_column(String(50))
    category_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cashflow_categories.id"))
    vendor_name: Mapped[Optional[str]] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    withholding_tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    payment_channel: Mapped[Optional[str]] = mapped_column(String(100))
    wallet_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    is_company_expense: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[EntryStatus] = mapped_column(
        Enum(EntryStatus, name="entry_status", create_type=False, values_callable=enum_values), default=EntryStatus.pending
    )
    paid_date: Mapped[Optional[date]] = mapped_column(Date)
    owner_type: Mapped[MoneyOwnerType] = mapped_column(
        Enum(MoneyOwnerType, name="money_owner_type", create_type=False, values_callable=enum_values), default=MoneyOwnerType.company
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    payable_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Payable ──────────────────────────────────────────────────
class Payable(Base):
    __tablename__ = "payables"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    creditor_name: Mapped[str] = mapped_column(String(300), nullable=False)
    creditor_type: Mapped[Optional[str]] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[Optional[date]] = mapped_column(Date)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    expected_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    expected_holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    category_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cashflow_categories.id"))
    status: Mapped[PayableStatus] = mapped_column(
        Enum(PayableStatus, name="payable_status", create_type=False, values_callable=enum_values), default=PayableStatus.unpaid
    )
    reference_doc: Mapped[Optional[str]] = mapped_column(String(200))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def remaining_amount(self) -> Decimal:
        return self.total_amount - self.paid_amount


# ─── Receivable ───────────────────────────────────────────────
class Receivable(Base):
    __tablename__ = "receivables"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    debtor_name: Mapped[str] = mapped_column(String(300), nullable=False)
    debtor_type: Mapped[Optional[str]] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[Optional[date]] = mapped_column(Date)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    received_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    expected_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    expected_holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    category_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cashflow_categories.id"))
    status: Mapped[ReceivableStatus] = mapped_column(
        Enum(ReceivableStatus, name="receivable_status", create_type=False, values_callable=enum_values), default=ReceivableStatus.unreceived
    )
    reference_doc: Mapped[Optional[str]] = mapped_column(String(200))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def remaining_amount(self) -> Decimal:
        return self.total_amount - self.received_amount


# ─── Transfer ─────────────────────────────────────────────────
class Transfer(Base):
    __tablename__ = "transfers"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    transfer_date: Mapped[date] = mapped_column(Date, nullable=False)
    transfer_type: Mapped[TransferType] = mapped_column(
        Enum(TransferType, name="transfer_type", create_type=False, values_callable=enum_values), default=TransferType.account_to_account
    )
    from_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    from_holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    to_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    to_holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[EntryStatus] = mapped_column(
        Enum(EntryStatus, name="entry_status", create_type=False, values_callable=enum_values), default=EntryStatus.completed
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Document ─────────────────────────────────────────────────
class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    reference_type: Mapped[str] = mapped_column(String(50), nullable=False)
    reference_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_type: Mapped[Optional[str]] = mapped_column(String(50))
    file_size: Mapped[Optional[int]] = mapped_column(Integer)
    doc_type: Mapped[Optional[str]] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(String(500))
    uploaded_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── CashTransaction ──────────────────────────────────────────
class CashTransaction(Base):
    __tablename__ = "cash_transactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    direction: Mapped[CashDirection] = mapped_column(
        Enum(CashDirection, name="cash_direction", create_type=False, values_callable=enum_values)
    )
    reference_type: Mapped[str] = mapped_column(String(50), nullable=False)
    reference_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False))
    wallet_account_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("wallet_accounts.id"))
    holder_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("holders.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    balance_after: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2))
    description: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ActivityLog ──────────────────────────────────────────────
class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[Optional[str]] = mapped_column(String(100))
    old_data: Mapped[Optional[dict]] = mapped_column(JSONB)
    new_data: Mapped[Optional[dict]] = mapped_column(JSONB)
    description: Mapped[Optional[str]] = mapped_column(Text)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, default=1)
    ip_address = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
