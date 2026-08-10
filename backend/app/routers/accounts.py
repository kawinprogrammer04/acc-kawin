from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import cast, select, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_company, require_accountant, require_admin, require_viewer
from app.models.account import Account
from app.models.company import Company
from app.models.user import User
from app.schemas.account import AccountCreate, AccountOut, AccountTree, AccountUpdate

router = APIRouter(prefix="/accounts", tags=["Chart of Accounts"])


@router.get("", response_model=list[AccountOut])
async def list_accounts(
    account_type: str | None = Query(None, description="กรองตามประเภท: asset, liability, equity, revenue, expense"),
    is_active: bool | None = Query(None),
    is_header: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    stmt = select(Account).where(Account.company_id == company.id).order_by(Account.code)
    if account_type:
        stmt = stmt.where(cast(Account.account_type, String) == account_type)
    if is_active is not None:
        stmt = stmt.where(Account.is_active == is_active)
    if is_header is not None:
        stmt = stmt.where(Account.is_header == is_header)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/tree", response_model=list[AccountTree])
async def get_account_tree(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    """ดึงผังบัญชีแบบ Tree (parent → children)"""
    result = await db.execute(
        select(Account)
        .options(selectinload(Account.children))
        .where(Account.company_id == company.id)
        .order_by(Account.code)
    )
    all_accounts = result.scalars().all()

    # Return only root accounts; children are nested via relationship
    roots = [a for a in all_accounts if a.parent_id is None]

    def build_tree(account: Account) -> AccountTree:
        node = AccountTree.model_validate(account)
        node.children = [build_tree(c) for c in sorted(account.children, key=lambda x: x.code)]
        return node

    return [build_tree(r) for r in roots]


@router.get("/postable", response_model=list[AccountOut])
async def get_postable_accounts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    """บัญชีที่ Post ได้ (is_header=False, is_active=True)"""
    result = await db.execute(
        select(Account)
        .where(
            Account.company_id == company.id,
            Account.is_header == False,
            Account.is_active == True,
        )  # noqa: E712
        .order_by(Account.code)
    )
    return result.scalars().all()


@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    account = (await db.execute(
        select(Account).where(Account.id == account_id, Account.company_id == company.id)
    )).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีนี้")
    return account


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    existing = await db.execute(
        select(Account).where(Account.code == payload.code, Account.company_id == company.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"รหัสบัญชี {payload.code} มีอยู่แล้ว")

    if payload.parent_id:
        parent = (await db.execute(
            select(Account).where(
                Account.id == payload.parent_id,
                Account.company_id == company.id,
            )
        )).scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=400, detail="ไม่พบบัญชีแม่")
        if not parent.is_header:
            raise HTTPException(status_code=400, detail="บัญชีแม่ต้องเป็น Header Account")

    account = Account(**payload.model_dump(), company_id=company.id)
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    account = (await db.execute(
        select(Account).where(Account.id == account_id, Account.company_id == company.id)
    )).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีนี้")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(account, field, value)

    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
    company: Company = Depends(get_current_company),
):
    account = (await db.execute(
        select(Account).where(Account.id == account_id, Account.company_id == company.id)
    )).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีนี้")

    # ตรวจว่ามีบรรทัดรายการใช้บัญชีนี้หรือไม่
    from app.models.journal import JournalLine
    used = await db.execute(select(JournalLine).where(JournalLine.account_id == account_id).limit(1))
    if used.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีที่มีรายการบันทึกแล้ว")

    # Soft delete
    account.is_active = False
    await db.commit()
