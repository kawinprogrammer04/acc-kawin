"""
Cash Flow Module — Combined router for all cash-flow features:
  /api/wallet-accounts, /api/holders, /api/categories,
  /api/income, /api/expenses, /api/payables, /api/receivables,
  /api/transfers, /api/documents, /api/cashflow-dashboard
"""

import os
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, List, Any, Literal

from fastapi import (
    APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, condecimal, model_validator
from sqlalchemy import String, select, func, and_, or_, cast, text, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_accountant, get_current_company
from app.models.cashflow import (
    WalletAccount, Holder, CashflowCategory, IncomeEntry, ExpenseEntry,
    Payable, Receivable, Transfer, Document, CashTransaction, ActivityLog,
    EntryStatus, PayableStatus, ReceivableStatus, TransferType,
    WalletAccountType, MoneyOwnerType, HolderType, CashflowCategoryType, CashDirection
)
from app.models.bank_reconciliation import BankReconciliation
from app.models.company import Company, CompanyIntegration
from app.models.user import User
from app.services.ocr_service import extract_receipt_data, OcrServiceError

# ─── Upload directory ─────────────────────────────────────────────────────────
UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ─── Router ───────────────────────────────────────────────────────────────────
router = APIRouter(tags=["CashFlow"])


# ═══════════════════════════════════════════════════════════════════════════════
# SHARED HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

async def log_activity(db: AsyncSession, user_id: int, action: str,
                       resource_type: str, resource_id: str, description: str,
                       old_data=None, new_data=None, company_id: int = 1):
    log = ActivityLog(
        user_id=user_id, action=action,
        resource_type=resource_type, resource_id=resource_id,
        description=description, old_data=old_data, new_data=new_data,
        company_id=company_id,
    )
    db.add(log)


async def create_cash_transaction(db: AsyncSession, ref_type: str, ref_id: str,
                                   direction: CashDirection, amount: Decimal,
                                   account_id: Optional[int], holder_id: Optional[int],
                                   txn_date: date, description: str, user_id: int,
                                   company_id: int = 1):
    tx = CashTransaction(
        transaction_date=txn_date, direction=direction,
        reference_type=ref_type, reference_id=ref_id,
        wallet_account_id=account_id, holder_id=holder_id,
        amount=amount, description=description, created_by=user_id,
        company_id=company_id,
    )
    db.add(tx)

    if account_id:
        stmt = text("SELECT update_wallet_balance(:aid, :amt, CAST(:dir AS cash_direction))")
        res = await db.execute(stmt, {"aid": account_id, "amt": float(amount), "dir": direction.value})
        new_bal = res.scalar()
        tx.balance_after = new_bal

    if holder_id:
        stmt = text("SELECT update_holder_balance(:hid, :amt, CAST(:dir AS cash_direction))")
        await db.execute(stmt, {"hid": holder_id, "amt": float(amount), "dir": direction.value})


async def get_company_record(
    db: AsyncSession, model, record_id, company_id: int, not_found_message: str
):
    """Load one row while enforcing tenant isolation for every action endpoint."""
    result = await db.execute(
        select(model).where(model.id == record_id, model.company_id == company_id)
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(404, not_found_message)
    return obj


async def ensure_reference_not_reconciled(
    db: AsyncSession,
    company_id: int,
    reference_types: tuple[str, ...],
    reference_id: str,
):
    """Prevent accounting mutations while a related cash movement is reconciled."""
    reconciled = (
        await db.execute(
            select(BankReconciliation.id)
            .join(
                CashTransaction,
                CashTransaction.id == BankReconciliation.cash_transaction_id,
            )
            .where(
                BankReconciliation.company_id == company_id,
                BankReconciliation.is_active.is_(True),
                CashTransaction.reference_type.in_(reference_types),
                cast(CashTransaction.reference_id, String) == str(reference_id),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if reconciled:
        raise HTTPException(
            409,
            "รายการนี้กระทบยอดธนาคารแล้ว กรุณายกเลิกการกระทบยอดก่อนแก้ไขหรือยกเลิก",
        )


# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════

# ── WalletAccount ─────────────────────────────────────────────────────────────
class WalletAccountCreate(BaseModel):
    name: str
    account_type: WalletAccountType = WalletAccountType.bank
    owner_type: MoneyOwnerType = MoneyOwnerType.company
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder: Optional[str] = None
    currency: str = "THB"
    opening_balance: Decimal = Decimal("0")
    notes: Optional[str] = None


class WalletAccountUpdate(BaseModel):
    name: Optional[str] = None
    account_type: Optional[WalletAccountType] = None
    owner_type: Optional[MoneyOwnerType] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder: Optional[str] = None
    currency: Optional[str] = None
    opening_balance: Optional[Decimal] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class WalletAccountOut(BaseModel):
    id: int
    name: str
    account_type: str
    owner_type: str
    bank_name: Optional[str]
    account_number: Optional[str]
    account_holder: Optional[str]
    currency: str
    opening_balance: Decimal
    current_balance: Decimal
    is_active: bool
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Holder ────────────────────────────────────────────────────────────────────
class HolderCreate(BaseModel):
    name: str
    holder_type: HolderType = HolderType.company
    owner_type: MoneyOwnerType = MoneyOwnerType.company
    wallet_account_id: Optional[int] = None
    purpose: Optional[str] = None
    opening_balance: Decimal = Decimal("0")
    responsible_user_id: Optional[int] = None
    notes: Optional[str] = None


class HolderUpdate(BaseModel):
    name: Optional[str] = None
    holder_type: Optional[HolderType] = None
    owner_type: Optional[MoneyOwnerType] = None
    wallet_account_id: Optional[int] = None
    purpose: Optional[str] = None
    opening_balance: Optional[Decimal] = None
    responsible_user_id: Optional[int] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class HolderOut(BaseModel):
    id: int
    name: str
    holder_type: str
    owner_type: str
    wallet_account_id: Optional[int]
    purpose: Optional[str]
    opening_balance: Decimal
    current_balance: Decimal
    responsible_user_id: Optional[int]
    is_active: bool
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Category ──────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    type: CashflowCategoryType
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    type: Optional[CashflowCategoryType] = None
    name: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryOut(BaseModel):
    id: int
    type: str
    name: str
    parent_id: Optional[int]
    color: Optional[str]
    icon: Optional[str]
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


# ── IncomeEntry ───────────────────────────────────────────────────────────────
class IncomeCreate(BaseModel):
    income_date: date
    document_no: Optional[str] = None
    income_type: Optional[str] = None
    category_id: Optional[int] = None
    customer_name: Optional[str] = None
    description: str
    amount: Decimal = Field(gt=0)
    vat_amount: Decimal = Decimal("0")
    withholding_tax: Decimal = Decimal("0")
    net_amount: Decimal = Field(gt=0)
    payment_channel: Optional[str] = None
    wallet_account_id: Optional[int] = None
    holder_id: Optional[int] = None
    status: EntryStatus = EntryStatus.pending
    received_date: Optional[date] = None
    owner_type: MoneyOwnerType = MoneyOwnerType.company
    notes: Optional[str] = None
    receivable_id: Optional[str] = None


class IncomeUpdate(BaseModel):
    income_date: Optional[date] = None
    document_no: Optional[str] = None
    income_type: Optional[str] = None
    category_id: Optional[int] = None
    customer_name: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[Decimal] = Field(default=None, gt=0)
    vat_amount: Optional[Decimal] = Field(default=None, ge=0)
    withholding_tax: Optional[Decimal] = Field(default=None, ge=0)
    net_amount: Optional[Decimal] = Field(default=None, gt=0)
    payment_channel: Optional[str] = None
    wallet_account_id: Optional[int] = None
    holder_id: Optional[int] = None
    status: Optional[EntryStatus] = None
    received_date: Optional[date] = None
    owner_type: Optional[MoneyOwnerType] = None
    notes: Optional[str] = None


class IncomeOut(BaseModel):
    id: str
    income_date: date
    document_no: Optional[str]
    income_type: Optional[str]
    category_id: Optional[int]
    customer_name: Optional[str]
    description: str
    amount: Decimal
    vat_amount: Decimal
    withholding_tax: Decimal
    net_amount: Decimal
    payment_channel: Optional[str]
    wallet_account_id: Optional[int]
    holder_id: Optional[int]
    status: str
    received_date: Optional[date]
    owner_type: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── ExpenseEntry ──────────────────────────────────────────────────────────────
class ExpenseCreate(BaseModel):
    expense_date: date
    document_no: Optional[str] = None
    expense_type: Optional[str] = None
    category_id: Optional[int] = None
    vendor_name: Optional[str] = None
    description: str
    amount: Decimal = Field(gt=0)
    vat_amount: Decimal = Decimal("0")
    withholding_tax: Decimal = Decimal("0")
    net_amount: Decimal = Field(gt=0)
    payment_channel: Optional[str] = None
    wallet_account_id: Optional[int] = None
    holder_id: Optional[int] = None
    is_company_expense: bool = True
    status: EntryStatus = EntryStatus.pending
    paid_date: Optional[date] = None
    owner_type: MoneyOwnerType = MoneyOwnerType.company
    notes: Optional[str] = None
    payable_id: Optional[str] = None


class ExpenseUpdate(BaseModel):
    expense_date: Optional[date] = None
    document_no: Optional[str] = None
    expense_type: Optional[str] = None
    category_id: Optional[int] = None
    vendor_name: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[Decimal] = Field(default=None, gt=0)
    vat_amount: Optional[Decimal] = Field(default=None, ge=0)
    withholding_tax: Optional[Decimal] = Field(default=None, ge=0)
    net_amount: Optional[Decimal] = Field(default=None, gt=0)
    payment_channel: Optional[str] = None
    wallet_account_id: Optional[int] = None
    holder_id: Optional[int] = None
    is_company_expense: Optional[bool] = None
    status: Optional[EntryStatus] = None
    paid_date: Optional[date] = None
    owner_type: Optional[MoneyOwnerType] = None
    notes: Optional[str] = None


class ExpenseOut(BaseModel):
    id: str
    expense_date: date
    document_no: Optional[str]
    expense_type: Optional[str]
    category_id: Optional[int]
    vendor_name: Optional[str]
    description: str
    amount: Decimal
    vat_amount: Decimal
    withholding_tax: Decimal
    net_amount: Decimal
    payment_channel: Optional[str]
    wallet_account_id: Optional[int]
    holder_id: Optional[int]
    is_company_expense: bool
    status: str
    paid_date: Optional[date]
    owner_type: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Payable ───────────────────────────────────────────────────────────────────
class PayableCreate(BaseModel):
    creditor_name: str
    creditor_type: Optional[str] = None
    description: Optional[str] = None
    issue_date: date
    due_date: Optional[date] = None
    total_amount: Decimal = Field(gt=0)
    expected_account_id: Optional[int] = None
    expected_holder_id: Optional[int] = None
    category_id: Optional[int] = None
    reference_doc: Optional[str] = None
    notes: Optional[str] = None


class PayableUpdate(BaseModel):
    creditor_name: Optional[str] = None
    creditor_type: Optional[str] = None
    description: Optional[str] = None
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    total_amount: Optional[Decimal] = Field(default=None, gt=0)
    expected_account_id: Optional[int] = None
    expected_holder_id: Optional[int] = None
    category_id: Optional[int] = None
    reference_doc: Optional[str] = None
    notes: Optional[str] = None


class PayablePayment(BaseModel):
    amount: Decimal = Field(gt=0)
    account_id: Optional[int] = None
    holder_id: Optional[int] = None
    paid_date: date


class PayableOut(BaseModel):
    id: str
    creditor_name: str
    creditor_type: Optional[str]
    description: Optional[str]
    issue_date: date
    due_date: Optional[date]
    total_amount: Decimal
    paid_amount: Decimal
    remaining_amount: Optional[Decimal]
    expected_account_id: Optional[int]
    expected_holder_id: Optional[int]
    status: str
    reference_doc: Optional[str]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Receivable ────────────────────────────────────────────────────────────────
class ReceivableCreate(BaseModel):
    debtor_name: str
    debtor_type: Optional[str] = None
    description: Optional[str] = None
    issue_date: date
    due_date: Optional[date] = None
    total_amount: Decimal = Field(gt=0)
    expected_account_id: Optional[int] = None
    expected_holder_id: Optional[int] = None
    category_id: Optional[int] = None
    reference_doc: Optional[str] = None
    notes: Optional[str] = None


class ReceivableUpdate(BaseModel):
    debtor_name: Optional[str] = None
    debtor_type: Optional[str] = None
    description: Optional[str] = None
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    total_amount: Optional[Decimal] = Field(default=None, gt=0)
    expected_account_id: Optional[int] = None
    expected_holder_id: Optional[int] = None
    category_id: Optional[int] = None
    reference_doc: Optional[str] = None
    notes: Optional[str] = None


class ReceivablePayment(BaseModel):
    amount: Decimal = Field(gt=0)
    account_id: Optional[int] = None
    holder_id: Optional[int] = None
    received_date: date


class ReceivableOut(BaseModel):
    id: str
    debtor_name: str
    debtor_type: Optional[str]
    description: Optional[str]
    issue_date: date
    due_date: Optional[date]
    total_amount: Decimal
    received_amount: Decimal
    remaining_amount: Optional[Decimal]
    expected_account_id: Optional[int]
    expected_holder_id: Optional[int]
    status: str
    reference_doc: Optional[str]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Transfer ──────────────────────────────────────────────────────────────────
class TransferCreate(BaseModel):
    transfer_date: date
    transfer_type: TransferType = TransferType.account_to_account
    from_account_id: Optional[int] = None
    from_holder_id: Optional[int] = None
    to_account_id: Optional[int] = None
    to_holder_id: Optional[int] = None
    amount: Decimal = Field(gt=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    reason: Optional[str] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_endpoints(self):
        sources = [self.from_account_id, self.from_holder_id]
        destinations = [self.to_account_id, self.to_holder_id]
        if sum(value is not None for value in sources) != 1:
            raise ValueError("ต้องเลือกแหล่งเงินต้นทางเพียงหนึ่งรายการ")
        if sum(value is not None for value in destinations) != 1:
            raise ValueError("ต้องเลือกปลายทางเพียงหนึ่งรายการ")
        if self.from_account_id and self.from_account_id == self.to_account_id:
            raise ValueError("บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน")
        if self.from_holder_id and self.from_holder_id == self.to_holder_id:
            raise ValueError("Holder ต้นทางและปลายทางต้องไม่ใช่รายการเดียวกัน")
        return self


class TransferOut(BaseModel):
    id: str
    transfer_date: date
    transfer_type: str
    from_account_id: Optional[int]
    from_holder_id: Optional[int]
    to_account_id: Optional[int]
    to_holder_id: Optional[int]
    amount: Decimal
    fee: Decimal
    reason: Optional[str]
    status: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ═══════════════════════════════════════════════════════════════════════════════
# WALLET ACCOUNTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/wallet-accounts", response_model=List[WalletAccountOut])
async def list_wallet_accounts(
    owner_type: Optional[str] = None,
    is_active: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(WalletAccount).where(WalletAccount.company_id == company.id)
    if owner_type:
        q = q.where(WalletAccount.owner_type == owner_type)
    if is_active is not None:
        q = q.where(WalletAccount.is_active == is_active)
    q = q.order_by(WalletAccount.owner_type, WalletAccount.name)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/wallet-accounts", response_model=WalletAccountOut, status_code=201)
async def create_wallet_account(
    payload: WalletAccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = WalletAccount(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    obj.current_balance = payload.opening_balance
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    await log_activity(db, current_user.id, "create", "wallet_account", str(obj.id), f"สร้างบัญชี {obj.name}", company_id=company.id)
    await db.commit()
    return obj


@router.get("/wallet-accounts/{account_id}", response_model=WalletAccountOut)
async def get_wallet_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    return await get_company_record(db, WalletAccount, account_id, company.id, "ไม่พบบัญชีนี้")


@router.patch("/wallet-accounts/{account_id}", response_model=WalletAccountOut)
async def update_wallet_account(
    account_id: int,
    payload: WalletAccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, WalletAccount, account_id, company.id, "ไม่พบบัญชีนี้")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/wallet-accounts/{account_id}", status_code=204)
async def delete_wallet_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, WalletAccount, account_id, company.id, "ไม่พบบัญชีนี้")
    obj.is_active = False
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# HOLDERS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/holders", response_model=List[HolderOut])
async def list_holders(
    holder_type: Optional[str] = None,
    wallet_account_id: Optional[int] = None,
    is_active: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(Holder).where(Holder.company_id == company.id)
    if holder_type:
        q = q.where(Holder.holder_type == holder_type)
    if wallet_account_id:
        q = q.where(Holder.wallet_account_id == wallet_account_id)
    q = q.where(Holder.is_active == is_active).order_by(Holder.name)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/holders", response_model=HolderOut, status_code=201)
async def create_holder(
    payload: HolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    if payload.wallet_account_id:
        await get_company_record(
            db, WalletAccount, payload.wallet_account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
    obj = Holder(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    obj.current_balance = payload.opening_balance
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/holders/{holder_id}", response_model=HolderOut)
async def get_holder(
    holder_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    return await get_company_record(db, Holder, holder_id, company.id, "ไม่พบ Holder นี้")


@router.patch("/holders/{holder_id}", response_model=HolderOut)
async def update_holder(
    holder_id: int,
    payload: HolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Holder, holder_id, company.id, "ไม่พบ Holder นี้")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/holders/{holder_id}", status_code=204)
async def delete_holder(
    holder_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Holder, holder_id, company.id, "ไม่พบ Holder นี้")
    obj.is_active = False
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# CATEGORIES ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/cashflow-categories", response_model=List[CategoryOut])
async def list_categories(
    type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(CashflowCategory).where(CashflowCategory.company_id == company.id, CashflowCategory.is_active == True)
    if type:
        q = q.where(CashflowCategory.type == type)
    q = q.order_by(CashflowCategory.type, CashflowCategory.sort_order, CashflowCategory.name)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/cashflow-categories", response_model=CategoryOut, status_code=201)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    if payload.parent_id:
        await get_company_record(
            db, CashflowCategory, payload.parent_id, company.id, "ไม่พบหมวดหมู่แม่"
        )
    obj = CashflowCategory(**payload.model_dump(), company_id=company.id)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch("/cashflow-categories/{cat_id}", response_model=CategoryOut)
async def update_category(
    cat_id: int,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, CashflowCategory, cat_id, company.id, "ไม่พบหมวดหมู่นี้")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/cashflow-categories/{cat_id}", status_code=204)
async def delete_category(
    cat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, CashflowCategory, cat_id, company.id, "ไม่พบหมวดหมู่นี้")
    obj.is_active = False
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# INCOME ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/income", response_model=List[IncomeOut])
async def list_income(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    status: Optional[str] = None,
    wallet_account_id: Optional[int] = None,
    holder_id: Optional[int] = None,
    category_id: Optional[int] = None,
    keyword: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(IncomeEntry).where(IncomeEntry.company_id == company.id)
    if start_date:
        q = q.where(IncomeEntry.income_date >= start_date)
    if end_date:
        q = q.where(IncomeEntry.income_date <= end_date)
    if status:
        q = q.where(IncomeEntry.status == status)
    if wallet_account_id:
        q = q.where(IncomeEntry.wallet_account_id == wallet_account_id)
    if holder_id:
        q = q.where(IncomeEntry.holder_id == holder_id)
    if category_id:
        q = q.where(IncomeEntry.category_id == category_id)
    if keyword:
        q = q.where(or_(
            IncomeEntry.description.ilike(f"%{keyword}%"),
            IncomeEntry.customer_name.ilike(f"%{keyword}%"),
            IncomeEntry.document_no.ilike(f"%{keyword}%"),
        ))
    q = q.order_by(IncomeEntry.income_date.desc(), IncomeEntry.created_at.desc())
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/income", response_model=IncomeOut, status_code=201)
async def create_income(
    payload: IncomeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    if payload.wallet_account_id:
        await get_company_record(
            db, WalletAccount, payload.wallet_account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
    if payload.holder_id:
        await get_company_record(
            db, Holder, payload.holder_id, company.id, "ไม่พบ Holder ที่เลือก"
        )
    obj = IncomeEntry(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    db.add(obj)
    await db.flush()

    # ถ้าสถานะ completed ให้อัปเดต balance ทันที
    if obj.status == EntryStatus.completed:
        await create_cash_transaction(
            db, "income", str(obj.id), CashDirection.IN, obj.net_amount,
            obj.wallet_account_id, obj.holder_id, obj.income_date,
            f"รายรับ: {obj.description}", current_user.id, company_id=company.id
        )

    await log_activity(db, current_user.id, "create", "income", str(obj.id), f"บันทึกรายรับ {obj.description}", company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/income/{income_id}", response_model=IncomeOut)
async def get_income(
    income_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    return await get_company_record(db, IncomeEntry, income_id, company.id, "ไม่พบรายการรายรับนี้")


@router.patch("/income/{income_id}", response_model=IncomeOut)
async def update_income(
    income_id: str,
    payload: IncomeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, IncomeEntry, income_id, company.id, "ไม่พบรายการรายรับนี้")
    await ensure_reference_not_reconciled(db, company.id, ("income",), income_id)

    updates = payload.model_dump(exclude_unset=True)
    old_status = obj.status
    old_settlement = {
        "net_amount": obj.net_amount,
        "wallet_account_id": obj.wallet_account_id,
        "holder_id": obj.holder_id,
        "income_date": obj.income_date,
        "received_date": obj.received_date,
    }
    if old_status == EntryStatus.cancelled and updates.get("status", old_status) != EntryStatus.cancelled:
        raise HTTPException(400, "ไม่สามารถเปิดรายการที่ยกเลิกแล้วกลับมาใหม่")
    for key, value in updates.items():
        setattr(obj, key, value)

    settlement_changed = any(
        key in updates and updates[key] != old_settlement[key]
        for key in old_settlement
    )
    if old_status == EntryStatus.completed and (
        obj.status != EntryStatus.completed or settlement_changed
    ):
        await create_cash_transaction(
            db, "income_adjustment", str(obj.id), CashDirection.OUT,
            old_settlement["net_amount"], old_settlement["wallet_account_id"],
            old_settlement["holder_id"], date.today(),
            f"ย้อนรายการรายรับเดิม: {obj.description}", current_user.id,
            company_id=company.id,
        )

    if obj.status == EntryStatus.completed and (
        old_status != EntryStatus.completed or settlement_changed
    ):
        if obj.wallet_account_id:
            await get_company_record(
                db, WalletAccount, obj.wallet_account_id, company.id, "ไม่พบบัญชีที่เลือก"
            )
        if obj.holder_id:
            await get_company_record(
                db, Holder, obj.holder_id, company.id, "ไม่พบ Holder ที่เลือก"
            )
        await create_cash_transaction(
            db, "income", str(obj.id), CashDirection.IN, obj.net_amount,
            obj.wallet_account_id, obj.holder_id,
            obj.received_date or obj.income_date,
            f"รายรับ: {obj.description}", current_user.id, company_id=company.id
        )

    await log_activity(db, current_user.id, "update", "income", income_id, f"แก้ไขรายรับ {obj.description}", company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/income/{income_id}", status_code=204)
async def delete_income(
    income_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, IncomeEntry, income_id, company.id, "ไม่พบรายการรายรับนี้")
    await ensure_reference_not_reconciled(db, company.id, ("income",), income_id)
    if obj.status == EntryStatus.cancelled:
        raise HTTPException(400, "รายการนี้ถูกยกเลิกแล้ว")
    if obj.status == EntryStatus.completed:
        await create_cash_transaction(
            db, "income_cancel", income_id, CashDirection.OUT, obj.net_amount,
            obj.wallet_account_id, obj.holder_id, date.today(),
            f"ยกเลิกรายรับ: {obj.description}", current_user.id, company_id=company.id
        )
    obj.status = EntryStatus.cancelled
    await log_activity(db, current_user.id, "delete", "income", income_id, f"ยกเลิกรายรับ {obj.description}", company_id=company.id)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# EXPENSE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/expenses", response_model=List[ExpenseOut])
async def list_expenses(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    status: Optional[str] = None,
    wallet_account_id: Optional[int] = None,
    holder_id: Optional[int] = None,
    category_id: Optional[int] = None,
    is_company_expense: Optional[bool] = None,
    keyword: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(ExpenseEntry).where(ExpenseEntry.company_id == company.id)
    if start_date:
        q = q.where(ExpenseEntry.expense_date >= start_date)
    if end_date:
        q = q.where(ExpenseEntry.expense_date <= end_date)
    if status:
        q = q.where(ExpenseEntry.status == status)
    if wallet_account_id:
        q = q.where(ExpenseEntry.wallet_account_id == wallet_account_id)
    if holder_id:
        q = q.where(ExpenseEntry.holder_id == holder_id)
    if category_id:
        q = q.where(ExpenseEntry.category_id == category_id)
    if is_company_expense is not None:
        q = q.where(ExpenseEntry.is_company_expense == is_company_expense)
    if keyword:
        q = q.where(or_(
            ExpenseEntry.description.ilike(f"%{keyword}%"),
            ExpenseEntry.vendor_name.ilike(f"%{keyword}%"),
            ExpenseEntry.document_no.ilike(f"%{keyword}%"),
        ))
    q = q.order_by(ExpenseEntry.expense_date.desc(), ExpenseEntry.created_at.desc())
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
async def create_expense(
    payload: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    # Validate balance if status = completed
    if payload.status == EntryStatus.completed and payload.wallet_account_id:
        acc = await get_company_record(
            db, WalletAccount, payload.wallet_account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
        if acc.current_balance < payload.net_amount:
            raise HTTPException(400, f"ยอดเงินในบัญชีไม่เพียงพอ (คงเหลือ {acc.current_balance:,.2f} บาท)")
    if payload.holder_id:
        holder = await get_company_record(
            db, Holder, payload.holder_id, company.id, "ไม่พบ Holder ที่เลือก"
        )
        if payload.status == EntryStatus.completed and holder.current_balance < payload.net_amount:
            raise HTTPException(400, f"ยอด Holder ไม่เพียงพอ (คงเหลือ {holder.current_balance:,.2f} บาท)")

    obj = ExpenseEntry(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    db.add(obj)
    await db.flush()

    if obj.status == EntryStatus.completed:
        await create_cash_transaction(
            db, "expense", str(obj.id), CashDirection.OUT, obj.net_amount,
            obj.wallet_account_id, obj.holder_id, obj.expense_date,
            f"รายจ่าย: {obj.description}", current_user.id, company_id=company.id
        )

    await log_activity(db, current_user.id, "create", "expense", str(obj.id), f"บันทึกรายจ่าย {obj.description}", company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/expenses/{expense_id}", response_model=ExpenseOut)
async def get_expense(
    expense_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    return await get_company_record(db, ExpenseEntry, expense_id, company.id, "ไม่พบรายการรายจ่ายนี้")


@router.patch("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: str,
    payload: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, ExpenseEntry, expense_id, company.id, "ไม่พบรายการรายจ่ายนี้")
    await ensure_reference_not_reconciled(db, company.id, ("expense",), expense_id)

    updates = payload.model_dump(exclude_unset=True)
    old_status = obj.status
    old_settlement = {
        "net_amount": obj.net_amount,
        "wallet_account_id": obj.wallet_account_id,
        "holder_id": obj.holder_id,
        "expense_date": obj.expense_date,
        "paid_date": obj.paid_date,
    }
    if old_status == EntryStatus.cancelled and updates.get("status", old_status) != EntryStatus.cancelled:
        raise HTTPException(400, "ไม่สามารถเปิดรายการที่ยกเลิกแล้วกลับมาใหม่")
    for key, value in updates.items():
        setattr(obj, key, value)

    settlement_changed = any(
        key in updates and updates[key] != old_settlement[key]
        for key in old_settlement
    )
    if old_status == EntryStatus.completed and (
        obj.status != EntryStatus.completed or settlement_changed
    ):
        await create_cash_transaction(
            db, "expense_adjustment", str(obj.id), CashDirection.IN,
            old_settlement["net_amount"], old_settlement["wallet_account_id"],
            old_settlement["holder_id"], date.today(),
            f"ย้อนรายการรายจ่ายเดิม: {obj.description}", current_user.id,
            company_id=company.id,
        )

    if obj.status == EntryStatus.completed and (
        old_status != EntryStatus.completed or settlement_changed
    ):
        if obj.wallet_account_id:
            acc = await get_company_record(
                db, WalletAccount, obj.wallet_account_id, company.id, "ไม่พบบัญชีที่เลือก"
            )
            if acc.current_balance < obj.net_amount:
                raise HTTPException(400, f"ยอดเงินในบัญชีไม่เพียงพอ")
        if obj.holder_id:
            holder = await get_company_record(
                db, Holder, obj.holder_id, company.id, "ไม่พบ Holder ที่เลือก"
            )
            if holder.current_balance < obj.net_amount:
                raise HTTPException(400, "ยอด Holder ไม่เพียงพอ")
        await create_cash_transaction(
            db, "expense", str(obj.id), CashDirection.OUT, obj.net_amount,
            obj.wallet_account_id, obj.holder_id,
            obj.paid_date or obj.expense_date,
            f"รายจ่าย: {obj.description}", current_user.id, company_id=company.id
        )

    await log_activity(db, current_user.id, "update", "expense", expense_id, f"แก้ไขรายจ่าย {obj.description}", company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/expenses/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, ExpenseEntry, expense_id, company.id, "ไม่พบรายการรายจ่ายนี้")
    await ensure_reference_not_reconciled(db, company.id, ("expense",), expense_id)
    if obj.status == EntryStatus.cancelled:
        raise HTTPException(400, "รายการนี้ถูกยกเลิกแล้ว")
    if obj.status == EntryStatus.completed:
        await create_cash_transaction(
            db, "expense_cancel", expense_id, CashDirection.IN, obj.net_amount,
            obj.wallet_account_id, obj.holder_id, date.today(),
            f"ยกเลิกรายจ่าย: {obj.description}", current_user.id, company_id=company.id
        )
    obj.status = EntryStatus.cancelled
    await log_activity(db, current_user.id, "delete", "expense", expense_id, f"ยกเลิกรายจ่าย {obj.description}", company_id=company.id)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# PAYABLES ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/payables", response_model=List[PayableOut])
async def list_payables(
    status: Optional[str] = None,
    due_before: Optional[date] = None,
    due_after: Optional[date] = None,
    keyword: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(Payable).where(Payable.company_id == company.id)
    if status:
        q = q.where(Payable.status == status)
    if due_before:
        q = q.where(Payable.due_date <= due_before)
    if due_after:
        q = q.where(Payable.due_date >= due_after)
    if keyword:
        q = q.where(Payable.creditor_name.ilike(f"%{keyword}%"))
    q = q.order_by(Payable.due_date.asc().nulls_last(), Payable.created_at.desc())
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/payables", response_model=PayableOut, status_code=201)
async def create_payable(
    payload: PayableCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    if payload.expected_account_id:
        await get_company_record(
            db, WalletAccount, payload.expected_account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
    if payload.expected_holder_id:
        await get_company_record(
            db, Holder, payload.expected_holder_id, company.id, "ไม่พบ Holder ที่เลือก"
        )
    obj = Payable(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/payables/{payable_id}", response_model=PayableOut)
async def get_payable(
    payable_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    return await get_company_record(db, Payable, payable_id, company.id, "ไม่พบรายการเจ้าหนี้นี้")


@router.patch("/payables/{payable_id}", response_model=PayableOut)
async def update_payable(
    payable_id: str,
    payload: PayableUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Payable, payable_id, company.id, "ไม่พบรายการเจ้าหนี้นี้")
    await ensure_reference_not_reconciled(
        db, company.id, ("payable_payment",), payable_id
    )
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("total_amount") is not None and updates["total_amount"] < obj.paid_amount:
        raise HTTPException(400, "ยอดรวมต้องไม่น้อยกว่ายอดที่จ่ายแล้ว")
    for key, value in updates.items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.post("/payables/{payable_id}/pay", response_model=PayableOut)
async def pay_payable(
    payable_id: str,
    payload: PayablePayment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Payable, payable_id, company.id, "ไม่พบรายการเจ้าหนี้นี้")
    if obj.status in (PayableStatus.paid, PayableStatus.cancelled):
        raise HTTPException(400, "รายการนี้ไม่สามารถจ่ายได้แล้ว")

    remaining = obj.total_amount - obj.paid_amount
    if payload.amount > remaining:
        raise HTTPException(400, f"จำนวนเงินเกินยอดคงค้าง ({remaining:,.2f} บาท)")

    if payload.account_id:
        acc = await get_company_record(
            db, WalletAccount, payload.account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
        if acc.current_balance < payload.amount:
            raise HTTPException(400, f"ยอดเงินในบัญชีไม่เพียงพอ")
    if payload.holder_id:
        holder = await get_company_record(
            db, Holder, payload.holder_id, company.id, "ไม่พบ Holder ที่เลือก"
        )
        if holder.current_balance < payload.amount:
            raise HTTPException(400, "ยอด Holder ไม่เพียงพอ")

    obj.paid_amount = obj.paid_amount + payload.amount

    # Create expense entry
    expense = ExpenseEntry(
        expense_date=payload.paid_date,
        description=f"จ่ายเจ้าหนี้: {obj.creditor_name}",
        amount=payload.amount, net_amount=payload.amount,
        wallet_account_id=payload.account_id,
        holder_id=payload.holder_id,
        status=EntryStatus.completed,
        paid_date=payload.paid_date,
        payable_id=payable_id,
        created_by=current_user.id,
        company_id=company.id,
    )
    db.add(expense)
    await db.flush()

    await create_cash_transaction(
        db, "payable_payment", payable_id, CashDirection.OUT, payload.amount,
        payload.account_id, payload.holder_id, payload.paid_date,
        f"จ่ายเจ้าหนี้: {obj.creditor_name}", current_user.id, company_id=obj.company_id
    )

    await log_activity(db, current_user.id, "pay", "payable", payable_id,
                       f"จ่ายเจ้าหนี้ {obj.creditor_name} จำนวน {payload.amount:,.2f} บาท",
                       company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/payables/{payable_id}", status_code=204)
async def delete_payable(
    payable_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Payable, payable_id, company.id, "ไม่พบรายการเจ้าหนี้นี้")
    if obj.paid_amount > 0:
        raise HTTPException(400, "ไม่สามารถยกเลิกรายการที่มีการชำระแล้ว")
    obj.status = PayableStatus.cancelled
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# RECEIVABLES ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/receivables", response_model=List[ReceivableOut])
async def list_receivables(
    status: Optional[str] = None,
    due_before: Optional[date] = None,
    keyword: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(Receivable).where(Receivable.company_id == company.id)
    if status:
        q = q.where(Receivable.status == status)
    if due_before:
        q = q.where(Receivable.due_date <= due_before)
    if keyword:
        q = q.where(Receivable.debtor_name.ilike(f"%{keyword}%"))
    q = q.order_by(Receivable.due_date.asc().nulls_last(), Receivable.created_at.desc())
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/receivables", response_model=ReceivableOut, status_code=201)
async def create_receivable(
    payload: ReceivableCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    if payload.expected_account_id:
        await get_company_record(
            db, WalletAccount, payload.expected_account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
    if payload.expected_holder_id:
        await get_company_record(
            db, Holder, payload.expected_holder_id, company.id, "ไม่พบ Holder ที่เลือก"
        )
    obj = Receivable(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/receivables/{receivable_id}", response_model=ReceivableOut)
async def get_receivable(
    receivable_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    return await get_company_record(db, Receivable, receivable_id, company.id, "ไม่พบรายการลูกหนี้นี้")


@router.patch("/receivables/{receivable_id}", response_model=ReceivableOut)
async def update_receivable(
    receivable_id: str,
    payload: ReceivableUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Receivable, receivable_id, company.id, "ไม่พบรายการลูกหนี้นี้")
    await ensure_reference_not_reconciled(
        db, company.id, ("receivable_payment",), receivable_id
    )
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("total_amount") is not None and updates["total_amount"] < obj.received_amount:
        raise HTTPException(400, "ยอดรวมต้องไม่น้อยกว่ายอดที่รับแล้ว")
    for key, value in updates.items():
        setattr(obj, key, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.post("/receivables/{receivable_id}/receive", response_model=ReceivableOut)
async def receive_receivable(
    receivable_id: str,
    payload: ReceivablePayment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Receivable, receivable_id, company.id, "ไม่พบรายการลูกหนี้นี้")
    if payload.account_id:
        await get_company_record(
            db, WalletAccount, payload.account_id, company.id, "ไม่พบบัญชีที่เลือก"
        )
    if payload.holder_id:
        await get_company_record(
            db, Holder, payload.holder_id, company.id, "ไม่พบ Holder ที่เลือก"
        )
    if obj.status in (ReceivableStatus.received, ReceivableStatus.cancelled):
        raise HTTPException(400, "รายการนี้ไม่สามารถรับเงินได้แล้ว")

    remaining = obj.total_amount - obj.received_amount
    if payload.amount > remaining:
        raise HTTPException(400, f"จำนวนเงินเกินยอดคงค้าง ({remaining:,.2f} บาท)")

    obj.received_amount = obj.received_amount + payload.amount

    income = IncomeEntry(
        income_date=payload.received_date,
        description=f"รับชำระจากลูกหนี้: {obj.debtor_name}",
        amount=payload.amount, net_amount=payload.amount,
        wallet_account_id=payload.account_id,
        holder_id=payload.holder_id,
        status=EntryStatus.completed,
        received_date=payload.received_date,
        receivable_id=receivable_id,
        created_by=current_user.id,
        company_id=company.id,
    )
    db.add(income)
    await db.flush()

    await create_cash_transaction(
        db, "receivable_payment", receivable_id, CashDirection.IN, payload.amount,
        payload.account_id, payload.holder_id, payload.received_date,
        f"รับจากลูกหนี้: {obj.debtor_name}", current_user.id, company_id=obj.company_id
    )

    await log_activity(db, current_user.id, "receive", "receivable", receivable_id,
                       f"รับจากลูกหนี้ {obj.debtor_name} จำนวน {payload.amount:,.2f} บาท",
                       company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/receivables/{receivable_id}", status_code=204)
async def delete_receivable(
    receivable_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Receivable, receivable_id, company.id, "ไม่พบรายการลูกหนี้นี้")
    if obj.received_amount > 0:
        raise HTTPException(400, "ไม่สามารถยกเลิกรายการที่มีการรับชำระแล้ว")
    obj.status = ReceivableStatus.cancelled
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFERS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/transfers", response_model=List[TransferOut])
async def list_transfers(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    transfer_type: Optional[str] = None,
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(Transfer).where(Transfer.company_id == company.id)
    if start_date:
        q = q.where(Transfer.transfer_date >= start_date)
    if end_date:
        q = q.where(Transfer.transfer_date <= end_date)
    if transfer_type:
        q = q.where(Transfer.transfer_type == transfer_type)
    q = q.order_by(Transfer.transfer_date.desc(), Transfer.created_at.desc()).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/transfers", response_model=TransferOut, status_code=201)
async def create_transfer(
    payload: TransferCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    # Validate source balance
    if payload.from_account_id:
        acc = await get_company_record(
            db, WalletAccount, payload.from_account_id, company.id, "ไม่พบบัญชีต้นทาง"
        )
        if acc.current_balance < payload.amount + payload.fee:
            raise HTTPException(400, f"ยอดเงินในบัญชีต้นทางไม่เพียงพอ (คงเหลือ {acc.current_balance:,.2f} บาท)")
    if payload.from_holder_id:
        holder = await get_company_record(
            db, Holder, payload.from_holder_id, company.id, "ไม่พบ Holder ต้นทาง"
        )
        if holder.current_balance < payload.amount:
            raise HTTPException(400, f"ยอด Holder ต้นทางไม่เพียงพอ (คงเหลือ {holder.current_balance:,.2f} บาท)")
    if payload.to_account_id:
        await get_company_record(db, WalletAccount, payload.to_account_id, company.id, "ไม่พบบัญชีปลายทาง")
    if payload.to_holder_id:
        await get_company_record(db, Holder, payload.to_holder_id, company.id, "ไม่พบ Holder ปลายทาง")

    obj = Transfer(**payload.model_dump(), created_by=current_user.id, company_id=company.id)
    db.add(obj)
    await db.flush()

    total_out = payload.amount + payload.fee

    # Out leg
    await create_cash_transaction(
        db, "transfer", str(obj.id), CashDirection.TRANSFER_OUT, total_out,
        payload.from_account_id, payload.from_holder_id, payload.transfer_date,
        f"โอนออก: {payload.reason or obj.transfer_type}", current_user.id, company_id=company.id
    )
    # In leg
    await create_cash_transaction(
        db, "transfer", str(obj.id), CashDirection.TRANSFER_IN, payload.amount,
        payload.to_account_id, payload.to_holder_id, payload.transfer_date,
        f"โอนเข้า: {payload.reason or obj.transfer_type}", current_user.id, company_id=company.id
    )

    await log_activity(db, current_user.id, "create", "transfer", str(obj.id),
                       f"โอนเงิน {payload.amount:,.2f} บาท", company_id=company.id)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/transfers/{transfer_id}", status_code=204)
async def cancel_transfer(
    transfer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    obj = await get_company_record(db, Transfer, transfer_id, company.id, "ไม่พบรายการโอนเงินนี้")
    await ensure_reference_not_reconciled(db, company.id, ("transfer",), transfer_id)
    if obj.status == EntryStatus.cancelled:
        raise HTTPException(400, "รายการนี้ถูกยกเลิกแล้ว")
    obj.status = EntryStatus.cancelled
    # Reverse transactions
    await create_cash_transaction(
        db, "transfer_cancel", transfer_id, CashDirection.IN, obj.amount + obj.fee,
        obj.from_account_id, obj.from_holder_id, date.today(),
        f"ยกเลิกการโอน (คืนต้นทาง)", current_user.id, company_id=company.id
    )
    await create_cash_transaction(
        db, "transfer_cancel", transfer_id, CashDirection.OUT, obj.amount,
        obj.to_account_id, obj.to_holder_id, date.today(),
        f"ยกเลิกการโอน (ตัดปลายทาง)", current_user.id, company_id=company.id
    )
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# DOCUMENTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

ALLOWED_TYPES = {"image/jpeg", "image/png", "application/pdf",
                 "image/gif", "image/webp",
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "text/csv"}
MAX_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post("/documents/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    reference_type: str = Form(...),
    reference_id: Optional[str] = Form(None),
    doc_type: str = Form("other"),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"ประเภทไฟล์ไม่รองรับ: {file.content_type}")

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 20 MB)")

    safe_reference_type = reference_type.strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,50}", safe_reference_type):
        raise HTTPException(400, "reference_type ไม่ถูกต้อง")
    clean_reference_id = reference_id.strip() if reference_id and reference_id.strip() else None

    ext = os.path.splitext(file.filename or "")[1].lower()
    save_name = f"{uuid.uuid4()}{ext}"
    save_path = os.path.join(
        UPLOAD_DIR, str(company.id), safe_reference_type,
        re.sub(r"[^a-zA-Z0-9_.-]", "_", clean_reference_id or "general"),
    )
    os.makedirs(save_path, exist_ok=True)
    full_path = os.path.join(save_path, save_name)

    with open(full_path, "wb") as f:
        f.write(contents)

    doc = Document(
        reference_type=safe_reference_type,
        reference_id=clean_reference_id,
        file_name=file.filename or save_name,
        file_path=full_path,
        file_type=file.content_type,
        file_size=len(contents),
        doc_type=doc_type,
        description=description,
        uploaded_by=current_user.id,
        company_id=company.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return {"id": doc.id, "file_name": doc.file_name, "file_type": doc.file_type,
            "file_size": doc.file_size, "doc_type": doc.doc_type, "created_at": doc.created_at}


@router.get("/documents/{reference_type}/{reference_id}")
async def get_documents(
    reference_type: str,
    reference_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(Document).where(
        Document.company_id == company.id,
        Document.reference_type == reference_type,
        Document.reference_id == reference_id
    ).order_by(Document.created_at.desc())
    result = await db.execute(q)
    docs = result.scalars().all()
    return [{"id": d.id, "file_name": d.file_name, "file_type": d.file_type,
             "file_size": d.file_size, "doc_type": d.doc_type, "description": d.description,
             "created_at": d.created_at} for d in docs]


@router.get("/documents")
async def list_documents(
    limit: int = 200,
    reference_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    from app.models.user import User as UserModel
    q = select(Document, UserModel.username).join(
        UserModel, Document.uploaded_by == UserModel.id, isouter=True
    ).where(Document.company_id == company.id).order_by(Document.created_at.desc()).limit(limit)
    if reference_type:
        q = q.where(Document.reference_type == reference_type)
    result = await db.execute(q)
    rows = result.all()
    return [{"id": d.id, "reference_type": d.reference_type, "reference_id": d.reference_id,
             "file_name": d.file_name, "file_type": d.file_type, "mime_type": d.file_type,
             "file_size": d.file_size, "doc_type": d.doc_type, "description": d.description,
             "uploaded_by": d.uploaded_by, "uploaded_by_name": uname,
             "created_at": d.created_at} for d, uname in rows]


@router.get("/documents/{doc_id}/download")
async def download_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    doc = await get_company_record(db, Document, doc_id, company.id, "ไม่พบไฟล์นี้")
    if not os.path.exists(doc.file_path):
        raise HTTPException(404, "ไม่พบไฟล์นี้")
    return FileResponse(doc.file_path, filename=doc.file_name, media_type=doc.file_type or "application/octet-stream")


@router.post("/documents/{doc_id}/extract")
async def extract_document_data(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    """อ่านภาพใบเสร็จ/ใบกำกับภาษีด้วย local vision model (Ollama) แล้วดึงข้อมูลออกมา
    ให้ frontend เอาไป pre-fill ฟอร์มรายรับ/รายจ่าย — รันในเครื่อง host ไม่มีค่าใช้จ่ายต่อครั้ง"""
    doc = await get_company_record(db, Document, doc_id, company.id, "ไม่พบเอกสารนี้")
    if not doc.file_type or not doc.file_type.startswith("image/"):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ภาพ (JPEG/PNG/WEBP) สำหรับการอ่านข้อมูลอัตโนมัติ")
    if not os.path.exists(doc.file_path):
        raise HTTPException(404, "ไม่พบไฟล์นี้บนเซิร์ฟเวอร์")

    try:
        extracted = await extract_receipt_data(doc.file_path)
    except OcrServiceError as exc:
        raise HTTPException(502, str(exc))

    return {"document_id": doc.id, "extracted": extracted}


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    doc = await get_company_record(db, Document, doc_id, company.id, "ไม่พบเอกสารนี้")
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    await db.delete(doc)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# CASHFLOW DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/cashflow-dashboard")
async def get_cashflow_dashboard(
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    today = date.today()
    # "This month" metrics are selectable via ?month=&year= (default: current month).
    # Real-time sections (balances, overdue, upcoming) always use `today`.
    if month and year:
        period_start = date(year, month, 1)
        period_end = (date(year, 12, 31) if month == 12
                      else date(year, month + 1, 1) - timedelta(days=1))
        if year == today.year and month == today.month:
            period_end = today  # don't count future days of the current month
    else:
        period_start = today.replace(day=1)
        period_end = today
    year_start = today.replace(month=1, day=1)

    # Total balances
    acc_result = await db.execute(select(
        func.sum(WalletAccount.current_balance).label("total"),
        func.sum(
            case((WalletAccount.owner_type == "company", WalletAccount.current_balance), else_=0)
        ).label("company"),
        func.sum(
            case((WalletAccount.owner_type == "personal", WalletAccount.current_balance), else_=0)
        ).label("personal"),
    ).where(WalletAccount.is_active == True, WalletAccount.company_id == company.id))
    balances = acc_result.first()

    # Income this month
    inc_result = await db.execute(select(func.sum(IncomeEntry.net_amount)).where(
        IncomeEntry.status == "completed",
        IncomeEntry.income_date >= period_start,
        IncomeEntry.income_date <= period_end,
        IncomeEntry.company_id == company.id,
    ))
    income_month = inc_result.scalar() or Decimal("0")

    # Expense this month
    exp_result = await db.execute(select(func.sum(ExpenseEntry.net_amount)).where(
        ExpenseEntry.status == "completed",
        ExpenseEntry.expense_date >= period_start,
        ExpenseEntry.expense_date <= period_end,
        ExpenseEntry.company_id == company.id,
    ))
    expense_month = exp_result.scalar() or Decimal("0")

    # Payables outstanding
    pay_result = await db.execute(select(
        func.count(Payable.id).label("count"),
        func.sum(Payable.total_amount - Payable.paid_amount).label("total")
    ).where(Payable.status.in_(["unpaid", "partial", "overdue"]), Payable.company_id == company.id))
    payable_data = pay_result.first()

    # Receivables outstanding
    rec_result = await db.execute(select(
        func.count(Receivable.id).label("count"),
        func.sum(Receivable.total_amount - Receivable.received_amount).label("total")
    ).where(Receivable.status.in_(["unreceived", "partial", "overdue"]), Receivable.company_id == company.id))
    receivable_data = rec_result.first()

    # Overdue payables
    overdue_pay = await db.execute(select(Payable).where(
        Payable.company_id == company.id,
        Payable.due_date < today,
        Payable.status.in_(["unpaid", "partial"])
    ).order_by(Payable.due_date).limit(10))
    overdue_payables = overdue_pay.scalars().all()

    # Overdue receivables
    overdue_rec = await db.execute(select(Receivable).where(
        Receivable.company_id == company.id,
        Receivable.due_date < today,
        Receivable.status.in_(["unreceived", "partial"])
    ).order_by(Receivable.due_date).limit(10))
    overdue_receivables = overdue_rec.scalars().all()

    # Due in 7 days
    seven_days = today + timedelta(days=7)
    upcoming_pay = await db.execute(select(Payable).where(
        Payable.company_id == company.id,
        Payable.due_date >= today,
        Payable.due_date <= seven_days,
        Payable.status.in_(["unpaid", "partial"])
    ).order_by(Payable.due_date).limit(10))
    upcoming_payables = upcoming_pay.scalars().all()

    upcoming_rec = await db.execute(select(Receivable).where(
        Receivable.company_id == company.id,
        Receivable.due_date >= today,
        Receivable.due_date <= seven_days,
        Receivable.status.in_(["unreceived", "partial"])
    ).order_by(Receivable.due_date).limit(10))
    upcoming_receivables = upcoming_rec.scalars().all()

    # Accounts list
    acc_list = await db.execute(select(WalletAccount).where(
        WalletAccount.is_active == True, WalletAccount.company_id == company.id)
                                 .order_by(WalletAccount.owner_type, WalletAccount.name))
    accounts = acc_list.scalars().all()

    # Holders list
    holder_list = await db.execute(select(Holder).where(
        Holder.is_active == True, Holder.company_id == company.id)
                                    .order_by(Holder.holder_type, Holder.name))
    holders = holder_list.scalars().all()

    # Monthly chart (last 6 months)
    monthly_chart = []
    for i in range(5, -1, -1):
        m_date = (period_start - timedelta(days=i * 28)).replace(day=1)
        m_end = (m_date.replace(month=m_date.month % 12 + 1, day=1) - timedelta(days=1)
                 if m_date.month < 12 else m_date.replace(month=12, day=31))
        inc_m = await db.execute(select(func.sum(IncomeEntry.net_amount)).where(
            IncomeEntry.status == "completed",
            IncomeEntry.income_date >= m_date, IncomeEntry.income_date <= m_end,
            IncomeEntry.company_id == company.id,
        ))
        exp_m = await db.execute(select(func.sum(ExpenseEntry.net_amount)).where(
            ExpenseEntry.status == "completed",
            ExpenseEntry.expense_date >= m_date, ExpenseEntry.expense_date <= m_end,
            ExpenseEntry.company_id == company.id,
        ))
        monthly_chart.append({
            "month": f"{m_date.month}/{m_date.year}",
            "income": float(inc_m.scalar() or 0),
            "expense": float(exp_m.scalar() or 0),
        })

    # Expense by category (this month)
    cat_result = await db.execute(
        select(CashflowCategory.name, func.sum(ExpenseEntry.net_amount).label("total"))
        .join(ExpenseEntry, CashflowCategory.id == ExpenseEntry.category_id, isouter=True)
        .where(
            ExpenseEntry.status == "completed",
            ExpenseEntry.expense_date >= period_start,
            ExpenseEntry.expense_date <= period_end,
            ExpenseEntry.company_id == company.id,
        )
        .group_by(CashflowCategory.name)
        .order_by(func.sum(ExpenseEntry.net_amount).desc())
        .limit(10)
    )
    expense_by_category = [{"name": r.name, "total": float(r.total or 0)} for r in cat_result]

    return {
        "summary": {
            "total_balance": float(balances.total or 0),
            "company_balance": float(balances.company or 0),
            "personal_balance": float(balances.personal or 0),
            "income_this_month": float(income_month),
            "expense_this_month": float(expense_month),
            "profit_this_month": float(income_month - expense_month),
            "total_payable": float(payable_data.total or 0),
            "payable_count": payable_data.count or 0,
            "total_receivable": float(receivable_data.total or 0),
            "receivable_count": receivable_data.count or 0,
        },
        "accounts": [
            {"id": a.id, "name": a.name, "account_type": a.account_type,
             "owner_type": a.owner_type, "current_balance": float(a.current_balance)}
            for a in accounts
        ],
        "holders": [
            {"id": h.id, "name": h.name, "holder_type": h.holder_type,
             "current_balance": float(h.current_balance)}
            for h in holders
        ],
        "overdue_payables": [
            {"id": p.id, "creditor_name": p.creditor_name, "due_date": p.due_date,
             "remaining_amount": float(p.total_amount - p.paid_amount)}
            for p in overdue_payables
        ],
        "overdue_receivables": [
            {"id": r.id, "debtor_name": r.debtor_name, "due_date": r.due_date,
             "remaining_amount": float(r.total_amount - r.received_amount)}
            for r in overdue_receivables
        ],
        "upcoming_payables": [
            {"id": p.id, "creditor_name": p.creditor_name, "due_date": p.due_date,
             "remaining_amount": float(p.total_amount - p.paid_amount)}
            for p in upcoming_payables
        ],
        "upcoming_receivables": [
            {"id": r.id, "debtor_name": r.debtor_name, "due_date": r.due_date,
             "remaining_amount": float(r.total_amount - r.received_amount)}
            for r in upcoming_receivables
        ],
        "monthly_chart": monthly_chart,
        "expense_by_category": expense_by_category,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PAYMENT SCHEDULE (กำหนดการจ่าย / รับเงิน)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/payment-schedule")
async def get_payment_schedule(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    today = date.today()
    s = start_date or today
    e = end_date or (today + timedelta(days=30))

    # Payables due in range
    pay_result = await db.execute(select(Payable).where(
        Payable.company_id == company.id,
        Payable.due_date >= s, Payable.due_date <= e,
        Payable.status.in_(["unpaid", "partial", "overdue"])
    ).order_by(Payable.due_date))
    payables = pay_result.scalars().all()

    # Receivables due in range
    rec_result = await db.execute(select(Receivable).where(
        Receivable.company_id == company.id,
        Receivable.due_date >= s, Receivable.due_date <= e,
        Receivable.status.in_(["unreceived", "partial", "overdue"])
    ).order_by(Receivable.due_date))
    receivables = rec_result.scalars().all()

    # Pending expenses due in range
    exp_result = await db.execute(select(ExpenseEntry).where(
        ExpenseEntry.company_id == company.id,
        ExpenseEntry.expense_date >= s, ExpenseEntry.expense_date <= e,
        ExpenseEntry.status == "pending"
    ).order_by(ExpenseEntry.expense_date))
    expenses = exp_result.scalars().all()

    # Pending incomes due in range
    inc_result = await db.execute(select(IncomeEntry).where(
        IncomeEntry.company_id == company.id,
        IncomeEntry.income_date >= s, IncomeEntry.income_date <= e,
        IncomeEntry.status == "pending"
    ).order_by(IncomeEntry.income_date))
    incomes = inc_result.scalars().all()

    schedule = []
    for p in payables:
        schedule.append({
            "date": p.due_date, "type": "payable", "direction": "out",
            "id": p.id, "name": p.creditor_name,
            "amount": float(p.total_amount - p.paid_amount),
            "status": p.status, "overdue": p.due_date < today if p.due_date else False
        })
    for r in receivables:
        schedule.append({
            "date": r.due_date, "type": "receivable", "direction": "in",
            "id": r.id, "name": r.debtor_name,
            "amount": float(r.total_amount - r.received_amount),
            "status": r.status, "overdue": r.due_date < today if r.due_date else False
        })
    for e in expenses:
        schedule.append({
            "date": e.expense_date, "type": "expense", "direction": "out",
            "id": e.id, "name": e.vendor_name or e.description[:50],
            "amount": float(e.net_amount), "status": e.status, "overdue": False
        })
    for i in incomes:
        schedule.append({
            "date": i.income_date, "type": "income", "direction": "in",
            "id": i.id, "name": i.customer_name or i.description[:50],
            "amount": float(i.net_amount), "status": i.status, "overdue": False
        })

    schedule.sort(key=lambda x: x["date"] or date.max)
    return {"schedule": schedule, "start_date": s, "end_date": e}


# ═══════════════════════════════════════════════════════════════════════════════
# ACTIVITY LOGS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/activity-logs")
async def get_activity_logs(
    resource_type: Optional[str] = None,
    user_id: Optional[int] = None,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    q = select(ActivityLog).where(ActivityLog.company_id == company.id)
    if resource_type:
        q = q.where(ActivityLog.resource_type == resource_type)
    if user_id:
        q = q.where(ActivityLog.user_id == user_id)
    q = q.order_by(ActivityLog.created_at.desc()).limit(limit)
    result = await db.execute(q)
    logs = result.scalars().all()
    return [{"id": l.id, "user_id": l.user_id, "action": l.action,
             "resource_type": l.resource_type, "resource_id": l.resource_id,
             "description": l.description, "created_at": l.created_at} for l in logs]


# ═══════════════════════════════════════════════════════════════════════════════
# CASHFLOW REPORTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/cashflow-report")
async def get_cashflow_report(
    start_date: date,
    end_date: date,
    report_type: str = "summary",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    """สร้างรายงาน: summary, income, expense, profit_loss, account_balance"""

    if report_type == "profit_loss":
        inc = await db.execute(select(func.sum(IncomeEntry.net_amount)).where(
            IncomeEntry.status == "completed",
            IncomeEntry.company_id == company.id,
            IncomeEntry.income_date >= start_date, IncomeEntry.income_date <= end_date
        ))
        exp = await db.execute(select(func.sum(ExpenseEntry.net_amount)).where(
            ExpenseEntry.status == "completed",
            ExpenseEntry.company_id == company.id,
            ExpenseEntry.expense_date >= start_date, ExpenseEntry.expense_date <= end_date
        ))
        total_income = float(inc.scalar() or 0)
        total_expense = float(exp.scalar() or 0)

        # By category
        inc_cat = await db.execute(
            select(CashflowCategory.name, func.sum(IncomeEntry.net_amount).label("total"))
            .join(IncomeEntry, CashflowCategory.id == IncomeEntry.category_id, isouter=True)
            .where(IncomeEntry.status == "completed", IncomeEntry.company_id == company.id,
                   IncomeEntry.income_date >= start_date, IncomeEntry.income_date <= end_date)
            .group_by(CashflowCategory.name).order_by(func.sum(IncomeEntry.net_amount).desc())
        )
        exp_cat = await db.execute(
            select(CashflowCategory.name, func.sum(ExpenseEntry.net_amount).label("total"))
            .join(ExpenseEntry, CashflowCategory.id == ExpenseEntry.category_id, isouter=True)
            .where(ExpenseEntry.status == "completed", ExpenseEntry.company_id == company.id,
                   ExpenseEntry.expense_date >= start_date, ExpenseEntry.expense_date <= end_date)
            .group_by(CashflowCategory.name).order_by(func.sum(ExpenseEntry.net_amount).desc())
        )

        return {
            "report_type": "profit_loss",
            "start_date": start_date, "end_date": end_date,
            "total_income": total_income,
            "total_expense": total_expense,
            "profit": total_income - total_expense,
            "income_by_category": [{"name": r.name, "total": float(r.total or 0)} for r in inc_cat],
            "expense_by_category": [{"name": r.name, "total": float(r.total or 0)} for r in exp_cat],
        }

    if report_type == "account_balance":
        acc_result = await db.execute(
            select(WalletAccount).where(WalletAccount.is_active == True, WalletAccount.company_id == company.id)
            .order_by(WalletAccount.owner_type, WalletAccount.name)
        )
        accounts = acc_result.scalars().all()
        holder_result = await db.execute(
            select(Holder).where(Holder.is_active == True, Holder.company_id == company.id).order_by(Holder.name)
        )
        holders = holder_result.scalars().all()
        return {
            "report_type": "account_balance",
            "as_of_date": end_date,
            "accounts": [{"id": a.id, "name": a.name, "type": a.account_type,
                          "owner_type": a.owner_type, "balance": float(a.current_balance)} for a in accounts],
            "holders": [{"id": h.id, "name": h.name, "type": h.holder_type,
                         "balance": float(h.current_balance)} for h in holders],
            "total_account_balance": float(sum(a.current_balance for a in accounts)),
            "total_holder_balance": float(sum(h.current_balance for h in holders)),
        }

    # Default: summary
    inc = await db.execute(select(
        func.count(IncomeEntry.id), func.sum(IncomeEntry.net_amount)
    ).where(IncomeEntry.status == "completed", IncomeEntry.company_id == company.id,
            IncomeEntry.income_date >= start_date, IncomeEntry.income_date <= end_date))
    exp = await db.execute(select(
        func.count(ExpenseEntry.id), func.sum(ExpenseEntry.net_amount)
    ).where(ExpenseEntry.status == "completed", ExpenseEntry.company_id == company.id,
            ExpenseEntry.expense_date >= start_date, ExpenseEntry.expense_date <= end_date))
    pay = await db.execute(select(
        func.count(Payable.id),
        func.sum(Payable.total_amount - Payable.paid_amount)
    ).where(Payable.company_id == company.id, Payable.status.in_(["unpaid", "partial", "overdue"])))
    rec = await db.execute(select(
        func.count(Receivable.id),
        func.sum(Receivable.total_amount - Receivable.received_amount)
    ).where(Receivable.company_id == company.id, Receivable.status.in_(["unreceived", "partial", "overdue"])))

    inc_r, inc_s = inc.first()
    exp_r, exp_s = exp.first()
    pay_r, pay_s = pay.first()
    rec_r, rec_s = rec.first()

    return {
        "report_type": "summary",
        "start_date": start_date, "end_date": end_date,
        "income": {"count": inc_r or 0, "total": float(inc_s or 0)},
        "expense": {"count": exp_r or 0, "total": float(exp_s or 0)},
        "profit": float((inc_s or 0) - (exp_s or 0)),
        "outstanding_payable": {"count": pay_r or 0, "total": float(pay_s or 0)},
        "outstanding_receivable": {"count": rec_r or 0, "total": float(rec_s or 0)},
    }


# ═══════════════════════════════════════════════════════════════════════════════
# BUDGET MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

class BudgetIn(BaseModel):
    name: str
    budget_type: Literal["expense", "income", "overall"] = "expense"
    category_id: Optional[int] = None
    period_type: Literal["monthly", "quarterly", "yearly", "custom"] = "monthly"
    start_date: date
    end_date: date
    amount: condecimal(gt=0, max_digits=15, decimal_places=2)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.end_date < self.start_date:
            raise ValueError("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น")
        return self

class BudgetOut(BaseModel):
    id: int
    name: str
    budget_type: str
    category_id: Optional[int]
    period_type: str
    start_date: date
    end_date: date
    amount: float
    notes: Optional[str]
    is_active: bool
    spent_amount: float = 0.0
    remaining: float = 0.0
    usage_pct: float = 0.0
    model_config = {"from_attributes": True}

@router.get("/budgets")
async def list_budgets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        text("""
            SELECT * FROM budgets
            WHERE is_active = TRUE AND company_id = :company_id
            ORDER BY start_date DESC
        """),
        {"company_id": company.id},
    )
    rows = result.mappings().all()
    budgets = []
    for r in rows:
        # calc spent from expense_entries in the period
        category_clause = "AND category_id = :category_id" if r["category_id"] is not None else ""
        spent_q = await db.execute(text(f"""
            SELECT COALESCE(SUM(net_amount),0) FROM expense_entries
            WHERE status='completed'
            AND company_id = :company_id
            AND expense_date >= :start_date AND expense_date <= :end_date
            {category_clause}
        """), {
            "company_id": company.id,
            "start_date": r["start_date"],
            "end_date": r["end_date"],
            "category_id": r["category_id"],
        })
        spent = float(spent_q.scalar() or 0)
        amt = float(r['amount'])
        budgets.append({
            "id": r['id'], "name": r['name'], "budget_type": r['budget_type'],
            "category_id": r['category_id'], "period_type": r['period_type'],
            "start_date": r['start_date'], "end_date": r['end_date'],
            "amount": amt, "notes": r['notes'], "is_active": r['is_active'],
            "spent_amount": spent,
            "remaining": amt - spent,
            "usage_pct": round((spent / amt * 100) if amt > 0 else 0, 1),
        })
    return budgets

@router.post("/budgets", status_code=201)
async def create_budget(
    payload: BudgetIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(text("""
        INSERT INTO budgets (name, budget_type, category_id, period_type, start_date, end_date, amount, notes, company_id)
        VALUES (:name, :budget_type, :category_id, :period_type, :start_date, :end_date, :amount, :notes, :company_id)
        RETURNING *
    """), {"name": payload.name, "budget_type": payload.budget_type,
           "category_id": payload.category_id, "period_type": payload.period_type,
           "start_date": payload.start_date, "end_date": payload.end_date,
           "amount": payload.amount, "notes": payload.notes, "company_id": company.id})
    row = result.mappings().one()
    await db.commit()
    return dict(row)

@router.patch("/budgets/{budget_id}")
async def update_budget(
    budget_id: int,
    payload: BudgetIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(text("""
        UPDATE budgets SET name=:name, budget_type=:budget_type, category_id=:category_id,
        period_type=:period_type, start_date=:start_date, end_date=:end_date,
        amount=:amount, notes=:notes, updated_at=NOW()
        WHERE id=:id AND company_id=:company_id
        RETURNING *
    """), {"id": budget_id, "company_id": company.id,
           "name": payload.name, "budget_type": payload.budget_type,
           "category_id": payload.category_id, "period_type": payload.period_type,
           "start_date": payload.start_date, "end_date": payload.end_date,
           "amount": payload.amount, "notes": payload.notes})
    row = result.mappings().first()
    if not row:
        raise HTTPException(404, "ไม่พบงบประมาณนี้")
    await db.commit()
    return dict(row)

@router.delete("/budgets/{budget_id}", status_code=204)
async def delete_budget(
    budget_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        text("""
            UPDATE budgets SET is_active=FALSE, updated_at=NOW()
            WHERE id=:id AND company_id=:company_id
        """),
        {"id": budget_id, "company_id": company.id},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "ไม่พบงบประมาณนี้")
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# COMPANY SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

class SettingsUpdate(BaseModel):
    company_name: Optional[str] = None
    company_name_en: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    fiscal_year_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    default_currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    vat_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    crm_kawin_is_active: Optional[bool] = None
    crm_kawin_base_url: Optional[str] = None
    crm_kawin_orders_path: Optional[str] = None
    crm_kawin_api_token: Optional[str] = None
    crm_kawin_external_company_id: Optional[str] = None


async def _get_crm_kawin_integration(
    db: AsyncSession,
    company_id: int,
) -> CompanyIntegration | None:
    result = await db.execute(
        select(CompanyIntegration).where(
            CompanyIntegration.company_id == company_id,
            CompanyIntegration.provider == "crm_kawin",
        )
    )
    return result.scalar_one_or_none()


@router.get("/settings")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    crm_integration = await _get_crm_kawin_integration(db, company.id)
    # Return company fields as settings dict
    return {
        "company_name": company.name_th,
        "company_name_en": company.name_en,
        "tax_id": company.tax_id,
        "address": company.address,
        "phone": company.phone,
        "email": company.email,
        "website": company.website,
        "fiscal_year_start_month": company.fiscal_year_start_month,
        "default_currency": company.default_currency,
        "vat_rate": float(company.vat_rate),
        "crm_kawin_is_active": bool(crm_integration.is_active) if crm_integration else False,
        "crm_kawin_base_url": crm_integration.base_url if crm_integration else "",
        "crm_kawin_orders_path": (
            crm_integration.orders_path
            if crm_integration and crm_integration.orders_path
            else "/api/accounting/get_list_order.php"
        ),
        "crm_kawin_api_token_configured": bool(crm_integration and crm_integration.api_token),
        "crm_kawin_external_company_id": crm_integration.external_company_id if crm_integration else "",
    }

@router.patch("/settings")
async def update_settings(
    payload: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    integration_keys = {
        "crm_kawin_is_active",
        "crm_kawin_base_url",
        "crm_kawin_orders_path",
        "crm_kawin_api_token",
        "crm_kawin_external_company_id",
    }
    payload_data = payload.model_dump(exclude_unset=True)
    field_map = {
        "company_name": "name_th", "company_name_en": "name_en",
        "tax_id": "tax_id", "address": "address", "phone": "phone",
        "email": "email", "website": "website",
        "fiscal_year_start_month": "fiscal_year_start_month",
        "default_currency": "default_currency", "vat_rate": "vat_rate",
    }
    for key, value in payload_data.items():
        if key in integration_keys:
            continue
        db_field = field_map.get(key, key)
        if hasattr(company, db_field) and db_field not in ("id", "code", "created_at"):
            setattr(company, db_field, value)

    if integration_keys.intersection(payload_data):
        crm_integration = await _get_crm_kawin_integration(db, company.id)
        if not crm_integration:
            crm_integration = CompanyIntegration(
                company_id=company.id,
                provider="crm_kawin",
                orders_path="/api/accounting/get_list_order.php",
            )
            db.add(crm_integration)

        if "crm_kawin_is_active" in payload_data:
            crm_integration.is_active = bool(payload.crm_kawin_is_active)
        if "crm_kawin_base_url" in payload_data:
            crm_integration.base_url = (payload.crm_kawin_base_url or "").strip() or None
        if "crm_kawin_orders_path" in payload_data:
            crm_integration.orders_path = (
                (payload.crm_kawin_orders_path or "").strip()
                or "/api/accounting/get_list_order.php"
            )
        if "crm_kawin_external_company_id" in payload_data:
            crm_integration.external_company_id = (
                (payload.crm_kawin_external_company_id or "").strip() or None
            )
        if payload.crm_kawin_api_token:
            crm_integration.api_token = payload.crm_kawin_api_token.strip()

    await db.commit()
    await db.refresh(company)
    crm_integration = await _get_crm_kawin_integration(db, company.id)
    return {
        "company_name": company.name_th, "company_name_en": company.name_en,
        "tax_id": company.tax_id, "address": company.address,
        "phone": company.phone, "email": company.email, "website": company.website,
        "fiscal_year_start_month": company.fiscal_year_start_month,
        "default_currency": company.default_currency, "vat_rate": float(company.vat_rate),
        "crm_kawin_is_active": bool(crm_integration.is_active) if crm_integration else False,
        "crm_kawin_base_url": crm_integration.base_url if crm_integration else "",
        "crm_kawin_orders_path": (
            crm_integration.orders_path
            if crm_integration and crm_integration.orders_path
            else "/api/accounting/get_list_order.php"
        ),
        "crm_kawin_api_token_configured": bool(crm_integration and crm_integration.api_token),
        "crm_kawin_external_company_id": crm_integration.external_company_id if crm_integration else "",
    }
