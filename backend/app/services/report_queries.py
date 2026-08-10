"""
Async DB queries that feed all three PDF report types.
Each function returns a plain dict — no SQLAlchemy objects
so results are safe to pass into Jinja2 templates.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.company import Company
from app.models.fiscal import AccountingPeriod
from app.models.invoice import Invoice
from app.models.journal import Journal, JournalLine
from app.models.tax import VatRecord, WhtRecord

TWO = Decimal("0.01")


# ─── helpers ──────────────────────────────────────────────────────────────────

def _fmt(v: Any) -> str:
    """Format numeric as Thai-style comma string."""
    return f"{Decimal(str(v or 0)):,.2f}"


def _thai_month(m: int) -> str:
    MONTHS = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน",
              "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
              "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
    return MONTHS[m] if 1 <= m <= 12 else ""


def _thai_date(d: date | datetime | None) -> str:
    if d is None:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    return f"{d.day} {_thai_month(d.month)} {d.year + 543}"


# ─── ภพ.30 VAT Monthly Report ─────────────────────────────────────────────────

@dataclass
class VatReportRow:
    seq: int
    tax_date: str
    tax_invoice_no: str
    party_name: str
    party_tax_id: str
    party_branch: str
    taxable_amount: str
    vat_amount: str


@dataclass
class PP30Data:
    company_name: str
    company_tax_id: str
    period_month_name: str
    period_year_be: int          # พ.ศ.
    generated_at: str

    output_rows: list[VatReportRow] = field(default_factory=list)
    input_rows:  list[VatReportRow] = field(default_factory=list)

    output_taxable_total: str = "0.00"
    output_vat_total: str     = "0.00"
    input_taxable_total: str  = "0.00"
    input_vat_total: str      = "0.00"
    net_vat: str              = "0.00"
    net_vat_type: str         = "นำส่ง"   # นำส่ง | ขอคืน


async def query_pp30(
    db: AsyncSession,
    year: int,
    month: int,
    company: Company,
) -> PP30Data:
    """Fetch all VAT records for a given CE year+month."""
    result = await db.execute(
        select(VatRecord)
        .where(
            VatRecord.period_year == year,
            VatRecord.period_month == month,
            VatRecord.company_id == company.id,
        )
        .order_by(VatRecord.record_type, VatRecord.tax_invoice_date)
    )
    records = result.scalars().all()

    output_rows, input_rows = [], []
    out_taxable = Decimal("0")
    out_vat     = Decimal("0")
    in_taxable  = Decimal("0")
    in_vat      = Decimal("0")

    def _row(seq: int, r: VatRecord) -> VatReportRow:
        return VatReportRow(
            seq=seq,
            tax_date=_thai_date(r.tax_invoice_date),
            tax_invoice_no=r.tax_invoice_number,
            party_name=r.party_name,
            party_tax_id=_format_tax_id(r.party_tax_id),
            party_branch=r.party_branch or "00000",
            taxable_amount=_fmt(r.taxable_amount),
            vat_amount=_fmt(r.vat_amount),
        )

    for i, r in enumerate(records, 1):
        if r.record_type == "output":
            output_rows.append(_row(i, r))
            out_taxable += Decimal(str(r.taxable_amount))
            out_vat     += Decimal(str(r.vat_amount))
        else:
            input_rows.append(_row(i, r))
            in_taxable += Decimal(str(r.taxable_amount))
            in_vat     += Decimal(str(r.vat_amount))

    net = (out_vat - in_vat).quantize(TWO, ROUND_HALF_UP)

    return PP30Data(
        company_name=company.name_th,
        company_tax_id=_format_tax_id(company.tax_id),
        period_month_name=_thai_month(month),
        period_year_be=year + 543,
        generated_at=_thai_date(date.today()),
        output_rows=output_rows,
        input_rows=input_rows,
        output_taxable_total=_fmt(out_taxable),
        output_vat_total=_fmt(out_vat),
        input_taxable_total=_fmt(in_taxable),
        input_vat_total=_fmt(in_vat),
        net_vat=_fmt(abs(net)),
        net_vat_type="นำส่ง" if net >= 0 else "ขอคืน",
    )


# ─── หัก ณ ที่จ่าย (50 ทวิ) ──────────────────────────────────────────────────

@dataclass
class WhtRow:
    seq: int
    payee_name: str
    payee_tax_id: str
    transaction_date: str
    income_type: str
    wht_type_label: str
    wht_rate: str
    income_amount: str
    wht_amount: str


@dataclass
class WhtGroupRow:
    wht_type_label: str
    wht_rate: str
    income_total: str
    wht_total: str
    row_count: int


@dataclass
class WHT50Data:
    company_name: str
    company_tax_id: str
    period_month_name: str
    period_year_be: int
    generated_at: str

    detail_rows: list[WhtRow]      = field(default_factory=list)
    group_rows:  list[WhtGroupRow] = field(default_factory=list)

    total_income: str = "0.00"
    total_wht:    str = "0.00"


_WHT_LABELS = {
    "1":  "ค่าจ้างแรงงาน 1%",
    "2":  "อื่นๆ 2%",
    "3":  "ค่าบริการ/ค่าจ้างทำของ 3%",
    "5":  "ค่าเช่า 5%",
    "15": "ดอกเบี้ย/เงินปันผล 15%",
}


async def query_wht50(
    db: AsyncSession,
    year: int,
    month: int,
    company: Company,
) -> WHT50Data:
    result = await db.execute(
        select(WhtRecord)
        .where(
            WhtRecord.period_year == year,
            WhtRecord.period_month == month,
            WhtRecord.company_id == company.id,
        )
        .order_by(WhtRecord.wht_type, WhtRecord.transaction_date)
    )
    records = result.scalars().all()

    rows: list[WhtRow] = []
    total_income = Decimal("0")
    total_wht    = Decimal("0")

    # Grouping
    groups: dict[str, dict] = {}

    for i, r in enumerate(records, 1):
        label = _WHT_LABELS.get(r.wht_type, f"อัตรา {r.wht_type}%")
        rows.append(WhtRow(
            seq=i,
            payee_name=r.payee_name,
            payee_tax_id=_format_tax_id(r.payee_tax_id),
            transaction_date=_thai_date(r.transaction_date),
            income_type=r.income_type or label,
            wht_type_label=label,
            wht_rate=f"{Decimal(str(r.wht_rate)):.0f}%",
            income_amount=_fmt(r.income_amount),
            wht_amount=_fmt(r.wht_amount),
        ))
        total_income += Decimal(str(r.income_amount))
        total_wht    += Decimal(str(r.wht_amount))

        key = f"{r.wht_type}_{r.wht_rate}"
        if key not in groups:
            groups[key] = {"label": label, "rate": r.wht_rate,
                           "income": Decimal("0"), "wht": Decimal("0"), "count": 0}
        groups[key]["income"] += Decimal(str(r.income_amount))
        groups[key]["wht"]    += Decimal(str(r.wht_amount))
        groups[key]["count"]  += 1

    group_rows = [
        WhtGroupRow(
            wht_type_label=g["label"],
            wht_rate=f"{Decimal(str(g['rate'])):.0f}%",
            income_total=_fmt(g["income"]),
            wht_total=_fmt(g["wht"]),
            row_count=g["count"],
        )
        for g in sorted(groups.values(), key=lambda x: x["rate"])
    ]

    return WHT50Data(
        company_name=company.name_th,
        company_tax_id=_format_tax_id(company.tax_id),
        period_month_name=_thai_month(month),
        period_year_be=year + 543,
        generated_at=_thai_date(date.today()),
        detail_rows=rows,
        group_rows=group_rows,
        total_income=_fmt(total_income),
        total_wht=_fmt(total_wht),
    )


# ─── Income / Expense Summary ─────────────────────────────────────────────────

@dataclass
class IncExpRow:
    account_code: str
    account_name: str
    amount: str
    is_subtotal: bool = False


@dataclass
class IncExpData:
    company_name: str
    company_tax_id: str
    fiscal_year_id: int
    period_from: int
    period_to: int
    period_label: str
    generated_at: str

    revenue_rows: list[IncExpRow]  = field(default_factory=list)
    cogs_rows:    list[IncExpRow]  = field(default_factory=list)
    opex_rows:    list[IncExpRow]  = field(default_factory=list)
    other_rows:   list[IncExpRow]  = field(default_factory=list)

    total_revenue:        str = "0.00"
    total_cogs:           str = "0.00"
    gross_profit:         str = "0.00"
    gross_margin_pct:     str = "0.00"
    total_opex:           str = "0.00"
    operating_profit:     str = "0.00"
    total_other_revenue:  str = "0.00"
    total_other_expense:  str = "0.00"
    net_profit:           str = "0.00"
    net_profit_positive:  bool = True


async def query_income_expense(
    db: AsyncSession,
    fiscal_year_id: int,
    period_from: int,
    period_to: int,
    company: Company,
) -> IncExpData:
    # Pull posted journal lines for the period range
    rows = await db.execute(
        select(
            JournalLine.account_id,
            func.sum(JournalLine.debit).label("total_debit"),
            func.sum(JournalLine.credit).label("total_credit"),
        )
        .join(Journal, Journal.id == JournalLine.journal_id)
        .join(AccountingPeriod, AccountingPeriod.id == Journal.period_id)
        .where(
            Journal.status == "posted",
            Journal.company_id == company.id,
            AccountingPeriod.company_id == company.id,
            AccountingPeriod.fiscal_year_id == fiscal_year_id,
            AccountingPeriod.period_number.between(period_from, period_to),
        )
        .group_by(JournalLine.account_id)
    )
    balances: dict[int, tuple[Decimal, Decimal]] = {
        r.account_id: (Decimal(str(r.total_debit or 0)), Decimal(str(r.total_credit or 0)))
        for r in rows
    }

    accounts_result = await db.execute(
        select(Account)
        .where(
            Account.company_id == company.id,
            Account.account_type.in_(["revenue", "expense"]),
            Account.is_header == False,
        )  # noqa: E712
        .order_by(Account.code)
    )
    accounts = accounts_result.scalars().all()

    def _net(acc: Account) -> Decimal:
        dr, cr = balances.get(acc.id, (Decimal("0"), Decimal("0")))
        return (cr - dr) if acc.account_type == "revenue" else (dr - cr)

    def _rows(filter_fn) -> tuple[list[IncExpRow], Decimal]:
        result_rows = []
        total = Decimal("0")
        for a in accounts:
            if not filter_fn(a):
                continue
            amt = _net(a)
            if amt == 0:
                continue
            result_rows.append(IncExpRow(a.code, a.name_th, _fmt(amt)))
            total += amt
        return result_rows, total

    rev_rows,  total_rev  = _rows(lambda a: a.account_type == "revenue" and a.category == "operating_revenue")
    cogs_rows, total_cogs = _rows(lambda a: a.category == "cost_of_goods")
    opex_rows, total_opex = _rows(lambda a: a.category == "operating_expense")

    other_rev_rows,  t_other_rev  = _rows(lambda a: a.account_type == "revenue" and a.category == "other_revenue")
    other_exp_rows,  t_other_exp  = _rows(lambda a: a.account_type == "expense" and a.category == "other_expense")
    other_combined = other_rev_rows + other_exp_rows

    gross = (total_rev - total_cogs).quantize(TWO, ROUND_HALF_UP)
    op    = (gross - total_opex).quantize(TWO, ROUND_HALF_UP)
    net   = (op + t_other_rev - t_other_exp).quantize(TWO, ROUND_HALF_UP)
    margin = (gross / total_rev * 100).quantize(TWO) if total_rev else Decimal("0")

    months = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
              "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    label = (f"งวด {months[period_from]}–{months[period_to]}"
             if period_from != period_to else f"งวด {months[period_from]}")

    return IncExpData(
        company_name=company.name_th,
        company_tax_id=_format_tax_id(company.tax_id),
        fiscal_year_id=fiscal_year_id,
        period_from=period_from,
        period_to=period_to,
        period_label=label,
        generated_at=_thai_date(date.today()),
        revenue_rows=rev_rows,
        cogs_rows=cogs_rows,
        opex_rows=opex_rows,
        other_rows=other_combined,
        total_revenue=_fmt(total_rev),
        total_cogs=_fmt(total_cogs),
        gross_profit=_fmt(gross),
        gross_margin_pct=f"{margin:.2f}",
        total_opex=_fmt(total_opex),
        operating_profit=_fmt(op),
        total_other_revenue=_fmt(t_other_rev),
        total_other_expense=_fmt(t_other_exp),
        net_profit=_fmt(abs(net)),
        net_profit_positive=net >= 0,
    )


# ─── helpers ──────────────────────────────────────────────────────────────────

def _format_tax_id(tax_id: str | None) -> str:
    """Format 13-digit Thai tax ID as X-XXXX-XXXXX-XX-X."""
    if not tax_id or len(tax_id) != 13:
        return tax_id or ""
    t = tax_id
    return f"{t[0]}-{t[1:5]}-{t[5:10]}-{t[10:12]}-{t[12]}"
