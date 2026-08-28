import axios from "axios";
import { attachAuth } from "./client";

// Talks to the credit_statement_matcher service, reverse-proxied at
// /statement/ (see nginx/conf.d/accounting.conf). Its JSON routes live under
// /statement/api/* (app/api.py in that service) and require the same bearer
// token as the main `api` client — attachAuth() wires that up identically.
export const statementApi = attachAuth(axios.create({ baseURL: "/statement/api" }));

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────────

export type MatchStatus = "unmatched" | "matched" | "ignored";

export interface Statement {
  id: number;
  original_filename: string;
  stored_filename: string;
  uploaded_at: string;
  row_count: number;
  deposit_count: number;
  withdraw_count: number;
  total_deposit: number;
  total_withdraw: number;
  date_from: string | null;
  date_to: string | null;
  matched_count: number;
  unmatched_count: number;
  duplicate_count: number;
  issuer: string | null;
  statement_type: string | null;
  processing_method: string | null;
  masked_reference: string | null;
  parse_warnings: string | null;
}

export interface Transaction {
  id: number;
  statement_id: number;
  transaction_date: string;
  transaction_time: string | null;
  description: string;
  amount: number;
  deposit_amount: number | null;
  withdraw_amount: number | null;
  channel: string | null;
  tr_code: string | null;
  is_duplicate: number;
  has_attachment: number;
  card_last4: string | null;
  category: string;
  match_status: MatchStatus;
  match_group_id: number | null;
  match_method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields present on some endpoints only (review/transactions).
  original_filename?: string;
  issuer?: string | null;
  statement_type?: string | null;
  masked_reference?: string | null;
  card_name?: string | null;
  target_reference?: string | null;
  match_type?: string | null;
  reference_item_id?: number | null;
  match_notes?: string | null;
  ref_source_filename?: string | null;
  ref_date?: string | null;
  ref_party_name?: string | null;
  ref_ocr_reference?: string | null;
}

