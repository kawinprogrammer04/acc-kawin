"""SQLAlchemy ORM models for the position-based expense approval workflow."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, ForeignKey,
    Integer, Numeric, SmallInteger, String, Text, func, text
)
from sqlalchemy.dialects.postgresql import INET, JSONB, NUMRANGE
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


# ─── Position ─────────────────────────────────────────────────
class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    department_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("departments.id"))
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── UserPosition ─────────────────────────────────────────────
class UserPosition(Base):
    __tablename__ = "user_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ExpenseType ──────────────────────────────────────────────
class ExpenseType(Base):
    __tablename__ = "expense_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    allowed_kinds: Mapped[list] = mapped_column(JSONB, default=lambda: ["reimbursement", "advance", "direct_payment"])
    requires_payment_proof: Mapped[bool] = mapped_column(Boolean, default=True)
    may_require_withholding_tax: Mapped[bool] = mapped_column(Boolean, default=True)
    settlement_days: Mapped[int] = mapped_column(Integer, default=7)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ApprovalPolicyVersion ────────────────────────────────────
class ApprovalPolicyVersion(Base):
    __tablename__ = "approval_policy_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    effective_from: Mapped[Optional[date]] = mapped_column(Date)
    effective_to: Mapped[Optional[date]] = mapped_column(Date)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ApprovalRule ─────────────────────────────────────────────
class ApprovalRule(Base):
    __tablename__ = "approval_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    policy_version_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("approval_policy_versions.id"), nullable=False
    )
    requester_position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    expense_type_id: Mapped[int] = mapped_column(Integer, ForeignKey("expense_types.id"), nullable=False)
    amount_range = mapped_column(NUMRANGE, nullable=False)
    source_system: Mapped[Optional[str]] = mapped_column(String(20))
    source_policy_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    source_policy_name: Mapped[Optional[str]] = mapped_column(String(255))
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    specificity: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=3)
    request_kind: Mapped[Optional[str]] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ApprovalRuleStep ─────────────────────────────────────────
class ApprovalRuleStep(Base):
    __tablename__ = "approval_rule_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    approval_rule_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("approval_rules.id", ondelete="CASCADE"), nullable=False
    )
    step_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    approver_position_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("positions.id"))
    name: Mapped[Optional[str]] = mapped_column(String(180))
    approve_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="any")
    target_type: Mapped[str] = mapped_column(String(30), nullable=False, default="position")
    target_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))


# ─── PositionPrimaryApprover ──────────────────────────────────
class PositionPrimaryApprover(Base):
    __tablename__ = "position_primary_approvers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ApprovalDelegation ───────────────────────────────────────
class ApprovalDelegation(Base):
    __tablename__ = "approval_delegations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    delegate_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ExpenseRequest ───────────────────────────────────────────
class ExpenseRequest(Base):
    __tablename__ = "expense_requests"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    request_no: Mapped[Optional[str]] = mapped_column(
        String(30), unique=True,
        server_default=text("'EXP-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || lpad(nextval('expense_request_no_seq')::text, 6, '0')"),
    )
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    department_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("departments.id"))
    company_name_snapshot: Mapped[Optional[str]] = mapped_column(String(300))
    department_name_snapshot: Mapped[Optional[str]] = mapped_column(String(180))
    requester_name_snapshot: Mapped[Optional[str]] = mapped_column(String(300))
    requester_position_snapshot: Mapped[Optional[str]] = mapped_column(String(180))
    requester_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    requester_position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    expense_type_id: Mapped[int] = mapped_column(Integer, ForeignKey("expense_types.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    required_date: Mapped[Optional[date]] = mapped_column(Date)
    request_format: Mapped[str] = mapped_column(String(30), nullable=False, default="reimbursement")
    payer_company_name: Mapped[Optional[str]] = mapped_column(String(200))
    recipient_type: Mapped[Optional[str]] = mapped_column(String(30))
    recipient_name: Mapped[Optional[str]] = mapped_column(String(300))
    bank_name: Mapped[Optional[str]] = mapped_column(String(150))
    bank_account_name: Mapped[Optional[str]] = mapped_column(String(300))
    bank_account_number_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    bank_account_last4: Mapped[Optional[str]] = mapped_column(String(4))
    recipient_tax_id_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    recipient_tax_id_last4: Mapped[Optional[str]] = mapped_column(String(4))
    recipient_address: Mapped[Optional[str]] = mapped_column(Text)
    service_description: Mapped[Optional[str]] = mapped_column(Text)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    subtotal_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    price_before_vat: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    remaining_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    price_mode: Mapped[str] = mapped_column(String(30), nullable=False, default="exclude_vat")
    vat_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    withholding_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    withholding_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    withholding_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    withholding_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=0)
    requester_withholding_status: Mapped[str] = mapped_column(String(30), nullable=False, default="not_required")
    withholding_decision: Mapped[Optional[str]] = mapped_column(String(30))
    gross_up_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    gross_up_base_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2))
    installment_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    installment_chain_root_id: Mapped[Optional[str]] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("expense_requests.id")
    )
    installment_no: Mapped[Optional[int]] = mapped_column(SmallInteger)
    installment_target_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2))
    installment_payment_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2))
    installment_chain_status: Mapped[Optional[str]] = mapped_column(String(30))
    requested_net_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2))
    taxpayer_name: Mapped[Optional[str]] = mapped_column(String(300))
    taxpayer_type: Mapped[Optional[str]] = mapped_column(String(20))
    taxpayer_branch: Mapped[Optional[str]] = mapped_column(String(255))
    taxpayer_id: Mapped[Optional[str]] = mapped_column(String(20))
    taxpayer_address: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    policy_version_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("approval_policy_versions.id"))
    approval_rule_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("approval_rules.id"))
    current_step_no: Mapped[Optional[int]] = mapped_column(SmallInteger)
    request_pdf_path: Mapped[Optional[str]] = mapped_column(Text)
    request_pdf_sha256: Mapped[Optional[str]] = mapped_column(String(64))
    signed_pdf_path: Mapped[Optional[str]] = mapped_column(Text)
    signed_pdf_sha256: Mapped[Optional[str]] = mapped_column(String(64))
    linked_expense_entry_id: Mapped[Optional[str]] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("expense_entries.id")
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    settlement_due_date: Mapped[Optional[date]] = mapped_column(Date)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseRequestItem(Base):
    __tablename__ = "expense_request_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    expense_request_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("expense_requests.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="รายการ")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(25, 10), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseRequestAttachment(Base):
    __tablename__ = "expense_request_attachments"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    expense_request_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("expense_requests.id", ondelete="CASCADE"), nullable=False
    )
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    requirement_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("expense_attachment_requirements.id"))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="supporting")
    attachment_type: Mapped[str] = mapped_column(String(30), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String(150))
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[Optional[str]] = mapped_column(String(64))
    requires_signature: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    signed_file_path: Mapped[Optional[str]] = mapped_column(Text)
    signed_sha256: Mapped[Optional[str]] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ApprovalRequestStep ──────────────────────────────────────
class ApprovalRequestStep(Base):
    __tablename__ = "approval_request_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expense_request_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("expense_requests.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[Optional[str]] = mapped_column(String(180))
    approve_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="any")
    step_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    approver_position_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("positions.id"))
    resolved_approver_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting")
    comment: Mapped[Optional[str]] = mapped_column(Text)
    decided_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    activated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── ApprovalAction (append-only audit log) ───────────────────
class ApprovalAction(Base):
    __tablename__ = "approval_actions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    request_step_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("approval_request_steps.id", ondelete="CASCADE"), nullable=False
    )
    actor_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(INET)
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
