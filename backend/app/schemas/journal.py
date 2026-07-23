from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, model_validator


class JournalLineCreate(BaseModel):
    line_number: int
    account_id: int
    description: str | None = None
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    party_id: str | None = None

    @model_validator(mode="after")
    def validate_single_side(self) -> "JournalLineCreate":
        if self.debit > 0 and self.credit > 0:
            raise ValueError(f"บรรทัดที่ {self.line_number}: ใส่ได้ทั้ง debit และ credit พร้อมกันไม่ได้")
        if self.debit < 0 or self.credit < 0:
            raise ValueError(f"บรรทัดที่ {self.line_number}: จำนวนเงินต้องไม่ติดลบ")
        return self


class JournalCreate(BaseModel):
    entry_date: datetime
    period_id: int
    description: str
    reference: str | None = None
    lines: list[JournalLineCreate]

    @model_validator(mode="after")
    def validate_balance(self) -> "JournalCreate":
        if len(self.lines) < 2:
            raise ValueError("Journal Entry ต้องมีอย่างน้อย 2 บรรทัด")
        total_debit = sum(ln.debit for ln in self.lines)
        total_credit = sum(ln.credit for ln in self.lines)
        if total_debit != total_credit:
            raise ValueError(
                f"Debit ({total_debit}) ไม่เท่ากับ Credit ({total_credit}) — ต้องสมดุลก่อน Post"
            )
        if total_debit == 0:
            raise ValueError("ยอด Debit/Credit ต้องมากกว่าศูนย์")
        return self


class JournalLineOut(BaseModel):
    id: int
    line_number: int
    account_id: int
    account_code: str | None = None
    account_name: str | None = None
    description: str | None
    debit: Decimal
    credit: Decimal
    party_id: str | None

    model_config = {"from_attributes": True}


class JournalOut(BaseModel):
    id: str
    entry_number: str
    entry_date: datetime
    period_id: int
    description: str
    reference: str | None
    status: str
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    lines: list[JournalLineOut] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class VoidRequest(BaseModel):
    reason: str
