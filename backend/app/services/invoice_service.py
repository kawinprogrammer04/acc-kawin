from decimal import ROUND_HALF_UP, Decimal
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.account import Account
from app.models.invoice import Invoice, InvoiceLine
from app.models.journal import Journal, JournalLine
from app.models.party import Party
from app.models.tax import VatRecord, WhtRecord
from app.schemas.invoice import InvoiceCreate, VatCalculation

TWO = Decimal("0.01")
VAT_RATE = Decimal(str(settings.VAT_RATE))

# WHT rate lookup
WHT_RATES: dict[str, Decimal] = {
    "1": Decimal("1"),
    "2": Decimal("2"),
    "3": Decimal("3"),
    "5": Decimal("5"),
    "15": Decimal("15"),
}


def calculate_vat(amount: Decimal, inclusive: bool = False, rate: Decimal = VAT_RATE) -> VatCalculation:
    """คำนวณ VAT แบบรวมและไม่รวมราคา"""
    if inclusive:
        taxable = (amount * 100 / (100 + rate)).quantize(TWO, ROUND_HALF_UP)
        vat = (amount - taxable).quantize(TWO, ROUND_HALF_UP)
        total = amount
    else:
        taxable = amount.quantize(TWO, ROUND_HALF_UP)
        vat = (amount * rate / 100).quantize(TWO, ROUND_HALF_UP)
        total = (taxable + vat).quantize(TWO, ROUND_HALF_UP)

    return VatCalculation(
        subtotal=amount,
        taxable_amount=taxable,
        vat_amount=vat,
        total_amount=total,
        vat_rate=rate,
    )


async def _next_invoice_number(db: AsyncSession, invoice_type: str, invoice_date: datetime) -> str:
    prefix = "INV" if invoice_type == "ar" else "AP"
    year = invoice_date.year
    result = await db.execute(
        select(func.count()).select_from(Invoice).where(
            Invoice.invoice_type == invoice_type,
            text(f"EXTRACT(YEAR FROM invoice_date) = {year}"),
        )
    )
    seq = (result.scalar() or 0) + 1
    return f"{prefix}{year}-{seq:05d}"


async def create_invoice(db: AsyncSession, payload: InvoiceCreate, user_id: int) -> Invoice:
    # Validate party
    party = await db.get(Party, payload.party_id)
    if not party:
        raise ValueError("ไม่พบลูกค้า/ผู้ขาย")

    # Validate accounts
    ar_ap_account = await db.get(Account, payload.ar_ap_account_id)
    if not ar_ap_account:
        raise ValueError("ไม่พบบัญชีลูกหนี้/เจ้าหนี้")

    # Auto-generate invoice number if not provided
    invoice_number = payload.invoice_number
    if not invoice_number:
        invoice_number = await _next_invoice_number(db, payload.invoice_type, payload.invoice_date)

    # Process lines: calculate totals
    subtotal = Decimal("0")
    total_discount = Decimal("0")
    total_wht = Decimal("0")
    line_models: list[InvoiceLine] = []

    for ln in payload.lines:
        line_subtotal = (ln.quantity * ln.unit_price).quantize(TWO, ROUND_HALF_UP)
        discount_amount = (line_subtotal * ln.discount_pct / 100).quantize(TWO, ROUND_HALF_UP)
        line_total = (line_subtotal - discount_amount).quantize(TWO, ROUND_HALF_UP)

        # WHT per line
        wht_amount = Decimal("0")
        wht_rate = None
        if ln.wht_type:
            wht_rate = WHT_RATES.get(ln.wht_type, Decimal("0"))
            wht_amount = (line_total * wht_rate / 100).quantize(TWO, ROUND_HALF_UP)

        subtotal += line_subtotal
        total_discount += discount_amount
        total_wht += wht_amount

        line_models.append(InvoiceLine(
            line_number=ln.line_number,
            description=ln.description,
            quantity=float(ln.quantity),
            unit=ln.unit,
            unit_price=float(ln.unit_price),
            discount_pct=float(ln.discount_pct),
            discount_amount=float(discount_amount),
            line_total=float(line_total),
            account_id=ln.account_id,
            wht_type=ln.wht_type,
            wht_rate=float(wht_rate) if wht_rate else None,
            wht_amount=float(wht_amount),
        ))

    net_before_vat = subtotal - total_discount

    # Calculate VAT on net amount
    vat_amount = Decimal("0")
    taxable_amount = net_before_vat
    total_amount = net_before_vat

    if payload.apply_vat:
        vat_calc = calculate_vat(net_before_vat, inclusive=payload.is_vat_included)
        taxable_amount = vat_calc.taxable_amount
        vat_amount = vat_calc.vat_amount
        total_amount = vat_calc.total_amount

    # For AP: WHT reduces the payment (not the invoice total)
    # total_amount stays as invoice face value; WHT shown separately
    invoice = Invoice(
        invoice_type=payload.invoice_type,
        invoice_number=invoice_number,
        reference=payload.reference,
        invoice_date=payload.invoice_date,
        due_date=payload.due_date,
        party_id=payload.party_id,
        period_id=payload.period_id,
        ar_ap_account_id=payload.ar_ap_account_id,
        revenue_expense_account_id=payload.revenue_expense_account_id,
        subtotal=float(subtotal),
        discount_amount=float(total_discount),
        taxable_amount=float(taxable_amount),
        vat_amount=float(vat_amount),
        wht_amount=float(total_wht),
        total_amount=float(total_amount),
        is_vat_included=payload.is_vat_included,
        notes=payload.notes,
        status="draft",
        created_by=user_id,
    )
    db.add(invoice)
    await db.flush()

    for lm in line_models:
        lm.invoice_id = invoice.id
        db.add(lm)

    await db.commit()
    await db.refresh(invoice)
    return invoice


