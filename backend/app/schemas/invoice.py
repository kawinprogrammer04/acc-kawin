from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, model_validator


WhtType = Literal["1", "2", "3", "5", "15"]
InvoiceType = Literal["ar", "ap"]


class InvoiceLineCreate(BaseModel):
    line_number: int
    description: str
    quantity: Decimal = Decimal("1")
    unit: str | None = None
    unit_price: Decimal
    discount_pct: Decimal = Decimal("0")
    account_id: int | None = None
    wht_type: WhtType | None = None

    @model_validator(mode="after")
    def validate_positive(self) -> "InvoiceLineCreate":
        if self.quantity <= 0:
            raise ValueError("จำนวนต้องมากกว่าศูนย์")
        if self.unit_price < 0:
            raise ValueError("ราคาต่อหน่วยต้องไม่ติดลบ")
        if not (0 <= self.discount_pct <= 100):
            raise ValueError("ส่วนลดต้องอยู่ระหว่าง 0–100%")
        return self


class InvoiceCreate(BaseModel):
    invoice_type: InvoiceType
    invoice_number: str
    reference: str | None = None
    invoice_date: datetime
    due_date: datetime
    party_id: str
    period_id: int
    ar_ap_account_id: int
    revenue_expense_account_id: int | None = None
    is_vat_included: bool = False
    apply_vat: bool = True
    notes: str | None = None
    lines: list[InvoiceLineCreate]

    @model_validator(mode="after")
    def validate_dates(self) -> "InvoiceCreate":
        if self.due_date < self.invoice_date:
            raise ValueError("วันครบกำหนดต้องไม่ก่อนวันที่ใบแจ้งหนี้")
        if not self.lines:
            raise ValueError("ต้องมีรายการอย่างน้อย 1 บรรทัด")
        return self


class InvoiceLineOut(BaseModel):
    id: int
    line_number: int
    description: str
    quantity: Decimal
    unit: str | None
    unit_price: Decimal
    discount_pct: Decimal
    discount_amount: Decimal
    line_total: Decimal
    wht_type: str | None
    wht_rate: Decimal | None
    wht_amount: Decimal

    model_config = {"from_attributes": True}


class InvoiceOut(BaseModel):
    id: str
    invoice_type: str
    invoice_number: str
    reference: str | None
    invoice_date: datetime
    due_date: datetime
    party_id: str
    party_name: str | None = None
    period_id: int
    subtotal: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    vat_amount: Decimal
    wht_amount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    balance_due: Decimal
    status: str
    is_vat_included: bool
    notes: str | None
    journal_id: str | None
    lines: list[InvoiceLineOut] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class VatCalculation(BaseModel):
    subtotal: Decimal
    taxable_amount: Decimal
    vat_amount: Decimal
    total_amount: Decimal
    vat_rate: Decimal
