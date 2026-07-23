from datetime import datetime
from typing import Literal
from pydantic import BaseModel, field_validator


AccountType = Literal["asset", "liability", "equity", "revenue", "expense"]
NormalBalance = Literal["debit", "credit"]


class AccountCreate(BaseModel):
    code: str
    name_th: str
    name_en: str | None = None
    account_type: AccountType
    category: str
    normal_balance: NormalBalance
    parent_id: int | None = None
    level: int = 1
    is_header: bool = False
    description: str | None = None

    @field_validator("code")
    @classmethod
    def code_must_be_numeric(cls, v: str) -> str:
        if not v.strip().replace("-", "").isdigit():
            raise ValueError("รหัสบัญชีต้องเป็นตัวเลข")
        return v.strip()


class AccountUpdate(BaseModel):
    name_th: str | None = None
    name_en: str | None = None
    category: str | None = None
    parent_id: int | None = None
    is_header: bool | None = None
    is_active: bool | None = None
    description: str | None = None


class AccountOut(BaseModel):
    id: int
    code: str
    name_th: str
    name_en: str | None
    account_type: str
    category: str
    normal_balance: str
    parent_id: int | None
    level: int
    is_header: bool
    is_active: bool
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AccountTree(AccountOut):
    children: list["AccountTree"] = []