export interface ReferenceItem {
  id: number;
  source_filename: string | null;
  reference: string;
  transaction_date: string | null;
  transaction_time: string | null;
  amount: number;
  party_name: string | null;
  has_attachment: number;
  match_status: MatchStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchCandidate extends ReferenceItem {
  match_score: number;
  match_reason: string;
}

export interface ReferenceSource {
  source_filename: string;
  total: number;
  matched: number;
  unmatched: number;
  imported_at: string | null;
}

export interface Card {
  id: number;
  name: string;
  last4: string;
  holder_name: string | null;
  bank_name: string | null;
  created_at: string;
  transaction_count: number;
  total: number;
  // Reconciliation: total_topup ("เติมเงินเข้าบัตร" — negative rows, i.e.
  // PAYMENT AT BANK/refunds) vs total_spend (positive rows). Flag when
  // total_spend > total_topup — the card hasn't been topped up enough to
  // cover what's been charged to it.
  total_topup: number;
  total_spend: number;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  detail: string | null;
  created_at: string;
}

export interface UploadJobStatus {
  status: "queued" | "processing" | "complete" | "failed" | "missing";
  step: number;
  message: string;
  elapsed_seconds: number;
  preview_token?: string;
  redirect_url?: string;
  error?: string;
}

export interface PreviewRow {
  index: number;
  include: boolean;
  reviewed: boolean;
  requires_review: boolean;
  row_errors: string[];
  transaction_date: string | null;
  transaction_time: string | null;
  description: string;
  amount: number | null;
  card_last4: string | null;
  category: string;
  tr_code: string | null;
  channel: string | null;
  confidence: number;
  warnings: string[];
  [key: string]: unknown;
}

export interface PreviewPayload {
  preview_token: string;
  original_name: string;
  statement: Record<string, unknown>;
  rows: PreviewRow[];
}

export interface ReviewData {
  statements: Statement[];
  selected_statement_id: number | null;
  issue: string;
  rows: Transaction[];
  totals: {
    total: number; matched: number; unmatched: number; ignored: number;
    duplicates: number; missing_attachments: number; deposits: number;
  };
  ref_stats: { total: number; matched: number; unmatched: number; missing_attachments: number };
  candidates_by_tx: Record<string, MatchCandidate[]>;
}

export interface SummaryFilters {
  date_from?: string;
  date_to?: string;
  card_last4?: string;
  platform?: "facebook" | "tiktok" | "google" | "payment" | "other";
  status?: "matched" | "unmatched" | "duplicates" | "missing-attachments" | "ignored";
  statement_id?: number;
}

export interface TransactionsData {
  transactions: Transaction[];
  statements: Pick<Statement, "id" | "original_filename">[];
  cards: Card[];
  filters: { statement_id: number | null; status: string | null; card: string | null; q: string | null };
}

export interface ManualEditData {
  statements: Pick<Statement, "id" | "original_filename">[];
  transactions: Transaction[];
  reference_items: ReferenceItem[];
  warning_stats: { unmatched: number; duplicates: number };
}

export interface SummaryData {
  totals: {
    transaction_count: number; charges: number; refunds: number; net: number;
    matched: number; unmatched: number; ignored: number; duplicates: number;
    missing_attachments: number;
  };
  match_groups: { count: number; group_count: number; no_attachment_count: number };
  categories: { category: string; count: number; total: number }[];
  months: { month: string; count: number; total: number }[];
  filter_options: {
    months: { value: string; count: number }[];
    cards: { last4: string; name: string | null; count: number }[];
    statements: { id: number; original_filename: string; count: number }[];
    platforms: { value: NonNullable<SummaryFilters["platform"]>; label: string; count: number }[];
  };
}

// ── Statements / upload ──────────────────────────────────────────────────

export const statementsApi = {
  list: (limit?: number) =>
    statementApi.get<{ statements: Statement[] }>("/statements", { params: { limit } }).then((r) => r.data.statements),
  delete: (id: number) => statementApi.delete(`/statements/${id}`).then((r) => r.data),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return statementApi
      .post<{ job_token: string }>("/statements/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
  uploadImages: (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    return statementApi
      .post<{ job_token: string }>("/statements/images", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
  jobStatus: (jobToken: string) =>
    statementApi.get<UploadJobStatus>(`/statements/upload-jobs/${jobToken}`).then((r) => r.data),
  getPreview: (previewToken: string) =>
    statementApi.get<PreviewPayload>(`/statements/preview/${previewToken}`).then((r) => r.data),
  confirmPreview: (
    previewToken: string,
    rows: Array<{
      include: boolean; reviewed: boolean; transaction_date: string; description: string;
      amount: string; card_last4: string; tr_code: string;
    }>
  ) =>
    statementApi
      .post<{ kind: "statement" | "reference_items"; statement_id?: number; inserted?: number }>(
        `/statements/preview/${previewToken}/confirm`,
        { rows }
      )
      .then((r) => r.data),
  cancelPreview: (previewToken: string) =>
    statementApi.post(`/statements/preview/${previewToken}/cancel`).then((r) => r.data),
};

// ── Review / matching ─────────────────────────────────────────────────────

export const reviewApi = {
  get: (params: SummaryFilters & { issue?: string; all_statements?: boolean }) =>
    statementApi.get<ReviewData>("/review", { params }).then((r) => r.data),
};

export const matchesApi = {
  manual: (data: {
    transaction_ids: number[]; target_reference: string; expected_amount: number;
    has_attachment?: boolean; notes?: string;
  }) => statementApi.post<{ group_id: number }>("/matches/manual", data).then((r) => r.data),
  withReference: (data: { transaction_ids: number[]; reference_item_id: number; notes?: string }) =>
    statementApi.post<{ group_id: number }>("/matches/reference", data).then((r) => r.data),
  auto: (statement_id?: number) =>
    statementApi.post<{ matched: number }>("/matches/auto", { statement_id }).then((r) => r.data),
  remove: (groupId: number) => statementApi.delete(`/matches/${groupId}`).then((r) => r.data),
};

// ── Transactions ──────────────────────────────────────────────────────────

export const transactionsApi = {
  list: (params: { statement_id?: number; status?: string; card?: string; q?: string }) =>
    statementApi.get<TransactionsData>("/transactions", { params }).then((r) => r.data),
  update: (id: number, data: Partial<Transaction> & { transaction_date: string; description: string; amount: number }) =>
    statementApi.patch(`/transactions/${id}`, data).then((r) => r.data),
};

export const manualEditApi = {
  get: () => statementApi.get<ManualEditData>("/manual-edit").then((r) => r.data),
};

// ── Reference items ───────────────────────────────────────────────────────

export const referenceItemsApi = {
  list: () =>
    statementApi
      .get<{ items: ReferenceItem[]; stats: Record<string, number>; sources: ReferenceSource[] }>("/reference-items")
      .then((r) => r.data),
  create: (data: {
    reference: string; amount: number; transaction_date?: string; transaction_time?: string;
    party_name?: string; has_attachment?: boolean; notes?: string;
  }) => statementApi.post<{ id: number }>("/reference-items", data).then((r) => r.data),
  update: (id: number, data: {
    reference: string; amount: number; transaction_date?: string; transaction_time?: string;
    party_name?: string; notes?: string;
  }) => statementApi.patch(`/reference-items/${id}`, data).then((r) => r.data),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return statementApi
      .post<{ inserted: number }>("/reference-items/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
  deleteSource: (sourceFilename: string) =>
    statementApi.delete(`/reference-items/sources/${encodeURIComponent(sourceFilename)}`).then((r) => r.data),
};

// ── Cards ─────────────────────────────────────────────────────────────────

export const cardsApi = {
  list: () => statementApi.get<{ cards: Card[]; unknown_cards: { card_last4: string; transaction_count: number; total_topup: number; total_spend: number }[] }>("/cards").then((r) => r.data),
  create: (data: { name: string; last4: string; holder_name?: string; bank_name?: string }) =>
    statementApi.post("/cards", data).then((r) => r.data),
  delete: (id: number) => statementApi.delete(`/cards/${id}`).then((r) => r.data),
};

// ── Audit / summary ───────────────────────────────────────────────────────

export const auditLogsApi = {
  list: () => statementApi.get<{ logs: AuditLog[] }>("/audit-logs").then((r) => r.data.logs),
};

export const summaryApi = {
  get: (params: SummaryFilters = {}) => statementApi.get<SummaryData>("/summary", { params }).then((r) => r.data),
  exportCsv: async (kind: "matched" | "unmatched" | "missing-attachments", params: SummaryFilters = {}) => {
    const response = await statementApi.get<Blob>(`/export/${kind}.csv`, { params, responseType: "blob" });
    downloadBlob(response.data, `${kind}.csv`);
  },
  exportExcel: async (params: SummaryFilters = {}) => {
    const response = await statementApi.get<Blob>("/export/report.xlsx", { params, responseType: "blob" });
    downloadBlob(response.data, "reconciliation.xlsx");
  },
};

