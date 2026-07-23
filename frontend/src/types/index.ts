// ── Company ──────────────────────────────────────────────────────────────────
export interface Company {
  id: number;
  code: string;
  name_th: string;
  name_en?: string;
  tax_id?: string;
  is_active: boolean;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  role: "admin" | "approver" | "accountant" | "viewer";
  is_active: boolean;
  companies?: Company[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  username: string;
  role: string;
}

// ── Accounts ─────────────────────────────────────────────────────────────────
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  id: number;
  code: string;
  name_th: string;
  name_en: string | null;
  account_type: AccountType;
  category: string;
  normal_balance: "debit" | "credit";
  parent_id: number | null;
  level: number;
  is_header: boolean;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ── Journals ──────────────────────────────────────────────────────────────────
export interface JournalLine {
  id?: number;
  line_number: number;
  account_id: number;
  account_code?: string;
  account_name?: string;
  description: string;
  debit: number;
  credit: number;
  party_id?: string | null;
}

export interface Journal {
  id: string;
  entry_number: string;
  entry_date: string;
  period_id: number;
  description: string;
  reference: string | null;
  status: "draft" | "posted" | "voided";
  total_debit: number;
  total_credit: number;
  lines: JournalLine[];
  created_at: string;
}

// ── Invoices ──────────────────────────────────────────────────────────────────
export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "voided";

export interface InvoiceLine {
  id: number;
  line_number: number;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_pct: number;
  discount_amount: number;
  line_total: number;
  wht_type: string | null;
  wht_rate: number | null;
  wht_amount: number;
}

export interface Invoice {
  id: string;
  invoice_type: "ar" | "ap";
  invoice_number: string;
  reference: string | null;
  invoice_date: string;
  due_date: string;
  party_id: string;
  party_name: string | null;
  period_id: number;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  vat_amount: number;
  wht_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  status: InvoiceStatus;
  is_vat_included: boolean;
  notes: string | null;
  journal_id: string | null;
  lines: InvoiceLine[];
  created_at: string;
}

// ── Reports ───────────────────────────────────────────────────────────────────
export interface ReportLine {
  account_code: string;
  account_name: string;
  amount: number;
}

export interface ReportSection {
  title: string;
  lines: ReportLine[];
  total: number;
}

export interface IncomeStatement {
  fiscal_year_id: number;
  period_from: number;
  period_to: number;
  revenue: ReportSection;
  cost_of_goods: ReportSection;
  gross_profit: number;
  gross_margin_pct: number;
  operating_expenses: ReportSection;
  operating_profit: number;
  other_revenue: ReportSection;
  other_expenses: ReportSection;
  net_profit: number;
}

export interface BalanceSheet {
  as_of_date: string;
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection;
  total_liabilities_and_equity: number;
  is_balanced: boolean;
}

export interface TrialBalanceLine {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  net_balance: number;
}

export interface TrialBalance {
  fiscal_year_id: number;
  period_number: number;
  lines: TrialBalanceLine[];
  total_debit: number;
  total_credit: number;
}

export interface AgingLine {
  customer_code: string;
  customer_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total_amount: number;
  balance_due: number;
  days_overdue: number;
  aging_bucket: string;
}

export interface AgingReport {
  lines: AgingLine[];
  total_balance: number;
}

export interface VatPP30 {
  period_year: number;
  period_month: number;
  output_vat: { doc_count: number; total_taxable: number; total_vat: number };
  input_vat: { doc_count: number; total_taxable: number; total_vat: number };
  net_vat_payable: number;
}
