from decimal import Decimal
from pydantic import BaseModel


class ReportLine(BaseModel):
    account_code: str
    account_name: str
    amount: Decimal


class ReportSection(BaseModel):
    title: str
    lines: list[ReportLine]
    total: Decimal


class IncomeStatementOut(BaseModel):
    fiscal_year_id: int
    period_from: int
    period_to: int
    revenue: ReportSection
    cost_of_goods: ReportSection
    gross_profit: Decimal
    gross_margin_pct: Decimal
    operating_expenses: ReportSection
    operating_profit: Decimal
    other_revenue: ReportSection
    other_expenses: ReportSection
    net_profit: Decimal


class BalanceSheetOut(BaseModel):
    as_of_date: str
    assets: ReportSection
    liabilities: ReportSection
    equity: ReportSection
    total_liabilities_and_equity: Decimal
    is_balanced: bool


class TrialBalanceLine(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    total_debit: Decimal
    total_credit: Decimal
    net_balance: Decimal


class TrialBalanceOut(BaseModel):
    fiscal_year_id: int
    period_number: int
    lines: list[TrialBalanceLine]
    total_debit: Decimal
    total_credit: Decimal


class ArAgingLine(BaseModel):
    customer_code: str
    customer_name: str
    invoice_number: str
    invoice_date: str
    due_date: str
    total_amount: Decimal
    balance_due: Decimal
    days_overdue: int
    aging_bucket: str


class AgingOut(BaseModel):
    lines: list[ArAgingLine]
    total_balance: Decimal


class VatReportLine(BaseModel):
    doc_count: int
    total_taxable: Decimal
    total_vat: Decimal


class VatPP30Out(BaseModel):
    period_year: int
    period_month: int
    output_vat: VatReportLine
    input_vat: VatReportLine
    net_vat_payable: Decimal
