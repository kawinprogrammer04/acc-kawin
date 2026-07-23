import { api } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WalletAccount {
  id: number;
  name: string;
  account_type: "bank" | "cash" | "ewallet" | "credit_card" | "other";
  owner_type: "company" | "personal" | "mixed";
  bank_name?: string;
  account_number?: string;
  account_holder?: string;
  currency: string;
  opening_balance: number;
  current_balance: number;
  is_active: boolean;
  notes?: string;
  created_at: string;
}

export interface Holder {
  id: number;
  name: string;
  holder_type: "company" | "personal" | "tax" | "salary" | "project" | "reserve" | "stock" | "other";
  owner_type: "company" | "personal" | "mixed";
  wallet_account_id?: number;
  purpose?: string;
  opening_balance: number;
  current_balance: number;
  responsible_user_id?: number;
  is_active: boolean;
  notes?: string;
  created_at: string;
}

export interface CashflowCategory {
  id: number;
  type: "income" | "expense" | "payable" | "receivable";
  name: string;
  parent_id?: number;
  color?: string;
  icon?: string;
  sort_order: number;
  is_active: boolean;
}

export interface IncomeEntry {
  id: string;
  income_date: string;
  document_no?: string;
  income_type?: string;
  category_id?: number;
  customer_name?: string;
  description: string;
  amount: number;
  vat_amount: number;
  withholding_tax: number;
  net_amount: number;
  payment_channel?: string;
  wallet_account_id?: number;
  holder_id?: number;
  status: "pending" | "completed" | "cancelled";
  received_date?: string;
  owner_type: string;
  notes?: string;
  created_at: string;
}

export interface ExpenseEntry {
  id: string;
  expense_date: string;
  document_no?: string;
  expense_type?: string;
  category_id?: number;
  vendor_name?: string;
  description: string;
  amount: number;
  vat_amount: number;
  withholding_tax: number;
  net_amount: number;
  payment_channel?: string;
  wallet_account_id?: number;
  holder_id?: number;
  is_company_expense: boolean;
  status: "pending" | "completed" | "cancelled";
  paid_date?: string;
  owner_type: string;
  notes?: string;
  created_at: string;
}

export interface Payable {
  id: string;
  creditor_name: string;
  creditor_type?: string;
  description?: string;
  issue_date: string;
  due_date?: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  expected_account_id?: number;
  expected_holder_id?: number;
  status: "unpaid" | "partial" | "paid" | "overdue" | "cancelled";
  reference_doc?: string;
  notes?: string;
  created_at: string;
}

export interface Receivable {
  id: string;
  debtor_name: string;
  debtor_type?: string;
  description?: string;
  issue_date: string;
  due_date?: string;
  total_amount: number;
  received_amount: number;
  remaining_amount: number;
  expected_account_id?: number;
  expected_holder_id?: number;
  status: "unreceived" | "partial" | "received" | "overdue" | "cancelled";
  reference_doc?: string;
  notes?: string;
  created_at: string;
}

export interface Transfer {
  id: string;
  transfer_date: string;
  transfer_type: string;
  from_account_id?: number;
  from_holder_id?: number;
  to_account_id?: number;
  to_holder_id?: number;
  amount: number;
  fee: number;
  reason?: string;
  status: string;
  notes?: string;
  created_at: string;
}

// ── API clients ─────────────────────────────────────────────────────────────

