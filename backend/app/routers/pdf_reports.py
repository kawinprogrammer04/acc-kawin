"""
PDF report endpoints.

GET /reports/pdf/pp30?year=2024&month=1
GET /reports/pdf/wht50?year=2024&month=1
GET /reports/pdf/income-expense?fiscal_year_id=1&period_from=1&period_to=12
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_viewer
from app.core.database import get_db
from app.services.report_queries import (
    query_income_expense,
    query_pp30,
    query_wht50,
)
from app.services.pdf_service import render_pdf

router = APIRouter(prefix="/reports/pdf", tags=["PDF Reports"])

_PDF = "application/pdf"


def _pdf_response(pdf_bytes: bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes,
        media_type=_PDF,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/pp30")
async def download_pp30(
    year: int = Query(..., ge=2000, le=2100, description="ปี ค.ศ."),
    month: int = Query(..., ge=1, le=12, description="เดือน 1-12"),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_viewer),
):
    """ดาวน์โหลด ภพ.30 (VAT monthly report) เป็น PDF."""
    data = await query_pp30(db, year, month)
    pdf = render_pdf("pp30.html", data)
    return _pdf_response(pdf, f"PP30_{year}_{month:02d}.pdf")


@router.get("/wht50")
async def download_wht50(
    year: int = Query(..., ge=2000, le=2100, description="ปี ค.ศ."),
    month: int = Query(..., ge=1, le=12, description="เดือน 1-12"),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_viewer),
):
    """ดาวน์โหลด หัก ณ ที่จ่าย 50 ทวิ เป็น PDF."""
    data = await query_wht50(db, year, month)
    pdf = render_pdf("wht_50twi.html", data)
    return _pdf_response(pdf, f"WHT50_{year}_{month:02d}.pdf")


@router.get("/income-expense")
async def download_income_expense(
    fiscal_year_id: int = Query(..., ge=1, description="รหัสปีบัญชี"),
    period_from: int = Query(..., ge=1, le=12, description="งวดเริ่มต้น"),
    period_to: int = Query(..., ge=1, le=12, description="งวดสิ้นสุด"),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_viewer),
):
    """ดาวน์โหลดรายงานรายได้-ค่าใช้จ่าย เป็น PDF."""
    data = await query_income_expense(db, fiscal_year_id, period_from, period_to)
    pdf = render_pdf("income_expense.html", data)
    label = f"P{period_from:02d}-P{period_to:02d}"
    return _pdf_response(pdf, f"IncExp_FY{fiscal_year_id}_{label}.pdf")
