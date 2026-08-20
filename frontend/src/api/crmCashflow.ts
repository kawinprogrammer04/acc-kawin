import { api } from "./client";

export interface CrmCashflowCategory {
  cfcat_id: number;
  cfcat_name: string;
  cfcat_status: 0 | 1;
  comp_id: number;
}

export interface CrmCashflowSource {
  cflist_id: number;
  cflist_name: string;
  cfcat_id: number;
  cflist_status: 0 | 1;
  comp_id: number;
  cflist_hide?: number | null;
  cfcat_name?: string;
}

export interface CrmCashflowDepartment {
  cfstate_dep_id: number;
  cfstate_dep_name: string;
  cfstate_dep_status: 0 | 1;
  comp_id: number;
}

export type CrmCashflowDocumentType = "tax_invoice" | "cash_bill" | "other";
export type CrmCashflowVerificationStatus = "pending" | "verified";
export type CrmCashflowInvoiceStatus =
  | "none" | "pending" | "received" | CrmCashflowDocumentType;

export interface CrmCashflowStatementFilters {
  start_date?: string;
  end_date?: string;
  cfcat_id?: number;
  verification_status?: CrmCashflowVerificationStatus;
  invoice_status?: CrmCashflowInvoiceStatus;
}

export interface CrmCashflowStatement {
  cfstate_id: number;
  cfstate_date: string;
  cfcat_id: number;
  cflist_id: number;
  user_id: number;
  comp_id: number;
  cfstate_amount: number;
  cfstate_amount_str: string;
  cfstate_refrain: 0 | 1;
  cfstate_invoice: 0 | 1 | null;
  cfstate_document_type: CrmCashflowDocumentType | null;
  cfstate_verified: 0 | 1;
  cfstate_detail?: string | null;
  cfstate_status: 0 | 1;
  cfstate_dep_id?: number | null;
  cfstate_ref?: string | null;
  attachment_count: number;
  cfcat_name: string;
  cflist_name: string;
  cfstate_dep_name?: string | null;
  user_name: string;
}

export interface CrmCashflowDashboardSummary {
  sum_revenue: number;
  sum_expenses: number;
  verified_count: number;
  pending_count: number;
  verified_revenue: number;
  verified_expenses: number;
  pending_revenue: number;
  pending_expenses: number;
}

export interface CrmStatementInput {
  cfstate_date: string;
  cfcat_id: number;
  cflist_id: number;
  cfstate_dep_id?: number | null;
  cfstate_invoice: 0 | 1 | null;
  cfstate_refrain: 0 | 1;
  cfstate_detail?: string;
  cfstate_amount: number;
  cfstate_ref?: string;
}

export type DuplicateAction = "skip" | "update" | "create";

export interface DuplicateItem {
  index: number;
  existing_id: number;
  item: CrmStatementInput;
}

export interface CheckDuplicatesResult {
  duplicates: DuplicateItem[];
}

export interface CreateStatementsResult {
  status: number;
  created: number;
  skipped: number;
  updated: number;
}

export interface CrmCashflowAttachment {
  id: string;
  file_name: string;
  content_type: string;
  file_size: number;
  created_at: string;
  uploaded_by?: string;
}

// ── Import templates ─────────────────────────────────────────────────────────
// A template maps an Excel column name (A, J, AO, ...) in an uploaded file to
// one of these keys. "skip" marks a column the parser should ignore. Kept in
// sync with ImportFieldKey in backend/app/routers/crm_cashflow.py.
export type ImportFieldKey =
  | "date" | "category" | "source" | "detail" | "refrain"
  | "income" | "expense" | "amount" | "ref" | "department" | "skip";

export const IMPORT_FIELD_LABELS: Record<ImportFieldKey, string> = {
  date: "วันที่",
  category: "หัวข้อ",
  source: "note",
  detail: "Description",
  refrain: "คำนวณต้นทุน",
  income: "รายรับ",
  expense: "รายจ่าย",
  amount: "จำนวนเงิน (+รับ / -จ่าย)",
  ref: "Ref",
  department: "แผนก",
  skip: "ข้าม (ไม่ใช้คอลัมน์นี้)",
};

export interface ImportTemplateColumn {
  field: ImportFieldKey;
  label: string;
  column?: string | null;
}

export interface CrmCashflowImportTemplate {
  cfimptpl_id: number;
  cfimptpl_name: string;
  cfimptpl_header_row: boolean;
  cfimptpl_columns: ImportTemplateColumn[];
  cfimptpl_status: 0 | 1;
  comp_id: number;
}

export interface ImportTemplateInput {
  cfimptpl_name: string;
  cfimptpl_header_row: boolean;
  cfimptpl_columns: ImportTemplateColumn[];
}

