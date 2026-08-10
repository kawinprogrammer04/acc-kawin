from __future__ import annotations

from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.dependencies import get_current_company, require_accountant
from app.models.company import Company, CompanyIntegration
from app.models.tax import TaxInvoiceRecord, TaxInvoiceRecordLine
from app.models.user import User
from app.schemas.tax_invoice import (
    CrmOrderLookupRequest,
    CrmOrderLookupResponse,
    TaxInvoiceExportRequest,
    TaxInvoiceSaveRequest,
    TaxInvoiceSaveResponse,
)
from app.services.crm_kawin import CrmKawinConfig, lookup_crm_orders
from app.services.tax_invoice_template import (
    build_tax_invoice_pdf,
    build_tax_invoice_xlsx,
    convert_pdf_first_page_to_png,
)

router = APIRouter(prefix="/tax-invoices", tags=["Tax Invoices"])


def _calculate_totals(document):
    subtotal = sum(line.quantity * line.unit_price for line in document.lines)
    taxable_amount = max(subtotal - document.discount_amount, 0)
    vat_amount = taxable_amount * document.vat_rate / 100
    total_amount = taxable_amount + vat_amount
    return subtotal, taxable_amount, vat_amount, total_amount


async def _next_tax_invoice_number(
    db: AsyncSession,
    company_id: int,
    invoice_date: date,
) -> str:
    prefix = f"INV-{invoice_date.year}-"
    result = await db.execute(
        select(TaxInvoiceRecord.invoice_number).where(
            TaxInvoiceRecord.company_id == company_id,
            TaxInvoiceRecord.invoice_number.like(f"{prefix}%"),
        )
    )
    max_sequence = 0
    for invoice_number in result.scalars():
        suffix = invoice_number.removeprefix(prefix)
        if suffix.isdigit():
            max_sequence = max(max_sequence, int(suffix))
    return f"{prefix}{max_sequence + 1:03d}"


async def _save_tax_invoice_record(
    db: AsyncSession,
    payload: TaxInvoiceSaveRequest | TaxInvoiceExportRequest,
    current_user: User,
    company: Company,
) -> TaxInvoiceRecord:
    document = payload.document
    subtotal, taxable_amount, vat_amount, total_amount = _calculate_totals(document)

    result = await db.execute(
        select(TaxInvoiceRecord)
        .options(selectinload(TaxInvoiceRecord.lines))
        .where(
            TaxInvoiceRecord.company_id == company.id,
            TaxInvoiceRecord.invoice_number == document.invoice_number,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        record = TaxInvoiceRecord(
            company_id=company.id,
            invoice_number=document.invoice_number,
            created_by=current_user.id,
        )
        db.add(record)
    else:
        record.lines.clear()
        await db.flush()

    record.invoice_number = document.invoice_number
    record.invoice_date = document.invoice_date
    record.order_numbers = document.order_numbers
    record.source = payload.source
    record.copy_type = payload.copy_type
    record.customer_name = document.customer.name
    record.customer_address = document.customer.address
    record.customer_tax_id = document.customer.tax_id or None
    record.customer_branch = document.customer.branch or None
    record.payment_method = document.payment_method
    record.credit_days = document.credit_days
    record.subtotal = subtotal
    record.discount_amount = document.discount_amount
    record.taxable_amount = taxable_amount
    record.vat_rate = document.vat_rate
    record.vat_amount = vat_amount
    record.total_amount = total_amount
    record.notes = document.notes
    record.updated_by = current_user.id
    record.lines = [
        TaxInvoiceRecordLine(
            line_number=index,
            order_number=line.order_number or None,
            product_code=line.product_code or None,
            description=line.description,
            quantity=line.quantity,
            unit=line.unit or None,
            unit_price=line.unit_price,
            line_total=line.quantity * line.unit_price,
        )
        for index, line in enumerate(document.lines, start=1)
    ]
    await db.flush()
    return record


@router.post("/crm-orders/lookup", response_model=CrmOrderLookupResponse)
async def lookup_orders(
    payload: CrmOrderLookupRequest,
    _: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(
            select(CompanyIntegration).where(
                CompanyIntegration.company_id == company.id,
                CompanyIntegration.provider == "crm_kawin",
            )
        )
        integration = result.scalar_one_or_none()
        config = None
        if integration:
            config = CrmKawinConfig(
                base_url=integration.base_url if integration.is_active else None,
                orders_path=integration.orders_path,
                api_token=integration.api_token if integration.is_active else None,
                external_company_id=integration.external_company_id,
                use_env_fallback=False,
            )
        lookup = await lookup_crm_orders(payload.order_numbers, config)
        invoice_number = await _next_tax_invoice_number(
            db,
            company.id,
            lookup.document.invoice_date,
        )
        document = lookup.document.model_copy(update={"invoice_number": invoice_number})
        return lookup.model_copy(update={"document": document})
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"crm-kawin ตอบกลับผิดพลาด ({exc.response.status_code})",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"เชื่อมต่อ crm-kawin ไม่สำเร็จ: {exc}",
        ) from exc


@router.post("", response_model=TaxInvoiceSaveResponse)
async def save_tax_invoice(
    payload: TaxInvoiceSaveRequest,
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
    db: AsyncSession = Depends(get_db),
):
    record = await _save_tax_invoice_record(db, payload, current_user, company)
    await db.commit()
    return TaxInvoiceSaveResponse(id=record.id, invoice_number=record.invoice_number)


@router.post("/export.pdf")
async def export_tax_invoice(
    payload: TaxInvoiceExportRequest,
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
    db: AsyncSession = Depends(get_db),
):
    try:
        await _save_tax_invoice_record(db, payload, current_user, company)
        await db.commit()
        pdf = await run_in_threadpool(
            build_tax_invoice_pdf,
            payload.document,
            payload.copy_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"สร้าง PDF จาก Excel template ไม่สำเร็จ: {exc}",
        ) from exc
    filename = f"tax_invoice_{payload.document.invoice_number}.pdf".replace("/", "-")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/export.xlsx")
async def export_tax_invoice_xlsx(
    payload: TaxInvoiceExportRequest,
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
    db: AsyncSession = Depends(get_db),
):
    try:
        await _save_tax_invoice_record(db, payload, current_user, company)
        await db.commit()
        xlsx = build_tax_invoice_xlsx(payload.document, payload.copy_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    filename = f"tax_invoice_{payload.document.invoice_number}.xlsx".replace("/", "-")
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/preview.png")
async def preview_tax_invoice(
    payload: TaxInvoiceExportRequest,
    _: User = Depends(require_accountant),
    __: Company = Depends(get_current_company),
):
    try:
        pdf = await run_in_threadpool(
            build_tax_invoice_pdf,
            payload.document,
            payload.copy_type,
        )
        png = await run_in_threadpool(convert_pdf_first_page_to_png, pdf)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"สร้างตัวอย่างจาก Excel template ไม่สำเร็จ: {exc}",
        ) from exc
    return Response(content=png, media_type="image/png")
