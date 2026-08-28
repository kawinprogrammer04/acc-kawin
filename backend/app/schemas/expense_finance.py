from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class DepartmentIn(BaseModel):
    code: Optional[str] = Field(default=None, max_length=50)
    name: str = Field(min_length=1, max_length=180)
    manager_user_id: Optional[int] = None
    is_active: bool = True


class DepartmentOut(DepartmentIn):
    id: int
    model_config = {"from_attributes": True}


class AttachmentRequirementIn(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    is_required: bool = True
    requires_signature: bool = False
    allowed_mime_types: list[str] = ["application/pdf", "image/jpeg", "image/png"]
    max_file_size: int = Field(default=10 * 1024 * 1024, gt=0, le=10 * 1024 * 1024)
    sort_order: int = 0
    is_active: bool = True

    @model_validator(mode="after")
    def validate_signable_document(self):
        if not self.allowed_mime_types:
            raise ValueError("กรุณาเลือกชนิดไฟล์อย่างน้อย 1 ชนิด")
        if self.requires_signature and "application/pdf" not in self.allowed_mime_types:
            raise ValueError("เอกสารที่ต้องลงลายเซ็นต้องอนุญาตไฟล์ PDF")
        return self


class AttachmentRequirementOut(AttachmentRequirementIn):
    id: int
    expense_type_id: int
    default_signature_page: Optional[int] = None
    default_signature_x: Optional[Decimal] = None
    default_signature_y: Optional[Decimal] = None
    default_signature_width: Optional[Decimal] = None
    default_signature_height: Optional[Decimal] = None
    model_config = {"from_attributes": True}


class PaymentIn(BaseModel):
    amount: Decimal = Field(gt=0)
    paid_at: datetime
    method: Optional[str] = Field(default=None, max_length=50)
    reference_no: Optional[str] = Field(default=None, max_length=150)
    note: Optional[str] = None
    idempotency_key: str = Field(min_length=8, max_length=120)
    proof_file_name: Optional[str] = None
    proof_content_base64: Optional[str] = None


class PaymentOut(BaseModel):
    id: str
    expense_request_id: str
    revision: int
    payment_type: str
    amount: Decimal
    paid_at: datetime
    method: Optional[str]
    reference_no: Optional[str]
    note: Optional[str]
    proof_file_name: Optional[str]
    proof_sha256: Optional[str]
    voided_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


class WithholdingCertificateOut(BaseModel):
    id: str
    expense_request_id: str
    payment_id: Optional[str]
    certificate_no: str
    tax_rate: Decimal
    base_amount: Decimal
    tax_amount: Decimal
    issued_at: datetime
    model_config = {"from_attributes": True}


class PaymentProofReplaceIn(BaseModel):
    proof_file_name: str = Field(min_length=1, max_length=255)
    proof_content_base64: str = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=2000)


class PaymentVoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class AccountingReturnIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class AccountingCancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class SettlementItemIn(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(default="รายการ", min_length=1, max_length=50)
    unit_price: Decimal = Field(ge=0)


class SettlementIn(BaseModel):
    actual_amount: Decimal = Field(ge=0)
    note: Optional[str] = None
    items: list[SettlementItemIn] = Field(min_length=1)
    refund_proof_file_name: Optional[str] = None
    refund_proof_content_base64: Optional[str] = None

    @model_validator(mode="after")
    def amount_matches_items(self):
        total = sum((item.quantity * item.unit_price for item in self.items), Decimal("0"))
        if abs(total - self.actual_amount) > Decimal("0.01"):
            raise ValueError("ยอดใช้จริงต้องตรงกับผลรวมรายการเคลียร์เงิน")
        return self


class SettlementReviewIn(BaseModel):
    action: Literal["approve", "return"]
    comment: Optional[str] = None


class SettlementOut(BaseModel):
    id: str
    expense_request_id: str
    revision: int
    advance_amount: Decimal
    actual_amount: Decimal
    difference_amount: Decimal
    settlement_type: str
    status: str
    note: Optional[str]
    submitted_at: datetime
    reviewed_at: Optional[datetime]
    review_comment: Optional[str]
    model_config = {"from_attributes": True}


class HistoryOut(BaseModel):
    id: int
    revision: int
    event: str
    from_status: Optional[str]
    to_status: Optional[str]
    actor_user_id: Optional[int]
    note: Optional[str]
    snapshot: dict
    created_at: datetime
    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    message: str
    action_url: Optional[str]
    read_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


class FinanceSummaryOut(BaseModel):
    gross: Decimal
    vat: Decimal
    withholding: Decimal
    net: Decimal
    paid: Decimal
    remaining: Decimal


class AccountingStatsOut(BaseModel):
    pending_approval_count: int = 0
    accounting_review_count: int
    ready_to_pay_count: int
    settlement_review_count: int
    overdue_count: int
    ready_to_pay_amount: Decimal
    partially_paid_count: int = 0
    transfer_amount_total: Decimal = Decimal("0")