export interface ImportPreviewRow {
  row_number: number;
  raw: string[];
  data?: {
    cfstate_date: string;
    category: string;
    source: string;
    detail: string;
    invoice: 0 | 1 | null;
    refrain: 0 | 1;
    income: number;
    expense: number;
    ref: string;
    department: string;
  } | null;
  errors: string[];
  duplicate_id?: number | null;
}

export interface ImportDuplicateRow {
  row_number: number;
  existing_id: number;
}

export interface ImportPreview {
  status: number;
  headers: string[];
  preview: ImportPreviewRow[];
  total_rows: number;
  error_count: number;
  error_rows: string[][];
  error_details: string[];
  warnings: string[];
  duplicate_count: number;
  duplicates: ImportDuplicateRow[];
}

export interface ImportResult {
  status: number;
  imported: number;
  skipped: number;
  updated: number;
  errors: number;
  error_rows: string[][];
  error_details: string[];
}

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

function importForm(
  file: File,
  headerRow: boolean,
  useExistingData: boolean,
  duplicateAction?: DuplicateAction,
  skipRows?: number[],
  templateId?: number,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("header_row", String(headerRow));
  form.append("use_existing_data", String(useExistingData));
  if (duplicateAction) form.append("duplicate_action", duplicateAction);
  if (skipRows && skipRows.length) form.append("skip_rows", JSON.stringify(skipRows));
  if (templateId != null) form.append("template_id", String(templateId));
  return form;
}

