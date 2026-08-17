"""Finance-domain records attached to expense requests.

Payments stay intentionally isolated from journals/cash-flow entries.  Every
record carries company_id so PostgreSQL RLS can enforce tenant boundaries.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    manager_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseAttachmentRequirement(Base):
    __tablename__ = "expense_attachment_requirements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    expense_type_id: Mapped[int] = mapped_column(Integer, ForeignKey("expense_types.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    requires_signature: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allowed_mime_types: Mapped[list] = mapped_column(JSONB, nullable=False)
    max_file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    default_signature_page: Mapped[Optional[int]] = mapped_column(Integer)
    default_signature_x: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 6))
    default_signature_y: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 6))
    default_signature_width: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 6))
    default_signature_height: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 6))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseApprovalCandidate(Base):
    __tablename__ = "expense_approval_candidates"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    request_step_id: Mapped[int] = mapped_column(Integer, ForeignKey("approval_request_steps.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False, default="position")
    source_id: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseSignaturePlacement(Base):
    __tablename__ = "expense_signature_placements"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    expense_request_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_requests.id"), nullable=False)
    attachment_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_request_attachments.id"))
    request_step_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("approval_request_steps.id"))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    x: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    y: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    width: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    height: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    page_rotation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    signed_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    signature_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    document_sha256: Mapped[Optional[str]] = mapped_column(String(64))


class ExpensePayment(Base):
    __tablename__ = "expense_payments"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    expense_request_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_requests.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payment_type: Mapped[str] = mapped_column(String(30), nullable=False, default="full")
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    method: Mapped[Optional[str]] = mapped_column(String(50))
    reference_no: Mapped[Optional[str]] = mapped_column(String(150))
    note: Mapped[Optional[str]] = mapped_column(Text)
    proof_file_name: Mapped[Optional[str]] = mapped_column(String(255))
    proof_file_path: Mapped[Optional[str]] = mapped_column(Text)
    proof_sha256: Mapped[Optional[str]] = mapped_column(String(64))
    recorded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    voided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    void_reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseSettlement(Base):
    __tablename__ = "expense_settlements"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    expense_request_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_requests.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    advance_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    actual_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    difference_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    settlement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="submitted")
    note: Mapped[Optional[str]] = mapped_column(Text)
    refund_proof_path: Mapped[Optional[str]] = mapped_column(Text)
    refund_proof_sha256: Mapped[Optional[str]] = mapped_column(String(64))
    submitted_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    review_comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseSettlementItem(Base):
    __tablename__ = "expense_settlement_items"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    settlement_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_settlements.id"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="รายการ")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(25, 10), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseWithholdingTaxCertificate(Base):
    __tablename__ = "expense_withholding_tax_certificates"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    expense_request_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_requests.id"), nullable=False)
    payment_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_payments.id"))
    certificate_no: Mapped[str] = mapped_column(String(50), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    base_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    issued_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseRequestHistory(Base):
    __tablename__ = "expense_request_histories"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    expense_request_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_requests.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    event: Mapped[str] = mapped_column(String(60), nullable=False)
    from_status: Mapped[Optional[str]] = mapped_column(String(30))
    to_status: Mapped[Optional[str]] = mapped_column(String(30))
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    note: Mapped[Optional[str]] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    ip_address: Mapped[Optional[str]] = mapped_column(INET)
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SystemNotification(Base):
    __tablename__ = "system_notifications"
    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4())
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    expense_request_id: Mapped[Optional[str]] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("expense_requests.id"))
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    action_url: Mapped[Optional[str]] = mapped_column(Text)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(180))
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
