from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import cast, func, select, String, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_company, require_viewer
from app.models.account import Account
from app.models.company import Company
from app.models.fiscal import AccountingPeriod
from app.models.invoice import Invoice
from app.models.journal import Journal, JournalLine
from app.models.party import Party
from app.models.tax import VatRecord
from app.models.user import User
from app.schemas.report import (
    AgingOut,
    ArAgingLine,
    BalanceSheetOut,
    IncomeStatementOut,
    ReportLine,
    ReportSection,
    TrialBalanceLine,
    TrialBalanceOut,
    VatPP30Out,
    VatReportLine,
)

router = APIRouter(prefix="/reports", tags=["Financial Reports"])


# ──────────────────────────────────────────────────────────────────────────────
# Helper: pull net balances per account for a given period range
# ──────────────────────────────────────────────────────────────────────────────
async def _get_period_balances(
    db: AsyncSession,
    fiscal_year_id: int,
    period_from: int,
    period_to: int,
    company_id: int,
) -> dict[int, tuple[Decimal, Decimal]]:
    """Returns {account_id: (total_debit, total_credit)}"""
    stmt = (
        select(JournalLine.account_id, func.sum(JournalLine.debit), func.sum(JournalLine.credit))
        .join(Journal, Journal.id == JournalLine.journal_id)
        .join(AccountingPeriod, AccountingPeriod.id == Journal.period_id)
        .where(
            cast(Journal.status, String) == "posted",
            Journal.company_id == company_id,
            AccountingPeriod.company_id == company_id,
            AccountingPeriod.fiscal_year_id == fiscal_year_id,
            AccountingPeriod.period_number >= period_from,
            AccountingPeriod.period_number <= period_to,
        )
        .group_by(JournalLine.account_id)
    )
    result = await db.execute(stmt)
    return {
        row[0]: (Decimal(str(row[1] or 0)), Decimal(str(row[2] or 0)))
        for row in result.all()
    }


async def _get_cumulative_balances(
    db: AsyncSession,
    as_of: date,
    company_id: int,
) -> dict[int, tuple[Decimal, Decimal]]:
    """Returns {account_id: (total_debit, total_credit)} up to as_of date"""
    stmt = (
        select(JournalLine.account_id, func.sum(JournalLine.debit), func.sum(JournalLine.credit))
        .join(Journal, Journal.id == JournalLine.journal_id)
        .where(
            cast(Journal.status, String) == "posted",
            Journal.entry_date <= as_of,
            Journal.company_id == company_id,
        )
        .group_by(JournalLine.account_id)
    )
    result = await db.execute(stmt)
    return {
        row[0]: (Decimal(str(row[1] or 0)), Decimal(str(row[2] or 0)))
        for row in result.all()
    }


