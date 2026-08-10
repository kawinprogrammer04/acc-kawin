from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


# ── Position ─────────────────────────────────────────────────────────────────
class PositionCreate(BaseModel):
    name: str
    is_active: bool = True


class PositionUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class PositionOut(BaseModel):
    id: int
    name: str
    is_active: bool
    model_config = {"from_attributes": True}


# ── UserPosition ─────────────────────────────────────────────────────────────
class UserPositionCreate(BaseModel):
    user_id: int
    position_id: int


class UserPositionOut(BaseModel):
    id: int
    user_id: int
    position_id: int
    position_name: Optional[str] = None
    user_full_name: Optional[str] = None
    is_active: bool
    model_config = {"from_attributes": True}


# ── ExpenseType ──────────────────────────────────────────────────────────────
class ExpenseTypeCreate(BaseModel):
    code: str
    name: str
    is_active: bool = True


class ExpenseTypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class ExpenseTypeOut(BaseModel):
    id: int
    code: str
    name: str
    is_active: bool
    model_config = {"from_attributes": True}


# ── Policy version ───────────────────────────────────────────────────────────
class PolicyVersionCreate(BaseModel):
    notes: Optional[str] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class PolicyVersionOut(BaseModel):
    id: int
    version_no: int
    status: str
    effective_from: Optional[date]
    effective_to: Optional[date]
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Rule + steps ──────────────────────────────────────────────────────────────
class RuleStepIn(BaseModel):
    step_no: int = Field(gt=0)
    approver_position_id: int


class RuleCreate(BaseModel):
    requester_position_id: int
    expense_type_id: int
    amount_min: Decimal = Field(ge=0)
    amount_max: Optional[Decimal] = None  # None = unbounded above
    steps: list[RuleStepIn] = Field(min_length=1)


class RuleStepOut(BaseModel):
    step_no: int
    approver_position_id: int
    approver_position_name: Optional[str] = None


class RuleOut(BaseModel):
    id: int
    requester_position_id: int
    requester_position_name: Optional[str] = None
    expense_type_id: int
    expense_type_name: Optional[str] = None
    amount_min: Decimal
    amount_max: Optional[Decimal]
    steps: list[RuleStepOut] = []


# ── Primary approvers & delegations ──────────────────────────────────────────
class PrimaryApproverSet(BaseModel):
    position_id: int
    user_id: int


class PrimaryApproverOut(BaseModel):
    id: int
    position_id: int
    position_name: Optional[str] = None
    user_id: int
    user_full_name: Optional[str] = None
    is_active: bool
    model_config = {"from_attributes": True}


class DelegationCreate(BaseModel):
    position_id: int
    delegate_user_id: int
    starts_at: datetime
    ends_at: datetime
    reason: Optional[str] = None


class DelegationOut(BaseModel):
    id: int
    position_id: int
    position_name: Optional[str] = None
    delegate_user_id: int
    delegate_full_name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    reason: Optional[str]
    model_config = {"from_attributes": True}


# ── Route preview ────────────────────────────────────────────────────────────
class RoutePreviewStep(BaseModel):
    step_no: int
    approver_position_id: int
    approver_position_name: str
    resolved_approver_user_id: Optional[int] = None
    resolved_approver_name: Optional[str] = None
    warning: Optional[str] = None


class RoutePreviewOut(BaseModel):
    matched: bool
    message: Optional[str] = None
    rule_id: Optional[int] = None
    steps: list[RoutePreviewStep] = []


# ── Expense requests ──────────────────────────────────────────────────────────
class ExpenseRequestCreate(BaseModel):
    requester_position_id: int
    expense_type_id: int
    amount: Decimal = Field(default=Decimal("0"), ge=0)
    title: str
    description: Optional[str] = None
    request_date: date
    request_format: str = Field(default="reimbursement", pattern="^(reimbursement|advance|direct_payment)$")
    payer_company_name: Optional[str] = None
    recipient_type: Optional[str] = Field(default=None, pattern="^(employee|individual|company)?$")
    recipient_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None


