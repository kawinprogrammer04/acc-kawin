from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Position ─────────────────────────────────────────────────────────────────
class PositionCreate(BaseModel):
    name: str
    department_id: Optional[int] = None
    is_active: bool = True


class PositionUpdate(BaseModel):
    name: Optional[str] = None
    department_id: Optional[int] = None
    is_active: Optional[bool] = None


class PositionOut(BaseModel):
    id: int
    name: str
    department_id: Optional[int] = None
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
    description: Optional[str] = None
    allowed_kinds: list[str] = ["reimbursement", "advance", "direct_payment"]
    requires_payment_proof: bool = True
    may_require_withholding_tax: bool = True
    settlement_days: int = Field(default=7, ge=0, le=365)
    is_active: bool = True


class ExpenseTypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    allowed_kinds: Optional[list[str]] = None
    requires_payment_proof: Optional[bool] = None
    may_require_withholding_tax: Optional[bool] = None
    settlement_days: Optional[int] = Field(default=None, ge=0, le=365)
    is_active: Optional[bool] = None


class ExpenseTypeOut(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    allowed_kinds: list[str] = []
    requires_payment_proof: bool = True
    may_require_withholding_tax: bool = True
    settlement_days: int = 7
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
    name: Optional[str] = None
    target_type: str = Field(default="position", pattern="^(direct_supervisor|position|user|hr_position)$")
    target_id: Optional[int] = Field(default=None, gt=0)
    approve_mode: str = Field(default="any", pattern="^(any|all)$")
    # Kept for backwards compatibility with the original ACC matrix editor.
    approver_position_id: Optional[int] = Field(default=None, gt=0)


class RuleCreate(BaseModel):
    requester_position_id: Optional[int] = Field(default=None, gt=0)
    expense_type_id: Optional[int] = Field(default=None, gt=0)
    amount_min: Decimal = Field(ge=0)
    amount_max: Optional[Decimal] = None  # None = unbounded above
    name: Optional[str] = Field(default=None, max_length=255)
    request_kind: Optional[str] = Field(default=None, pattern="^(reimbursement|advance|direct_payment|ot|allowance)?$")
    priority: int = Field(default=100, ge=1, le=999999)
    source_system: Optional[str] = Field(default=None, pattern="^(acc|hr)?$")
    source_policy_id: Optional[int] = None
    logical_group_key: Optional[str] = Field(default=None, max_length=100)
    source_scope: Optional[dict[str, Any]] = None
    steps: list[RuleStepIn] = Field(min_length=1)


class RuleUpdate(BaseModel):
    requester_position_id: Optional[int] = Field(default=None, gt=0)
    expense_type_id: Optional[int] = Field(default=None, gt=0)
    amount_min: Optional[Decimal] = Field(default=None, ge=0)
    amount_max: Optional[Decimal] = None
    name: Optional[str] = Field(default=None, max_length=255)
    request_kind: Optional[str] = Field(default=None, pattern="^(reimbursement|advance|direct_payment|ot|allowance)?$")
    priority: Optional[int] = Field(default=None, ge=1, le=999999)
    is_active: Optional[bool] = None
    source_scope: Optional[dict[str, Any]] = None
    steps: Optional[list[RuleStepIn]] = Field(default=None, min_length=1)


class RuleStepOut(BaseModel):
    step_no: int
    name: Optional[str] = None
    target_type: str = "position"
    target_id: Optional[int] = None
    target_name: Optional[str] = None
    approve_mode: str = "any"
    approver_position_id: Optional[int] = None
    approver_position_name: Optional[str] = None


class RuleOut(BaseModel):
    id: int
    requester_position_id: Optional[int] = None
    requester_position_name: Optional[str] = None
    requester_department_id: Optional[int] = None
    requester_department_name: Optional[str] = None
    expense_type_id: Optional[int] = None
    expense_type_name: Optional[str] = None
    amount_min: Decimal
    amount_max: Optional[Decimal]
    name: Optional[str] = None
    request_kind: Optional[str] = None
    priority: int = 100
    specificity: int = 0
    source_system: Optional[str] = None
    source_policy_id: Optional[int] = None
    logical_group_key: Optional[str] = None
    source_scope: Optional[dict[str, Any]] = None
    is_active: bool = True
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
    approver_position_id: Optional[int] = None
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
    required_date: Optional[date] = None
    department_id: Optional[int] = None
    request_format: str = Field(default="reimbursement", pattern="^(reimbursement|advance|direct_payment)$")
    payer_company_name: Optional[str] = None
    recipient_type: Optional[str] = Field(default=None, pattern="^(employee|individual|company)?$")
    recipient_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    installment_enabled: bool = False


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
    requirement_id: Optional[int] = None
    attachment_type: str
    category: str = "supporting"
    file_name: str
    content_type: Optional[str]
    file_size: int
    requires_signature: bool = False
    has_signed_file: bool = False
    default_signature_page: Optional[int] = None
    default_signature_x: Optional[Decimal] = None
    default_signature_y: Optional[Decimal] = None
    default_signature_width: Optional[Decimal] = None
    default_signature_height: Optional[Decimal] = None
    created_at: datetime


class ExpenseRequestDraftUpdate(BaseModel):
    version: Optional[int] = Field(default=None, ge=1)
    requester_position_id: Optional[int] = None
    expense_type_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    request_date: Optional[date] = None
    required_date: Optional[date] = None
    department_id: Optional[int] = None
    request_format: Optional[str] = Field(default=None, pattern="^(reimbursement|advance|direct_payment)$")
    payer_company_name: Optional[str] = None
    recipient_type: Optional[str] = Field(default=None, pattern="^(employee|individual|company)?$")
    recipient_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    installment_enabled: Optional[bool] = None
    installment_payment_amount: Optional[Decimal] = Field(default=None, ge=0)
    recipient_tax_id: Optional[str] = None
    recipient_address: Optional[str] = None
    service_description: Optional[str] = None
    items: Optional[list[ExpenseRequestItemIn]] = None
    discount_amount: Optional[Decimal] = Field(default=None, ge=0)
    price_mode: Optional[str] = Field(default=None, pattern="^(exclude_vat|include_vat)$")
    vat_mode: Optional[str] = Field(default=None, pattern="^(none|rate|amount)$")
    vat_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    vat_amount: Optional[Decimal] = Field(default=None, ge=0)
    withholding_required: Optional[bool] = None
    withholding_mode: Optional[str] = Field(default=None, pattern="^(none|rate|amount)$")
    withholding_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    withholding_amount: Optional[Decimal] = Field(default=None, ge=0)
    requester_withholding_status: Optional[str] = Field(default=None, pattern="^(not_required|required|accounting_decide|not_withheld|deduct|already_withheld)$")
    gross_up_enabled: Optional[bool] = None
    requested_net_amount: Optional[Decimal] = Field(default=None, ge=0)
    taxpayer_name: Optional[str] = None
    taxpayer_type: Optional[str] = Field(default=None, pattern="^(individual|juristic)?$")
    taxpayer_branch: Optional[str] = None
    taxpayer_id: Optional[str] = None
    taxpayer_address: Optional[str] = None


class ExpenseRequestOut(BaseModel):
    id: str
    request_no: Optional[str] = None
    version: int = 1
    current_revision: int = 1
    requester_user_id: int
    requester_name: Optional[str] = None
    requester_position_id: int
    requester_position_name: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    expense_type_id: int
    expense_type_name: Optional[str] = None
    amount: Decimal
    title: str
    description: Optional[str]
    request_date: date
    required_date: Optional[date] = None
    request_format: str = "reimbursement"
    payer_company_name: Optional[str] = None
    recipient_type: Optional[str] = None
    recipient_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_account_masked: Optional[str] = None
    recipient_address: Optional[str] = None
    service_description: Optional[str] = None
    subtotal: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    price_before_vat: Decimal = Decimal("0")
    price_mode: str = "exclude_vat"
    vat_mode: str = "none"
    vat_rate: Decimal = Decimal("0")
    vat_amount: Decimal = Decimal("0")
    withholding_required: bool = False
    withholding_mode: str = "none"
    withholding_rate: Decimal = Decimal("0")
    withholding_amount: Decimal = Decimal("0")
    payable_total: Decimal = Decimal("0")
    gross: Decimal = Decimal("0")
    net: Decimal = Decimal("0")
    paid: Decimal = Decimal("0")
    remaining: Decimal = Decimal("0")
    gross_up_enabled: bool = False
    installment_enabled: bool = False
    installment_no: Optional[int] = None
    installment_chain_root_id: Optional[str] = None
    installment_target_amount: Optional[Decimal] = None
    installment_payment_amount: Optional[Decimal] = None
    installment_chain_status: Optional[str] = None
    installment_chain_remaining: Optional[Decimal] = None
    requested_net_amount: Optional[Decimal] = None
    requester_withholding_status: str = "not_required"
    taxpayer_name: Optional[str] = None
    taxpayer_type: Optional[str] = None
    taxpayer_branch: Optional[str] = None
    taxpayer_id: Optional[str] = None
    taxpayer_address: Optional[str] = None
    status: str
    current_step_no: Optional[int]
    submitted_at: Optional[datetime]
    approved_at: Optional[datetime]
    decided_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


class ExpenseRequestListOut(BaseModel):
    items: list[ExpenseRequestOut]
    total: int
    limit: int
    offset: int


class ExpenseRequestStatsOut(BaseModel):
    total_count: int
    action_required_count: int
    in_progress_count: int
    completed_count: int
    amount_total: Decimal


class ApprovalStepTimelineOut(BaseModel):
    id: int
    step_no: int
    name: Optional[str] = None
    approver_position_id: Optional[int] = None
    approver_position_name: Optional[str] = None
    resolved_approver_user_id: Optional[int]
    resolved_approver_name: Optional[str] = None
    status: str
    comment: Optional[str]
    decided_by: Optional[int]
    decided_at: Optional[datetime]
    approvers: list[dict] = []
    is_legacy: bool = False
    model_config = {"from_attributes": True}


class ExpenseInstallmentSiblingOut(BaseModel):
    id: str
    request_no: Optional[str] = None
    installment_no: Optional[int] = None
    status: str
    amount: Decimal
    paid_amount: Decimal


class ExpenseRequestDetailOut(ExpenseRequestOut):
    items: list[ExpenseRequestItemOut] = []
    attachments: list[ExpenseRequestAttachmentOut] = []
    steps: list[ApprovalStepTimelineOut] = []
    installment_siblings: list[ExpenseInstallmentSiblingOut] = []


class ExpenseInstallmentCreate(BaseModel):
    installment_payment_amount: Decimal = Field(gt=0)


class InboxItemOut(BaseModel):
    step_id: int
    step_no: int
    expense_request_id: str
    request_no: Optional[str] = None
    title: str
    amount: Decimal
    requester_user_id: int
    requester_name: Optional[str] = None
    requester_position_name: Optional[str] = None
    department_name: Optional[str] = None
    expense_type_name: Optional[str] = None
    request_date: date
    submitted_at: Optional[datetime]
    status: str = Field(pattern="^(pending|approved|returned|rejected)$")


class InboxCountOut(BaseModel):
    count: int = Field(ge=0)


class DecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject|return)$")
    comment: Optional[str] = None
    idempotency_key: str
    signature_data_url: Optional[str] = None
    use_saved_signature: bool = False
    save_signature: bool = False
    placements: list[dict] = []
