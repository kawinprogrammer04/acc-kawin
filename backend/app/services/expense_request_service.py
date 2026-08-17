"""Draft expense-request calculations, sensitive-field encryption, and PDF output."""
from __future__ import annotations

import base64
import hashlib
import io
import mimetypes
import unicodedata
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable

from cryptography.fernet import Fernet, InvalidToken
from jinja2 import Environment, FileSystemLoader, select_autoescape
from PIL import Image
from weasyprint import HTML

from app.core.config import settings
from app.models.approval import ExpenseRequest, ExpenseRequestItem
from app.models.company import Company
from app.models.user import User


MONEY = Decimal("0.01")


def money(value: Decimal | int | str | None) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_account_number(value: str | None) -> str | None:
    normalized = "".join((value or "").split())
    if not normalized:
        return None
    return _fernet().encrypt(normalized.encode("utf-8")).decode("ascii")


def decrypt_account_number(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def calculate_totals(request: ExpenseRequest, items: Iterable[ExpenseRequestItem]) -> dict[str, Decimal]:
    subtotal = money(sum((money(item.line_total) for item in items), Decimal("0")))
    installment_override = (
        money(request.installment_payment_amount)
        if getattr(request, "installment_payment_amount", None) is not None
        else None
    )
    if installment_override is not None:
        # This document only claims a slice of the full order (an "installment") —
        # VAT/หัก ณ ที่จ่าย are based on what's actually being paid this round, not
        # the full line-items total. Discount doesn't apply on top of an explicit
        # installment figure (see update_expense_request_draft, which zeroes it).
        discount = Decimal("0.00")
        taxable_base = installment_override
    else:
        discount = min(subtotal, money(getattr(request, "discount_amount", 0)))
        taxable_base = money(subtotal - discount)
    if request.vat_mode == "rate":
        if getattr(request, "price_mode", "exclude_vat") == "include_vat":
            vat_amount = money(taxable_base - (taxable_base / (Decimal("1") + Decimal(request.vat_rate or 0) / Decimal("100"))))
            price_before_vat = money(taxable_base - vat_amount)
        else:
            price_before_vat = taxable_base
            vat_amount = money(taxable_base * Decimal(request.vat_rate or 0) / Decimal("100"))
    elif request.vat_mode == "amount":
        vat_amount = money(request.vat_amount)
        price_before_vat = money(taxable_base - vat_amount) if getattr(request, "price_mode", "exclude_vat") == "include_vat" else taxable_base
    else:
        vat_amount = Decimal("0.00")
        price_before_vat = taxable_base

    requested_net = money(getattr(request, "requested_net_amount", None)) if getattr(request, "requested_net_amount", None) is not None else None
    if not request.withholding_required:
        withholding_amount = Decimal("0.00")
        withholding_base = price_before_vat
    elif request.withholding_mode == "rate":
        withholding_base = price_before_vat
        if (getattr(request, "gross_up_enabled", False) and requested_net is not None
                and requested_net > vat_amount and Decimal(request.withholding_rate or 0) < 100):
            withholding_base = money((requested_net - vat_amount) / (Decimal("1") - Decimal(request.withholding_rate or 0) / Decimal("100")))
        elif getattr(request, "gross_up_enabled", False) and Decimal(request.withholding_rate or 0) < 100:
            withholding_base = money(price_before_vat / (Decimal("1") - Decimal(request.withholding_rate or 0) / Decimal("100")))
        withholding_amount = money(withholding_base * Decimal(request.withholding_rate or 0) / Decimal("100"))
    elif request.withholding_mode == "amount":
        withholding_base = price_before_vat
        withholding_amount = money(request.withholding_amount)
    else:
        withholding_base = price_before_vat
        withholding_amount = Decimal("0.00")

    grand_total = money(price_before_vat + vat_amount)
    if getattr(request, "gross_up_enabled", False) and requested_net is None:
        # Compatibility for drafts created before requested_net_amount existed.
        grand_total = money(withholding_base + vat_amount)
    payable_total = (requested_net if getattr(request, "gross_up_enabled", False) and requested_net is not None
                     else money(max(Decimal("0"), grand_total - withholding_amount)))
    return {
        "subtotal": subtotal,
        "discount_amount": discount,
        "price_before_vat": price_before_vat,
        "vat_amount": vat_amount,
        "withholding_amount": withholding_amount,
        "grand_total": grand_total,
        "payable_total": payable_total,
    }


LEGACY_PDF_TEMPLATE = """
<!doctype html>
<html lang="th"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 18mm 14mm 16mm; }
body { font-family: "Noto Looped Thai", "Loma", sans-serif; font-kerning:none; color:#172033; font-size:10px; }
.brand { display:flex; align-items:center; border-bottom:2px solid #d88900; padding-bottom:10px; margin-bottom:12px; }
.mark { width:58px; height:58px; border-radius:8px; background:linear-gradient(135deg,#b87700,#f2cf67); color:white; font-size:34px; font-weight:700; text-align:center; line-height:58px; margin-right:18px; }
h1 { margin:0 0 4px; font-size:18px; } .muted { color:#657083; }
.title { width:76%; margin:10px auto 14px; border:2px solid #d96d00; border-radius:12px; text-align:center; padding:9px; font-size:16px; font-weight:700; }
table { width:100%; border-collapse:collapse; } th,td { border:1px solid #344055; padding:6px 7px; vertical-align:top; }
th { background:#eef0f3; font-weight:700; } .right { text-align:right; } .center { text-align:center; }
.meta td:nth-child(odd) { background:#f3f4f6; font-weight:700; width:15%; }
.items { margin-top:9px; } .items th { text-align:center; } .items td { height:22px; }
.bottom { display:grid; grid-template-columns:60% 40%; margin-top:0; border:1px solid #344055; border-top:0; }
.note { padding:9px; min-height:92px; border-right:1px solid #344055; } .totals td { border-width:0 0 1px 0; }
.totals tr:last-child td { background:#e2e5e9; font-size:12px; font-weight:700; border-bottom:0; }
.sign { margin-top:0; } .sign-title { background:#eef0f3; border:1px solid #344055; padding:5px 7px; font-weight:700; }
.sign-grid { display:grid; grid-template-columns:repeat(4,1fr); border-left:1px solid #344055; }
.sign-cell { height:70px; border-right:1px solid #344055; border-bottom:1px solid #344055; text-align:center; padding-top:12px; }
.footer { position:fixed; left:0; right:0; bottom:-8mm; text-align:center; color:#9098a5; font-size:7px; }
</style></head><body>
<div class="brand"><div class="mark">K</div><div><h1>{{ company.name_th }}</h1><div style="font-size:14px">{{ company.name_en or '' }}</div><div class="muted">{{ company.address or '' }}</div><div class="muted">เลขประจำตัวผู้เสียภาษี {{ company.tax_id or '-' }}</div></div></div>
<div class="title">แบบฟอร์มขออนุมัติชำระเงิน (Payment Approval)</div>
<table class="meta">
<tr><td>ผู้เบิก</td><td>{{ requester.full_name or requester.username }}</td><td>เลขที่เอกสาร</td><td>{{ request.request_no }}</td></tr>
<tr><td>แผนก / ตำแหน่ง</td><td>{{ position_name }}</td><td>วันที่ทำรายการ</td><td>{{ created_date }}</td></tr>
<tr><td>วันที่ต้องการโอน</td><td>{{ request_date }}</td><td>ประเภท</td><td>{{ expense_type_name }}</td></tr>
</table>
<table class="items"><thead><tr><th style="width:5%">ลำดับ</th><th>รายการ</th><th style="width:15%">ชื่อผู้รับ</th><th style="width:10%">จำนวน</th><th style="width:8%">หน่วย</th><th style="width:14%">ราคา/หน่วย</th><th style="width:14%">จำนวนเงิน</th></tr></thead><tbody>
{% for row in rows %}<tr><td class="center">{{ loop.index }}</td><td>{{ row.description }}</td><td>{{ request.recipient_name or '' }}</td><td class="right">{{ '%.2f'|format(row.quantity) }}</td><td class="center">{{ row.unit }}</td><td class="right">{{ '%.2f'|format(row.unit_price) }}</td><td class="right">{{ '%.2f'|format(row.line_total) }}</td></tr>{% endfor %}
{% for _ in range(empty_rows) %}<tr><td class="center">{{ rows|length + loop.index }}</td><td></td><td></td><td></td><td></td><td></td><td class="right">-</td></tr>{% endfor %}
</tbody></table>
<div class="bottom"><div class="note"><b>หมายเหตุ / วัตถุประสงค์</b><p>{{ request.title }}</p><p>{{ request.description or '' }}</p><span style="color:#d66a21">{{ tax_note }}</span></div><table class="totals"><tr><td>รวมเงิน</td><td class="right">{{ '%.2f'|format(totals.subtotal) }}</td></tr><tr><td>VAT</td><td class="right">{{ '%.2f'|format(totals.vat_amount) }}</td></tr><tr><td>หัก ณ ที่จ่าย</td><td class="right">{{ '%.2f'|format(totals.withholding_amount) }}</td></tr><tr><td>ยอดที่ต้องชำระ</td><td class="right">{{ '%.2f'|format(totals.payable_total) }}</td></tr></table></div>
<div class="sign"><div class="sign-title">ผู้ขอเบิกและผู้อนุมัติ - ลงชื่อในช่องของตนเอง</div><div class="sign-grid"><div class="sign-cell">ผู้ขอเบิก<br><br>{{ requester.full_name or requester.username }}</div><div class="sign-cell">ผู้อนุมัติ</div><div class="sign-cell">ผู้ตรวจสอบ</div><div class="sign-cell">ผู้จ่ายเงิน</div></div></div>
<div class="footer">{{ request.request_no }} · สร้างจากระบบบัญชี Kawin Brothers · เอกสารนี้บันทึก Audit Log ทุกการอนุมัติ</div>
</body></html>
"""


def render_payment_approval_pdf(
    request: ExpenseRequest,
    items: list[ExpenseRequestItem],
    company: Company,
    requester: User,
    position_name: str,
    expense_type_name: str,
    output_path: Path,
    department_name: str = "-",
    signature_cells: list[dict] | None = None,
) -> None:
    totals = calculate_totals(request, items)
    template_dir = Path(__file__).resolve().parents[1] / "templates"
    template = Environment(
        loader=FileSystemLoader(template_dir),
        autoescape=select_autoescape(["html", "xml"]),
    ).get_template("expense_request_pdf.html")

    def number(value: Decimal | int | float) -> str:
        return f"{Decimal(value or 0):,.2f}"

    def compact_number(value: Decimal | int | float, precision: int = 3) -> str:
        text = f"{Decimal(value or 0):,.{precision}f}"
        return text.rstrip("0").rstrip(".")

    def visible_length(value: str) -> int:
        return len("".join(
            character for character in "".join((value or "").split())
            if unicodedata.category(character) != "Mn"
        ))

    company_name = (request.company_name_snapshot or company.name_th or "ไม่ระบุชื่อบริษัท").strip()
    company_name_length = len("".join(company_name.split()))
    company_name_font_size = 14 if company_name_length > 72 else (16 if company_name_length > 52 else 21)
    payee_name = (request.recipient_name or "-").strip()
    payee_length = visible_length(payee_name)
    payee_font_size = 6.5 if payee_length > 36 else (10.5 if payee_length > 24 else 12)
    payee_line_height = .9 if payee_length > 24 else 1.05

    logo_data_uri = None
    logo_url = (company.logo_url or "").strip()
    if logo_url.startswith("data:image/"):
        logo_data_uri = logo_url
    elif logo_url:
        logo_path = Path(logo_url)
        if logo_path.is_file() and logo_path.stat().st_size <= 2 * 1024 * 1024:
            mime = mimetypes.guess_type(logo_path.name)[0] or "image/png"
            logo_data_uri = f"data:{mime};base64,{base64.b64encode(logo_path.read_bytes()).decode('ascii')}"
    if not logo_data_uri:
        # Use the exact 300x300 mark embedded in HR attachment 241. Keeping the
        # square transparent canvas is important: it makes object-fit and the
        # 55pt logo box land at the same coordinates as the source document.
        canonical_logo = template_dir / "assets" / "expense-request-logo.png"
        if canonical_logo.is_file():
            logo_data_uri = (
                "data:image/png;base64,"
                + base64.b64encode(canonical_logo.read_bytes()).decode("ascii")
            )
    if not logo_data_uri:
        # The accounting workbook already carries the canonical company logo
        # (the tax-invoice renderer also maps image2.png to logo-company.png).
        workbook = template_dir / "tax_invoice_template.xlsx"
        if workbook.is_file():
            try:
                with zipfile.ZipFile(workbook) as archive:
                    logo = archive.read("xl/media/image2.png")
                # Attachment 241 in HR uses only the gold K mark.  The workbook
                # image also contains a small wordmark below it, so crop the
                # upper mark before embedding it in the approval form.
                with Image.open(io.BytesIO(logo)) as source_logo:
                    upper_mark = source_logo.convert("RGBA").crop(
                        (0, 0, source_logo.width, round(source_logo.height * .73))
                    )
                    bounds = upper_mark.getbbox()
                    if bounds:
                        upper_mark = upper_mark.crop(bounds)
                    logo_stream = io.BytesIO()
                    upper_mark.save(logo_stream, format="PNG", optimize=True)
                logo_data_uri = (
                    "data:image/png;base64,"
                    + base64.b64encode(logo_stream.getvalue()).decode("ascii")
                )
            except (KeyError, OSError, zipfile.BadZipFile):
                logo_data_uri = None

    formatted_rows = [{
        "number": index,
        "description": item.description,
        "quantity_display": compact_number(item.quantity),
        "unit": item.unit,
        "unit_price_display": number(item.unit_price),
        "line_total_display": number(item.line_total),
    } for index, item in enumerate(items, 1)]
    # The original document served by HR attachment 241 is a twelve-line form.
    # Requests with item 13 continue on a second copy of the same form.
    rows_per_page = 12
    chunks = [
        formatted_rows[index:index + rows_per_page]
        for index in range(0, len(formatted_rows), rows_per_page)
    ] or [[]]
    pages = [{
        "rows": rows,
        "blank_row_numbers": list(range(
            (page_index * rows_per_page) + len(rows) + 1,
            ((page_index + 1) * rows_per_page) + 1,
        )),
        "is_final": page_index == len(chunks) - 1,
    } for page_index, rows in enumerate(chunks)]

    cells = signature_cells or []
    if not cells or not cells[0].get("is_requester"):
        cells.insert(0, {
            "role": "ผู้ขอเบิก",
            "name": request.requester_name_snapshot or requester.full_name or requester.username,
            "is_requester": True,
        })
    signature_rows = []
    for index in range(0, len(cells), 4):
        row = cells[index:index + 4]
        signature_rows.append(row + [None] * (4 - len(row)))

    before_discount = totals["subtotal"]
    purpose = " · ".join(filter(None, [request.title, request.description]))
    if len(purpose) > 150:
        purpose = purpose[:149] + "…"
    tax_note = (
        "ผู้ขอแจ้งว่ารายการนี้ต้องหัก ณ ที่จ่าย (ประมาณการ) - "
        "ฝ่ายบัญชีจะตรวจสอบฐานและอัตราจริง"
        if request.withholding_required else
        "ผู้ขอยังไม่ได้หักหรือบวก - "
        "ฝ่ายบัญชีเป็นผู้กำหนดฐานและอัตราหัก ณ ที่จ่ายจริง"
    )
    transaction_at = request.submitted_at or request.created_at
    summary = {
        **totals,
        "before_discount": number(before_discount),
        "discount_amount_display": number(totals["discount_amount"]),
        "price_before_vat_display": number(totals["price_before_vat"]),
        "vat_amount_display": number(totals["vat_amount"]),
        "withholding_amount_display": number(totals["withholding_amount"]),
        "payable_total_display": number(totals["payable_total"]),
    }
    html = template.render(
        request=request,
        pages=pages,
        company=company,
        company_name=company_name,
        company_name_font_size=company_name_font_size,
        company_address=company.address or "— ยังไม่ได้ตั้งค่าที่อยู่บริษัท —",
        logo_data_uri=logo_data_uri,
        requester_name=request.requester_name_snapshot or requester.full_name or requester.username,
        department_name=request.department_name_snapshot or department_name or "-",
        position_name=position_name,
        expense_type_name=expense_type_name,
        payee_name=payee_name,
        payee_font_size=payee_font_size,
        payee_line_height=payee_line_height,
        totals=summary,
        purpose=purpose,
        tax_note=tax_note,
        signature_rows=signature_rows,
        transaction_date=transaction_at.strftime("%d/%m/%Y") if transaction_at else "-",
        required_date=request.required_date.strftime("%d/%m/%Y") if request.required_date else "-",
        vat_rate_display=compact_number(request.vat_rate, 2),
        withholding_rate_display=compact_number(request.withholding_rate, 2),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    HTML(string=html, base_url=str(template_dir)).write_pdf(str(output_path))
