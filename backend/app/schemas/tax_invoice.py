from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class TaxInvoiceCustomer(BaseModel):
    name: str
    address: str = ""
    tax_id: str = ""
    branch: str = "สำนักงานใหญ่"


class TaxInvoiceLine(BaseModel):
    order_number: str | None = None
    product_code: str = ""
    description: str
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit: str = "ชิ้น"
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)


class TaxInvoiceDocument(BaseModel):
    invoice_number: str
    invoice_date: date
    order_numbers: list[str]
    customer: TaxInvoiceCustomer
    payment_method: Literal["cash", "credit", "transfer", "other"] = "transfer"
    payment_type: str | None = None
    credit_days: int = Field(default=0, ge=0, le=3650)
    lines: list[TaxInvoiceLine]
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    vat_rate: Decimal = Field(default=Decimal("7"), ge=0, le=100)
    notes: str = ""


class CrmOrderLookupRequest(BaseModel):
    order_numbers: list[str] = Field(min_length=1, max_length=50)

    @field_validator("order_numbers")
    @classmethod
    def normalize_order_numbers(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        if not normalized:
            raise ValueError("กรุณากรอกเลขออเดอร์อย่างน้อย 1 รายการ")
        return normalized


class CrmOrderLookupResponse(BaseModel):
    source: Literal["crm", "mock"]
    warning: str | None = None
    document: TaxInvoiceDocument


class TaxInvoiceExportRequest(BaseModel):
    copy_type: Literal["customer", "company", "accounting", "all"] = "all"
    source: Literal["crm", "mock"] | None = None
    document: TaxInvoiceDocument


class TaxInvoiceSaveRequest(TaxInvoiceExportRequest):
    pass


class TaxInvoiceSaveResponse(BaseModel):
    id: str
    invoice_number: str
    saved: bool = True