async def post_invoice_to_journal(db: AsyncSession, invoice_id: str, user_id: int) -> Journal:
    """สร้าง Journal Entry จาก Invoice อัตโนมัติ"""
    result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.lines), selectinload(Invoice.party))
        .where(Invoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise ValueError("ไม่พบ Invoice")
    if invoice.status not in ("draft", "sent"):
        raise ValueError(f"ไม่สามารถ Post Invoice ที่มีสถานะ: {invoice.status}")

    party = invoice.party
    tax_year = invoice.invoice_date.year
    count_result = await db.execute(
        select(func.count()).select_from(Journal).where(
            text(f"EXTRACT(YEAR FROM entry_date) = {tax_year}")
        )
    )
    seq = (count_result.scalar() or 0) + 1
    entry_number = f"JV{tax_year}-{seq:05d}"

    desc = (
        f"ใบแจ้งหนี้ {invoice.invoice_number} - {party.name_th}"
        if invoice.invoice_type == "ar"
        else f"ใบวางบิล {invoice.invoice_number} - {party.name_th}"
    )

    journal = Journal(
        entry_number=entry_number,
        entry_date=invoice.invoice_date,
        period_id=invoice.period_id,
        description=desc,
        reference=invoice.invoice_number,
        source_type="invoice",
        source_id=invoice.id,
        status="posted",
        posted_at=datetime.now(timezone.utc),
        posted_by=user_id,
        created_by=user_id,
    )
    db.add(journal)
    await db.flush()

    net_income = float(invoice.subtotal) - float(invoice.discount_amount)
    line_number = 1

    if invoice.invoice_type == "ar":
        # Dr ลูกหนี้ (total รวม VAT)
        db.add(JournalLine(
            journal_id=journal.id, line_number=line_number,
            account_id=invoice.ar_ap_account_id,
            description=f"ลูกหนี้ - {party.name_th}",
            debit=float(invoice.total_amount), credit=0, party_id=party.id,
        ))
        line_number += 1
        # Cr รายได้ (ก่อน VAT)
        if invoice.revenue_expense_account_id:
            db.add(JournalLine(
                journal_id=journal.id, line_number=line_number,
                account_id=invoice.revenue_expense_account_id,
                description="รายได้",
                debit=0, credit=net_income,
            ))
            line_number += 1
        # Cr ภาษีขาย
        if float(invoice.vat_amount) > 0:
            output_vat_account = await db.execute(
                select(Account).where(Account.code == "2202")
            )
            vat_account = output_vat_account.scalar_one_or_none()
            if vat_account:
                db.add(JournalLine(
                    journal_id=journal.id, line_number=line_number,
                    account_id=vat_account.id,
                    description=f"ภาษีขาย {settings.VAT_RATE}%",
                    debit=0, credit=float(invoice.vat_amount),
                ))
                line_number += 1
    else:
        # AP: Dr ค่าใช้จ่าย + VAT ซื้อ, Cr เจ้าหนี้
        if invoice.revenue_expense_account_id:
            db.add(JournalLine(
                journal_id=journal.id, line_number=line_number,
                account_id=invoice.revenue_expense_account_id,
                description="ค่าใช้จ่าย",
                debit=net_income, credit=0,
            ))
            line_number += 1
        # Dr ภาษีซื้อ
        if float(invoice.vat_amount) > 0:
            input_vat_account = await db.execute(
                select(Account).where(Account.code == "1402")
            )
            vat_account = input_vat_account.scalar_one_or_none()
            if vat_account:
                db.add(JournalLine(
                    journal_id=journal.id, line_number=line_number,
                    account_id=vat_account.id,
                    description=f"ภาษีซื้อ {settings.VAT_RATE}%",
                    debit=float(invoice.vat_amount), credit=0,
                ))
                line_number += 1
        # Cr เจ้าหนี้
        db.add(JournalLine(
            journal_id=journal.id, line_number=line_number,
            account_id=invoice.ar_ap_account_id,
            description=f"เจ้าหนี้ - {party.name_th}",
            debit=0, credit=float(invoice.total_amount), party_id=party.id,
        ))

    # Auto-create VAT record
    if float(invoice.vat_amount) > 0:
        db.add(VatRecord(
            record_type="output" if invoice.invoice_type == "ar" else "input",
            tax_invoice_number=invoice.invoice_number,
            tax_invoice_date=invoice.invoice_date,
            period_month=invoice.invoice_date.month,
            period_year=invoice.invoice_date.year,  # Keep as CE year; adjust to BE in reports
            party_id=party.id,
            party_name=party.name_th,
            party_tax_id=party.tax_id,
            party_branch=party.branch_code,
            taxable_amount=float(invoice.taxable_amount),
            vat_rate=settings.VAT_RATE,
            vat_amount=float(invoice.vat_amount),
            invoice_id=invoice.id,
        ))

    # Auto-create WHT records
    for line in invoice.lines:
        if line.wht_type and float(line.wht_amount) > 0:
            db.add(WhtRecord(
                transaction_date=invoice.invoice_date,
                period_month=invoice.invoice_date.month,
                period_year=invoice.invoice_date.year,
                payee_id=party.id,
                payee_name=party.name_th,
                payee_tax_id=party.tax_id,
                income_type=line.description,
                wht_type=line.wht_type,
                wht_rate=float(line.wht_rate or 0),
                income_amount=float(line.line_total),
                wht_amount=float(line.wht_amount),
                invoice_id=invoice.id,
            ))

    # Update invoice
    invoice.journal_id = journal.id
    invoice.status = "sent"
    await db.commit()
    await db.refresh(journal)
    return journal