export const walletAccountsApi = {
  list: (params?: { owner_type?: string; is_active?: boolean }) =>
    api.get<WalletAccount[]>("/wallet-accounts", { params }).then((r) => r.data),
  get: (id: number) => api.get<WalletAccount>(`/wallet-accounts/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post<WalletAccount>("/wallet-accounts", data).then((r) => r.data),
  update: (id: number, data: unknown) =>
    api.patch<WalletAccount>(`/wallet-accounts/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/wallet-accounts/${id}`),
};

export const holdersApi = {
  list: (params?: { holder_type?: string; wallet_account_id?: number; is_active?: boolean }) =>
    api.get<Holder[]>("/holders", { params }).then((r) => r.data),
  get: (id: number) => api.get<Holder>(`/holders/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post<Holder>("/holders", data).then((r) => r.data),
  update: (id: number, data: unknown) =>
    api.patch<Holder>(`/holders/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/holders/${id}`),
};

export const categoriesApi = {
  list: (type?: string) =>
    api.get<CashflowCategory[]>("/cashflow-categories", { params: { type } }).then((r) => r.data),
  create: (data: unknown) => api.post<CashflowCategory>("/cashflow-categories", data).then((r) => r.data),
  update: (id: number, data: unknown) =>
    api.patch<CashflowCategory>(`/cashflow-categories/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/cashflow-categories/${id}`),
};

export const incomeApi = {
  list: (params?: {
    start_date?: string; end_date?: string; status?: string;
    wallet_account_id?: number; holder_id?: number; category_id?: number;
    keyword?: string; limit?: number; offset?: number;
  }) => api.get<IncomeEntry[]>("/income", { params }).then((r) => r.data),
  get: (id: string) => api.get<IncomeEntry>(`/income/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post<IncomeEntry>("/income", data).then((r) => r.data),
  update: (id: string, data: unknown) =>
    api.patch<IncomeEntry>(`/income/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/income/${id}`),
};

export const expensesApi = {
  list: (params?: {
    start_date?: string; end_date?: string; status?: string;
    wallet_account_id?: number; holder_id?: number; category_id?: number;
    is_company_expense?: boolean; keyword?: string; limit?: number; offset?: number;
  }) => api.get<ExpenseEntry[]>("/expenses", { params }).then((r) => r.data),
  get: (id: string) => api.get<ExpenseEntry>(`/expenses/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post<ExpenseEntry>("/expenses", data).then((r) => r.data),
  update: (id: string, data: unknown) =>
    api.patch<ExpenseEntry>(`/expenses/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/expenses/${id}`),
};

export const payablesApi = {
  list: (params?: { status?: string; due_before?: string; keyword?: string; limit?: number }) =>
    api.get<Payable[]>("/payables", { params }).then((r) => r.data),
  get: (id: string) => api.get<Payable>(`/payables/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post<Payable>("/payables", data).then((r) => r.data),
  update: (id: string, data: unknown) =>
    api.patch<Payable>(`/payables/${id}`, data).then((r) => r.data),
  pay: (id: string, data: { amount: number; account_id?: number; holder_id?: number; paid_date: string }) =>
    api.post<Payable>(`/payables/${id}/pay`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/payables/${id}`),
};

export const receivablesApi = {
  list: (params?: { status?: string; due_before?: string; keyword?: string; limit?: number }) =>
    api.get<Receivable[]>("/receivables", { params }).then((r) => r.data),
  get: (id: string) => api.get<Receivable>(`/receivables/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post<Receivable>("/receivables", data).then((r) => r.data),
  update: (id: string, data: unknown) =>
    api.patch<Receivable>(`/receivables/${id}`, data).then((r) => r.data),
  receive: (id: string, data: { amount: number; account_id?: number; holder_id?: number; received_date: string }) =>
    api.post<Receivable>(`/receivables/${id}/receive`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/receivables/${id}`),
};

export const transfersApi = {
  list: (params?: { start_date?: string; end_date?: string; transfer_type?: string; limit?: number }) =>
    api.get<Transfer[]>("/transfers", { params }).then((r) => r.data),
  create: (data: unknown) => api.post<Transfer>("/transfers", data).then((r) => r.data),
  cancel: (id: string) => api.delete(`/transfers/${id}`),
};

export const dashboardApi = {
  getCashflow: (params?: { month?: number; year?: number }) =>
    api.get("/cashflow-dashboard", { params }).then((r) => r.data),
  getSchedule: (params?: { start_date?: string; end_date?: string }) =>
    api.get("/payment-schedule", { params }).then((r) => r.data),
  getLogs: (params?: { resource_type?: string; limit?: number }) =>
    api.get("/activity-logs", { params }).then((r) => r.data),
  getReport: (params: { start_date: string; end_date: string; report_type?: string }) =>
    api.get("/cashflow-report", { params }).then((r) => r.data),
};

export const documentsApi = {
  upload: (formData: FormData) =>
    api.post("/documents/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data),
  list: (referenceType: string, referenceId: string) =>
    api.get(`/documents/${referenceType}/${referenceId}`).then((r) => r.data),
  delete: (id: string) => api.delete(`/documents/${id}`),
};