# ──────────────────────────────────────────────────────────────────────────────
# TRIAL BALANCE
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/trial-balance", response_model=TrialBalanceOut)
async def trial_balance(
    fiscal_year_id: int = Query(...),
    period_number: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    balances = await _get_period_balances(
        db, fiscal_year_id, period_number, period_number, company.id
    )
    result = await db.execute(
        select(Account).where(
            Account.company_id == company.id,
            Account.is_header == False,
        ).order_by(Account.code)
    )  # noqa: E712
    accounts = result.scalars().all()

    lines = []
    for acc in accounts:
        dr, cr = balances.get(acc.id, (Decimal("0"), Decimal("0")))
        if dr == 0 and cr == 0:
            continue
        lines.append(TrialBalanceLine(
            account_code=acc.code,
            account_name=acc.name_th,
            account_type=acc.account_type,
            total_debit=dr,
            total_credit=cr,
            net_balance=dr - cr,
        ))

    total_dr = sum(ln.total_debit for ln in lines)
    total_cr = sum(ln.total_credit for ln in lines)
    return TrialBalanceOut(
        fiscal_year_id=fiscal_year_id,
        period_number=period_number,
        lines=lines,
        total_debit=total_dr,
        total_credit=total_cr,
    )


# ──────────────────────────────────────────────────────────────────────────────
# INCOME STATEMENT (งบกำไรขาดทุน)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/income-statement", response_model=IncomeStatementOut)
async def income_statement(
    fiscal_year_id: int = Query(...),
    period_from: int = Query(1, ge=1, le=12),
    period_to: int = Query(12, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    if period_from > period_to:
        raise HTTPException(status_code=400, detail="period_from ต้องไม่มากกว่า period_to")

    balances = await _get_period_balances(
        db, fiscal_year_id, period_from, period_to, company.id
    )
    result = await db.execute(
        select(Account)
        .where(
            Account.company_id == company.id,
            cast(Account.account_type, String).in_(["revenue", "expense"]),
            Account.is_header == False,
        )  # noqa: E712
        .order_by(Account.code)
    )
    accounts = result.scalars().all()

    def _net_amount(acc: Account) -> Decimal:
        dr, cr = balances.get(acc.id, (Decimal("0"), Decimal("0")))
        if acc.account_type == "revenue":
            return cr - dr
        return dr - cr  # expense: positive = cost

    def _section(filter_fn, title: str) -> ReportSection:
        lines = [
            ReportLine(account_code=a.code, account_name=a.name_th, amount=_net_amount(a))
            for a in accounts if filter_fn(a) and _net_amount(a) != 0
        ]
        return ReportSection(title=title, lines=lines, total=sum(ln.amount for ln in lines))

    revenue_sec = _section(lambda a: a.account_type == "revenue" and a.category == "operating_revenue", "รายได้จากการดำเนินงาน")
    cogs_sec = _section(lambda a: a.account_type == "expense" and a.category == "cost_of_goods", "ต้นทุนขาย")
    opex_sec = _section(lambda a: a.account_type == "expense" and a.category == "operating_expense", "ค่าใช้จ่ายดำเนินงาน")
    other_rev_sec = _section(lambda a: a.account_type == "revenue" and a.category == "other_revenue", "รายได้อื่น")
    other_exp_sec = _section(lambda a: a.account_type == "expense" and a.category == "other_expense", "ค่าใช้จ่ายอื่น")

    gross_profit = revenue_sec.total - cogs_sec.total
    operating_profit = gross_profit - opex_sec.total
    net_profit = operating_profit + other_rev_sec.total - other_exp_sec.total
    gross_margin = (gross_profit / revenue_sec.total * 100).quantize(Decimal("0.01")) if revenue_sec.total else Decimal("0")

    return IncomeStatementOut(
        fiscal_year_id=fiscal_year_id,
        period_from=period_from,
        period_to=period_to,
        revenue=revenue_sec,
        cost_of_goods=cogs_sec,
        gross_profit=gross_profit,
        gross_margin_pct=gross_margin,
        operating_expenses=opex_sec,
        operating_profit=operating_profit,
        other_revenue=other_rev_sec,
        other_expenses=other_exp_sec,
        net_profit=net_profit,
    )


# ──────────────────────────────────────────────────────────────────────────────
# BALANCE SHEET (งบดุล)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/balance-sheet", response_model=BalanceSheetOut)
async def balance_sheet(
    as_of_date: date = Query(..., description="วันที่ เช่น 2024-12-31"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    balances = await _get_cumulative_balances(db, as_of_date, company.id)
    result = await db.execute(
        select(Account)
        .where(
            Account.company_id == company.id,
            cast(Account.account_type, String).in_(["asset", "liability", "equity"]),
            Account.is_header == False,
        )  # noqa: E712
        .order_by(Account.code)
    )
    accounts = result.scalars().all()

    def _balance(acc: Account) -> Decimal:
        dr, cr = balances.get(acc.id, (Decimal("0"), Decimal("0")))
        return (dr - cr) if acc.normal_balance == "debit" else (cr - dr)

    def _section(type_: str, title: str) -> ReportSection:
        lines = [
            ReportLine(account_code=a.code, account_name=a.name_th, amount=_balance(a))
            for a in accounts if a.account_type == type_ and _balance(a) != 0
        ]
        return ReportSection(title=title, lines=lines, total=sum(ln.amount for ln in lines))

    assets = _section("asset", "สินทรัพย์")
    liabilities = _section("liability", "หนี้สิน")
    equity = _section("equity", "ส่วนของเจ้าของ")

    total_l_e = liabilities.total + equity.total
    return BalanceSheetOut(
        as_of_date=as_of_date.isoformat(),
        assets=assets,
        liabilities=liabilities,
        equity=equity,
        total_liabilities_and_equity=total_l_e,
        is_balanced=abs(assets.total - total_l_e) < Decimal("0.01"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# AR/AP AGING
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/ar-aging", response_model=AgingOut)
async def ar_aging(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    return await _aging_report(db, "ar", company.id)


@router.get("/ap-aging", response_model=AgingOut)
async def ap_aging(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    return await _aging_report(db, "ap", company.id)


async def _aging_report(db: AsyncSession, invoice_type: str, company_id: int) -> AgingOut:
    result = await db.execute(
        select(Invoice, Party)
        .join(Party, Party.id == Invoice.party_id)
        .where(
            cast(Invoice.invoice_type, String) == invoice_type,
            Invoice.company_id == company_id,
            Party.company_id == company_id,
            cast(Invoice.status, String).not_in(["paid", "voided"]),
            Invoice.paid_amount < Invoice.total_amount,
        )
        .order_by(Invoice.due_date)
    )
    rows = result.all()
    today = date.today()

    def _bucket(days: int) -> str:
        if days <= 0:
            return "ยังไม่ถึงกำหนด"
        if days <= 30:
            return "เกิน 1-30 วัน"
        if days <= 60:
            return "เกิน 31-60 วัน"
        if days <= 90:
            return "เกิน 61-90 วัน"
        return "เกิน 90 วันขึ้นไป"

    lines = []
    for invoice, party in rows:
        balance = Decimal(str(invoice.balance_due))
        due_date = invoice.due_date.date() if hasattr(invoice.due_date, "date") else invoice.due_date
        days_overdue = (today - due_date).days
        lines.append(ArAgingLine(
            customer_code=party.code,
            customer_name=party.name_th,
            invoice_number=invoice.invoice_number,
            invoice_date=invoice.invoice_date.date().isoformat(),
            due_date=due_date.isoformat(),
            total_amount=Decimal(str(invoice.total_amount)),
            balance_due=balance,
            days_overdue=days_overdue,
            aging_bucket=_bucket(days_overdue),
        ))

    return AgingOut(lines=lines, total_balance=sum(ln.balance_due for ln in lines))


# ──────────────────────────────────────────────────────────────────────────────
# VAT REPORT — ภพ.30
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/vat-pp30", response_model=VatPP30Out)
async def vat_pp30(
    year: int = Query(..., description="ปี ค.ศ. เช่น 2024"),
    month: int = Query(..., ge=1, le=12, description="เดือน 1-12"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
    company: Company = Depends(get_current_company),
):
    result = await db.execute(
        select(
            VatRecord.record_type,
            func.count().label("doc_count"),
            func.sum(VatRecord.taxable_amount).label("total_taxable"),
            func.sum(VatRecord.vat_amount).label("total_vat"),
        )
        .where(
            VatRecord.period_year == year,
            VatRecord.period_month == month,
            VatRecord.company_id == company.id,
        )
        .group_by(VatRecord.record_type)
    )
    rows = {row.record_type: row for row in result.all()}

    def _make(record_type: str) -> VatReportLine:
        row = rows.get(record_type)
        return VatReportLine(
            doc_count=row.doc_count if row else 0,
            total_taxable=Decimal(str(row.total_taxable or 0)) if row else Decimal("0"),
            total_vat=Decimal(str(row.total_vat or 0)) if row else Decimal("0"),
        )

    output = _make("output")
    input_ = _make("input")
    net_payable = output.total_vat - input_.total_vat

    return VatPP30Out(
        period_year=year,
        period_month=month,
        output_vat=output,
        input_vat=input_,
        net_vat_payable=net_payable,
    )
