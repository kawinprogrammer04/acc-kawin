"""Draft expense-request calculations, sensitive-field encryption, and PDF output."""
from __future__ import annotations

import base64
import hashlib
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable

from cryptography.fernet import Fernet, InvalidToken
from jinja2 import Environment
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
    if request.vat_mode == "rate":
        vat_amount = money(subtotal * Decimal(request.vat_rate or 0) / Decimal("100"))
    elif request.vat_mode == "amount":
        vat_amount = money(request.vat_amount)
    else:
        vat_amount = Decimal("0.00")

    if not request.withholding_required:
        withholding_amount = Decimal("0.00")
    elif request.withholding_mode == "rate":
        withholding_amount = money(subtotal * Decimal(request.withholding_rate or 0) / Decimal("100"))
    elif request.withholding_mode == "amount":
        withholding_amount = money(request.withholding_amount)
    else:
        withholding_amount = Decimal("0.00")

    grand_total = money(subtotal + vat_amount)
    payable_total = money(max(Decimal("0"), grand_total - withholding_amount))
    return {
        "subtotal": subtotal,
        "vat_amount": vat_amount,
        "withholding_amount": withholding_amount,
        "grand_total": grand_total,
        "payable_total": payable_total,
    }


PDF_TEMPLATE = """
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
) -> None:
    totals = calculate_totals(request, items)
    tax_note = (
        "ผู้ขอแจ้งว่ารายการนี้ต้องหัก ณ ที่จ่าย (ประมาณการ) ฝ่ายบัญชีจะตรวจสอบอัตราจริง"
        if request.withholding_required else
        "ผู้ขอแจ้งว่าไม่ต้องหัก ณ ที่จ่าย ฝ่ายบัญชีจะตรวจสอบและยืนยันอีกครั้ง"
    )
    template = Environment(autoescape=True).from_string(PDF_TEMPLATE)
    html = template.render(
        request=request,
        rows=items,
        empty_rows=max(0, 12 - len(items)),
        company=company,
        requester=requester,
        position_name=position_name,
        expense_type_name=expense_type_name,
        totals=totals,
        tax_note=tax_note,
        created_date=request.created_at.strftime("%d/%m/%Y") if request.created_at else "-",
        request_date=request.request_date.strftime("%d/%m/%Y"),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    HTML(string=html).write_pdf(str(output_path))