class ExpenseRequestItemIn(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(default="รายการ", min_length=1, max_length=50)
    unit_price: Decimal = Field(ge=0)


class ExpenseRequestItemOut(ExpenseRequestItemIn):
    id: int
    sort_order: int
    line_total: Decimal


class ExpenseRequestAttachmentOut(BaseModel):
    id: str
    attachment_type: str
    file_name: str
    content_type: Optional[str]
    file_size: int
    created_at: datetime


class ExpenseRequestDraftUpdate(BaseModel):
    requester_position_id: Optional[int] = None
    expense_type_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    request_date: Optional[date] = None
    request_format: Optional[str] = Field(default=None, pattern="^(reimbursement|advance|direct_payment)$")
    payer_company_name: Optional[str] = None
    recipient_type: Optional[str] = Field(default=None, pattern="^(employee|individual|company)?$")
    recipient_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    items: Optional[list[ExpenseRequestItemIn]] = None
    vat_mode: Optional[str] = Field(default=None, pattern="^(none|rate|amount)$")
    vat_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    vat_amount: Optional[Decimal] = Field(default=None, ge=0)
    withholding_required: Optional[bool] = None
    withholding_mode: Optional[str] = Field(default=None, pattern="^(none|rate|amount)$")
    withholding_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    withholding_amount: Optional[Decimal] = Field(default=None, ge=0)
    taxpayer_name: Optional[str] = None
    taxpayer_id: Optional[str] = None
    taxpayer_address: Optional[str] = None


class ExpenseRequestOut(BaseModel):
    id: str
    request_no: Optional[str] = None
    requester_user_id: int
    requester_name: Optional[str] = None
    requester_position_id: int
    requester_position_name: Optional[str] = None
    expense_type_id: int
    expense_type_name: Optional[str] = None
    amount: Decimal
    title: str
    description: Optional[str]
    request_date: date
    request_format: str = "reimbursement"
    payer_company_name: Optional[str] = None
    recipient_type: Optional[str] = None
    recipient_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_account_masked: Optional[str] = None
    subtotal: Decimal = Decimal("0")
    vat_mode: str = "none"
    vat_rate: Decimal = Decimal("0")
    vat_amount: Decimal = Decimal("0")
    withholding_required: bool = False
    withholding_mode: str = "none"
    withholding_rate: Decimal = Decimal("0")
    withholding_amount: Decimal = Decimal("0")
    payable_total: Decimal = Decimal("0")
    taxpayer_name: Optional[str] = None
    taxpayer_id: Optional[str] = None
    taxpayer_address: Optional[str] = None
    status: str
    current_step_no: Optional[int]
    submitted_at: Optional[datetime]
    decided_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


class ApprovalStepTimelineOut(BaseModel):
    id: int
    step_no: int
    approver_position_id: int
    approver_position_name: Optional[str] = None
    resolved_approver_user_id: Optional[int]
    resolved_approver_name: Optional[str] = None
    status: str
    comment: Optional[str]
    decided_by: Optional[int]
    decided_at: Optional[datetime]
    model_config = {"from_attributes": True}


class ExpenseRequestDetailOut(ExpenseRequestOut):
    items: list[ExpenseRequestItemOut] = []
    attachments: list[ExpenseRequestAttachmentOut] = []
    steps: list[ApprovalStepTimelineOut] = []


class InboxItemOut(BaseModel):
    step_id: int
    step_no: int
    expense_request_id: str
    title: str
    amount: Decimal
    requester_user_id: int
    requester_name: Optional[str] = None
    requester_position_name: Optional[str] = None
    expense_type_name: Optional[str] = None
    request_date: date
    submitted_at: Optional[datetime]


class DecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    comment: Optional[str] = None
    idempotency_key: str