export const crmCashflowApi = {
  categories: (includeInactive = false) =>
    api.get<CrmCashflowCategory[]>("/crm-cashflow/categories", {
      params: { include_inactive: includeInactive },
    }).then((response) => response.data),
  createCategory: (cfcat_name: string) =>
    api.post<CrmCashflowCategory>("/crm-cashflow/categories", { cfcat_name })
      .then((response) => response.data),
  updateCategory: (id: number, data: Partial<Pick<CrmCashflowCategory, "cfcat_name" | "cfcat_status">>) =>
    api.patch<CrmCashflowCategory>(`/crm-cashflow/categories/${id}`, data)
      .then((response) => response.data),
  deleteCategory: (id: number) => api.delete(`/crm-cashflow/categories/${id}`),

  sources: (cfcat_id?: number, includeInactive = false) =>
    api.get<CrmCashflowSource[]>("/crm-cashflow/sources", {
      params: { cfcat_id, include_inactive: includeInactive },
    }).then((response) => response.data),
  createSource: (data: { cflist_name: string; cfcat_id: number }) =>
    api.post<CrmCashflowSource>("/crm-cashflow/sources", data).then((response) => response.data),
  updateSource: (id: number, data: Partial<Pick<CrmCashflowSource, "cflist_name" | "cflist_status" | "cflist_hide">>) =>
    api.patch<CrmCashflowSource>(`/crm-cashflow/sources/${id}`, data)
      .then((response) => response.data),
  deleteSource: (id: number) => api.delete(`/crm-cashflow/sources/${id}`),
  moveSource: (id: number, data: { new_cfcat_id: number; new_cflist_id?: number; new_list_name?: string }) =>
    api.post(`/crm-cashflow/sources/${id}/move`, data).then((response) => response.data),

  departments: (includeInactive = false) =>
    api.get<CrmCashflowDepartment[]>("/crm-cashflow/departments", {
      params: { include_inactive: includeInactive },
    }).then((response) => response.data),
  createDepartment: (cfstate_dep_name: string) =>
    api.post<CrmCashflowDepartment>("/crm-cashflow/departments", { cfstate_dep_name })
      .then((response) => response.data),
  updateDepartment: (id: number, data: Partial<Pick<CrmCashflowDepartment, "cfstate_dep_name" | "cfstate_dep_status">>) =>
    api.patch<CrmCashflowDepartment>(`/crm-cashflow/departments/${id}`, data)
      .then((response) => response.data),
  deleteDepartment: (id: number) => api.delete(`/crm-cashflow/departments/${id}`),

  statements: (params: CrmCashflowStatementFilters) =>
    api.get<{
      items: CrmCashflowStatement[];
      sum_revenue: number;
      sum_expenses: number;
      total: number;
      dashboard: CrmCashflowDashboardSummary;
    }>(
      "/crm-cashflow/statements", { params }
    ).then((response) => response.data),
  invoices: (params: { start_date?: string; end_date?: string; cfcat_id?: number }) =>
    api.get<{ items: CrmCashflowStatement[]; total: number }>("/crm-cashflow/invoices", { params })
      .then((response) => response.data),
  createStatements: (items: CrmStatementInput[], duplicateAction: DuplicateAction = "skip") =>
    api.post<CreateStatementsResult>("/crm-cashflow/statements/batch", {
      items, duplicate_action: duplicateAction,
    }).then((response) => response.data),
  checkDuplicates: (items: CrmStatementInput[]) =>
    api.post<CheckDuplicatesResult>("/crm-cashflow/statements/check-duplicates", { items })
      .then((response) => response.data),
  updateStatement: (id: number, data: {
    cfstate_invoice?: 0 | 1;
    cfstate_refrain?: 0 | 1;
    cfstate_verified?: 0 | 1;
    cfstate_document_type?: CrmCashflowDocumentType | null;
  }) =>
    api.patch(`/crm-cashflow/statements/${id}`, data).then((response) => response.data),
  deleteStatement: (id: number) => api.delete(`/crm-cashflow/statements/${id}`),
  exportStatements: async (params: CrmCashflowStatementFilters) => {
    const response = await api.get<Blob>("/crm-cashflow/statements/export", {
      params,
      responseType: "blob",
    });
    downloadBlob(response.data, `cashflow_statement_${new Date().toISOString().slice(0, 10)}.xlsx`);
  },
  exportStatementFiles: async (params: CrmCashflowStatementFilters) => {
    const response = await api.get<Blob>("/crm-cashflow/statements/attachments/export", {
      params,
      responseType: "blob",
    });
    downloadBlob(response.data, `crm_cashflow_files_${new Date().toISOString().slice(0, 10)}.zip`);
  },

  previewImport: (file: File, headerRow: boolean, useExistingData: boolean, templateId?: number) =>
    api.post<ImportPreview>(
      "/crm-cashflow/import/preview",
      importForm(file, headerRow, useExistingData, undefined, undefined, templateId),
      { headers: { "Content-Type": "multipart/form-data" } },
    ).then((response) => response.data),
  importFile: (
    file: File,
    headerRow: boolean,
    useExistingData: boolean,
    duplicateAction: DuplicateAction = "skip",
    skipRows: number[] = [],
    templateId?: number,
  ) =>
    api.post<ImportResult>(
      "/crm-cashflow/import",
      importForm(file, headerRow, useExistingData, duplicateAction, skipRows, templateId),
      { headers: { "Content-Type": "multipart/form-data" } },
    ).then((response) => response.data),

  // ── Import templates ─────────────────────────────────────────────────────
  importTemplates: (includeInactive = false) =>
    api.get<CrmCashflowImportTemplate[]>("/crm-cashflow/import-templates", {
      params: { include_inactive: includeInactive },
    }).then((response) => response.data),
  createImportTemplate: (data: ImportTemplateInput) =>
    api.post<CrmCashflowImportTemplate>("/crm-cashflow/import-templates", data)
      .then((response) => response.data),
  updateImportTemplate: (id: number, data: Partial<ImportTemplateInput & { cfimptpl_status: 0 | 1 }>) =>
    api.patch<CrmCashflowImportTemplate>(`/crm-cashflow/import-templates/${id}`, data)
      .then((response) => response.data),
  deleteImportTemplate: (id: number) => api.delete(`/crm-cashflow/import-templates/${id}`),
  downloadTemplate: async (format: "xlsx" | "csv") => {
    const response = await api.get<Blob>("/crm-cashflow/import/template", {
      params: { format }, responseType: "blob",
    });
    downloadBlob(response.data, `cashflow_import_template.${format}`);
  },
  downloadImportTemplateFile: async (templateId: number, format: "xlsx" | "csv") => {
    const response = await api.get<Blob>(`/crm-cashflow/import-templates/${templateId}/download`, {
      params: { format }, responseType: "blob",
    });
    downloadBlob(response.data, `import_template_${templateId}.${format}`);
  },
  downloadErrors: async (error_rows: string[][], error_details: string[]) => {
    const response = await api.post<Blob>("/crm-cashflow/import/errors", {
      error_rows, error_details,
    }, { responseType: "blob" });
    downloadBlob(response.data, "cashflow_import_errors.xlsx");
  },

  // ── Attachments ──────────────────────────────────────────────────────────
  attachments: (statementId: number) =>
    api.get<CrmCashflowAttachment[]>(`/crm-cashflow/statements/${statementId}/attachments`)
      .then((r) => r.data),

  uploadAttachment: (statementId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<CrmCashflowAttachment>(
      `/crm-cashflow/statements/${statementId}/attachments`, form,
      { headers: { "Content-Type": "multipart/form-data" } },
    ).then((r) => r.data);
  },

  openAttachment: (statementId: number, attachmentId: string) =>
    api.get<Blob>(`/crm-cashflow/statements/${statementId}/attachments/${attachmentId}`, {
      responseType: "blob",
    }).then((r) => r.data),

  deleteAttachment: (statementId: number, attachmentId: string) =>
    api.delete(`/crm-cashflow/statements/${statementId}/attachments/${attachmentId}`),
};
