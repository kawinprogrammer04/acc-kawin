from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import cast, select, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_company, require_accountant, require_approver, require_viewer
from app.models.company import Company
from app.models.invoice import Invoice, InvoiceLine
from app.models.user import User
from app.schemas.invoice import InvoiceCreate, InvoiceOut, VatCalculation
from app.services.invoice_service import (
    calculate_vat,
    create_invoice,
    post_invoice_to_journal,
)

router = APIRouter(prefix="/invoices", tags=["Invoices"])


def _to_out(invoice: Invoice) -> InvoiceOut:
    out = InvoiceOut.model_validate(invoice)
    out.party_name = invoice.party.name_th if invoice.party else None
    out.balance_due = Decimal(str(invoice.balance_due))
    return out


@router.get("", response_model=list[InvoiceOut])
async def list_invoices(
    invoice_type: str | None = Query(None, description="ar หรือ ap"),
    status: str | None = Query(None),
    party_id: str | None = Query(None),
    period_id: int | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.lines), selectinload(Invoice.party))
        .where(Invoice.company_id == company.id)
        .order_by(Invoice.invoice_date.desc())
        .limit(limit)
        .offset(offset)
    )
    if invoice_type:
        stmt = stmt.where(cast(Invoice.invoice_type, String) == invoice_type)
    if status:
        stmt = stmt.where(cast(Invoice.status, String) == status)
    if party_id:
        stmt = stmt.where(Invoice.party_id == party_id)
    if period_id:
        stmt = stmt.where(Invoice.period_id == period_id)

    result = await db.execute(stmt)
    return [_to_out(inv) for inv in result.scalars().all()]


@router.get("/calculate-vat", response_model=VatCalculation)
async def preview_vat(
    amount: Decimal = Query(..., description="จำนวนเงิน"),
    inclusive: bool = Query(False, description="True = ราคารวม VAT แล้ว"),
    vat_rate: Decimal = Query(Decimal("7"), description="อัตรา VAT (%)"),
    _: User = Depends(require_viewer),
):
    """คำนวณ VAT โดยไม่บันทึก — ใช้สำหรับแสดง preview บน UI"""
    return calculate_vat(amount, inclusive=inclusive, rate=vat_rate)


@router.get("/{invoice_id}", response_model=InvoiceOut)
async def get_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.lines), selectinload(Invoice.party))
        .where(Invoice.id == invoice_id, Invoice.company_id == company.id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="ไม่พบ Invoice")
    return _to_out(invoice)


@router.post("", response_model=InvoiceOut, status_code=201)
async def create_invoice_endpoint(
    payload: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    try:
        invoice = await create_invoice(db, payload, current_user.id, company.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.lines), selectinload(Invoice.party))
        .where(Invoice.id == invoice.id, Invoice.company_id == company.id)
    )
    return _to_out(result.scalar_one())


@router.post("/{invoice_id}/post", response_model=dict)
async def post_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_approver),
    company: Company = Depends(get_current_company),
):
    """Post Invoice → สร้าง Journal Entry + VAT/WHT Records อัตโนมัติ"""
    try:
        journal = await post_invoice_to_journal(db, invoice_id, current_user.id, company.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "message": "Post Invoice สำเร็จ",
        "journal_id": journal.id,
        "entry_number": journal.entry_number,
    }


@router.patch("/{invoice_id}/void", response_model=InvoiceOut)
async def void_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_approver),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.lines), selectinload(Invoice.party))
        .where(Invoice.id == invoice_id, Invoice.company_id == company.id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="ไม่พบ Invoice")
    if invoice.status in ("paid", "voided"):
        raise HTTPException(status_code=400, detail=f"ไม่สามารถ Void Invoice ที่มีสถานะ: {invoice.status}")

    invoice.status = "voided"
    await db.commit()
    await db.refresh(invoice)
    return _to_out(invoice)
