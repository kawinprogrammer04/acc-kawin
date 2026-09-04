import { api, getApiErrorMessage } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Position {
  id: number;
  name: string;
  department_id?: number | null;
  is_active: boolean;
}

export interface UserPositionRow {
  id: number;
  user_id: number;
  position_id: number;
  position_name?: string;
  user_full_name?: string;
  is_active: boolean;
}

export interface ExpenseType {
  id: number;
  code: string;
  name: string;
  description?: string;
  allowed_kinds: string[];
  requires_payment_proof: boolean;
  may_require_withholding_tax: boolean;
  settlement_days: number;
  is_active: boolean;
}

export type PolicyVersionStatus = "draft" | "active" | "retired";

export interface PolicyVersion {
  id: number;
  version_no: number;
  status: PolicyVersionStatus;
  effective_from?: string;
  effective_to?: string;
  notes?: string;
  created_at: string;
}

export interface RuleStep {
  step_no: number;
  name?: string;
  target_type?: "direct_supervisor" | "position" | "user" | "hr_position";
  target_id?: number | null;
  target_name?: string;
  approve_mode?: "any" | "all";
  approver_position_id?: number | null;
  approver_position_name?: string;
}

export interface Rule {
  id: number;
  requester_position_id?: number | null;
  requester_position_name?: string;
  requester_department_id?: number | null;
  requester_department_name?: string | null;
  expense_type_id?: number | null;
  expense_type_name?: string;
  amount_min: number;
  amount_max?: number | null;
  name?: string | null;
  request_kind?: string | null;
  priority?: number;
  specificity?: number;
  source_system?: string | null;
  source_policy_id?: number | null;
  logical_group_key?: string | null;
  source_scope?: {
    company_name?: string | null;
    department_name?: string | null;
    requester_position_name?: string | null;
    expense_type_code?: string | null;
    expense_type_name?: string | null;
    request_kind?: string | null;
  } | null;
  is_active: boolean;
  steps: RuleStep[];
}

export interface PrimaryApprover {
  id: number;
  position_id: number;
  position_name?: string;
  user_id: number;
  user_full_name?: string;
  is_active: boolean;
}

export interface Delegation {
  id: number;
  position_id: number;
  position_name?: string;
  delegate_user_id: number;
  delegate_full_name?: string;
  starts_at: string;
  ends_at: string;
  reason?: string;
}

export interface RoutePreviewStep {
  step_no: number;
  approver_position_id?: number | null;
  approver_position_name: string;
  resolved_approver_user_id?: number;
  resolved_approver_name?: string;
  warning?: string;
}

export interface RoutePreview {
  matched: boolean;
  message?: string;
  rule_id?: number;
  steps: RoutePreviewStep[];
}

export type ExpenseRequestStatus = "draft" | "pending" | "approved" | "pending_approval" | "ready_to_pay" |
  "partially_paid" | "settlement_due" | "settlement_review" | "completed" | "returned_for_correction" |
  "rejected" | "pending_adjustment_approval" | "cancelled" | "accounting_review" | "paid";

export interface ExpenseRequest {
  id: string;
  request_no?: string;
  version: number;
  current_revision: number;
  requester_user_id: number;
  requester_name?: string;
  requester_position_id: number;
  requester_position_name?: string;
  department_id?: number;
  department_name?: string;
  expense_type_id: number;
  expense_type_name?: string;
  amount: number;
  title: string;
  description?: string;
  request_date: string;
  required_date?: string;
  request_format: "reimbursement" | "advance" | "direct_payment";
  payer_company_name?: string;
  recipient_type?: "employee" | "individual" | "company";
  recipient_name?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_account_masked?: string;
  recipient_address?: string;
  service_description?: string;
  subtotal: number;
  discount_amount: number;
  price_before_vat: number;
  price_mode: "exclude_vat" | "include_vat";
  vat_mode: "none" | "rate" | "amount";
  vat_rate: number;
  vat_amount: number;
  withholding_required: boolean;
  withholding_mode: "none" | "rate" | "amount";
  withholding_rate: number;
  withholding_amount: number;
  payable_total: number;
  gross: number;
  net: number;
  paid: number;
  remaining: number;
  gross_up_enabled: boolean;
  installment_enabled: boolean;
  installment_no?: number;
  installment_chain_root_id?: string;
  installment_target_amount?: number;
  installment_payment_amount?: number;
  installment_chain_status?: "in_progress" | "fully_disbursed";
  installment_chain_remaining?: number;
  requested_net_amount?: number;
  requester_withholding_status: string;
  taxpayer_name?: string;
  taxpayer_type?: "individual" | "juristic";
  taxpayer_branch?: string;
  taxpayer_id?: string;
  taxpayer_address?: string;
  status: ExpenseRequestStatus;
  current_step_no?: number;
  submitted_at?: string;
  approved_at?: string;
  decided_at?: string;
  created_at: string;
}

export interface PersonalExpenseRequestFilters {
  statuses?: string;
  type_ids?: string;
  request_formats?: string;
  query?: string;
  date_from?: string;
  date_to?: string;
}

export interface PersonalExpenseRequestListResponse {
  items: ExpenseRequest[];
  total: number;
  limit: number;
  offset: number;
}

export interface PersonalExpenseRequestStats {
  total_count: number;
  action_required_count: number;
  in_progress_count: number;
  completed_count: number;
  amount_total: number;
}

export interface ExpenseRequestItem {
  id?: number;
  sort_order?: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate?: number | null;
  vat_amount?: number;
  withholding_rate?: number | null;
  withholding_amount?: number;
  line_total?: number;
}

export interface ExpenseRequestAttachment {
  id: string;
  requirement_id?: number | null;
  attachment_type: "primary" | "supporting";
  category: string;
  file_name: string;
  content_type?: string;
  file_size: number;
  requires_signature: boolean;
  has_signed_file: boolean;
  default_signature_page?: number | null;
  default_signature_x?: number | null;
  default_signature_y?: number | null;
  default_signature_width?: number | null;
  default_signature_height?: number | null;
  created_at: string;
}

export type ApprovalStepStatus = "waiting" | "pending" | "approved" | "rejected" | "returned" | "skipped" | "cancelled";

export interface ApprovalStepTimeline {
  id: number;
  step_no: number;
  name?: string;
  approver_position_id?: number;
  approver_position_name?: string;
  resolved_approver_user_id?: number;
  resolved_approver_name?: string;
  status: ApprovalStepStatus;
  comment?: string;
  decided_by?: number;
  decided_at?: string;
  is_legacy?: boolean;
  approvers?: Array<{
    user_id?: number; name?: string; position_name?: string; status: string;
    comments?: string; acted_at?: string;
  }>;
}

export interface ExpenseInstallmentSibling {
  id: string;
  request_no?: string;
  installment_no?: number;
  status: ExpenseRequestStatus;
  amount: number;
  paid_amount: number;
}

export interface ExpenseRequestDetail extends ExpenseRequest {
  items: ExpenseRequestItem[];
  attachments: ExpenseRequestAttachment[];
  steps: ApprovalStepTimeline[];
  installment_siblings: ExpenseInstallmentSibling[];
}

export interface InboxItem {
  step_id: number;
  step_no: number;
  expense_request_id: string;
  request_no?: string;
  title: string;
  amount: number;
  requester_user_id: number;
  requester_name?: string;
  requester_position_name?: string;
  department_name?: string;
  expense_type_name?: string;
  request_date: string;
  submitted_at?: string;
  status: "pending" | "approved" | "returned" | "rejected";
}

// ── Positions ────────────────────────────────────────────────────────────────
export const positionsApi = {
  list: () => api.get("/positions").then((r) => r.data),
  create: (data: { name: string; department_id?: number | null; is_active?: boolean }) => api.post("/positions", data).then((r) => r.data),
  update: (id: number, data: Partial<{ name: string; department_id: number | null; is_active: boolean }>) =>
    api.patch(`/positions/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/positions/${id}`),
  mine: () => api.get("/my-positions").then((r) => r.data),
};

export const userPositionsApi = {
  list: (params?: { user_id?: number }) => api.get("/user-positions", { params }).then((r) => r.data),
  create: (data: { user_id: number; position_id: number }) =>
    api.post("/user-positions", data).then((r) => r.data),
  delete: (id: number) => api.delete(`/user-positions/${id}`),
};

// ── Expense types ──────────────────────────────────────────────────────────
export interface ExpenseTypeInput {
  code: string;
  name: string;
  description?: string | null;
  allowed_kinds?: string[];
  requires_payment_proof?: boolean;
  may_require_withholding_tax?: boolean;
  settlement_days?: number;
  is_active?: boolean;
}

export const expenseTypesApi = {
  list: () => api.get("/expense-types").then((r) => r.data),
  create: (data: ExpenseTypeInput) => api.post("/expense-types", data).then((r) => r.data),
  update: (id: number, data: Partial<ExpenseTypeInput>) =>
    api.patch(`/expense-types/${id}`, data).then((r) => r.data),
  delete: (id: number): Promise<{ deactivated: boolean; expense_type?: ExpenseType }> =>
    api.delete(`/expense-types/${id}`).then((r) => r.data),
};

// ── Policy versions & rules ────────────────────────────────────────────────
export const policyVersionsApi = {
  list: () => api.get("/approval-policy-versions").then((r) => r.data),
  create: (data: { notes?: string; effective_from?: string; effective_to?: string }) =>
    api.post("/approval-policy-versions", data).then((r) => r.data),
  activate: (id: number) => api.post(`/approval-policy-versions/${id}/activate`).then((r) => r.data),
};

export const rulesApi = {
  list: (versionId: number) =>
    api.get(`/approval-policy-versions/${versionId}/rules`).then((r) => r.data),
  create: (
    versionId: number,
    data: {
      requester_position_id?: number | null;
      expense_type_id?: number | null;
      amount_min: number;
      amount_max?: number | null;
      name?: string | null;
      request_kind?: string | null;
      priority?: number;
      source_system?: "acc" | "hr";
      source_policy_id?: number | null;
      logical_group_key?: string;
      source_scope?: Rule["source_scope"];
      steps: {
        step_no: number;
        name?: string;
        target_type?: "direct_supervisor" | "position" | "user" | "hr_position";
        target_id?: number | null;
        approve_mode?: "any" | "all";
        approver_position_id?: number | null;
      }[];
    }
  ) => api.post(`/approval-policy-versions/${versionId}/rules`, data).then((r) => r.data),
  update: (ruleId: number, data: {
    requester_position_id?: number | null;
    expense_type_id?: number | null;
    amount_min?: number;
    amount_max?: number | null;
    name?: string | null;
    request_kind?: string | null;
    priority?: number;
    is_active?: boolean;
    source_scope?: Rule["source_scope"];
    steps?: {
      step_no: number;
      name?: string;
      target_type?: "direct_supervisor" | "position" | "user" | "hr_position";
      target_id?: number | null;
      approve_mode?: "any" | "all";
      approver_position_id?: number | null;
    }[];
  }) => api.patch(`/approval-rules/${ruleId}`, data).then((r) => r.data),
  delete: (ruleId: number) => api.delete(`/approval-rules/${ruleId}`),
};

// ── Primary approvers & delegations ──────────────────────────────────────────
export const primaryApproversApi = {
  list: () => api.get("/position-primary-approvers").then((r) => r.data),
  set: (data: { position_id: number; user_id: number }) =>
    api.post("/position-primary-approvers", data).then((r) => r.data),
  remove: (id: number) => api.delete(`/position-primary-approvers/${id}`),
};

export const delegationsApi = {
  list: () => api.get("/approval-delegations").then((r) => r.data),
  create: (data: { position_id: number; delegate_user_id: number; starts_at: string; ends_at: string; reason?: string }) =>
    api.post("/approval-delegations", data).then((r) => r.data),
  delete: (id: number) => api.delete(`/approval-delegations/${id}`),
};

// ── Route preview ─────────────────────────────────────────────────────────
export const approvalRoutesApi = {
  preview: (params: { requester_position_id: number; expense_type_id: number; amount: number; request_kind?: string }) =>
    api.get("/approval-routes/preview", { params }).then((r) => r.data),
};

// ── Expense requests ──────────────────────────────────────────────────────
export const expenseRequestsApi = {
  list: (params?: { scope?: "mine" | "all"; status?: string; limit?: number; offset?: number }) =>
    api.get("/expense-requests", { params }).then((r) => r.data),
  listMine: (params?: PersonalExpenseRequestFilters, page = 1, limit = 25): Promise<PersonalExpenseRequestListResponse> =>
    api.get("/expense-requests/mine/list", {
      params: { ...params, limit, offset: limit === 0 ? 0 : (page - 1) * limit },
    }).then((r) => r.data),
  statsMine: (params?: PersonalExpenseRequestFilters): Promise<PersonalExpenseRequestStats> =>
    api.get("/expense-requests/mine/stats", { params }).then((r) => r.data),
  create: (data: {
    requester_position_id: number;
    expense_type_id: number;
    amount?: number;
    title: string;
    description?: string;
    request_date: string;
    required_date?: string;
    request_format?: "reimbursement" | "advance" | "direct_payment";
    payer_company_name?: string;
    recipient_type?: "employee" | "individual" | "company";
    recipient_name?: string;
    bank_name?: string;
    bank_account_name?: string;
    bank_account_number?: string;
    installment_enabled?: boolean;
  }) => api.post("/expense-requests", data).then((r) => r.data),
  update: (id: string, data: Partial<{
    version: number;
    requester_position_id: number;
    expense_type_id: number;
    title: string;
    description: string;
    request_date: string;
    required_date: string;
    request_format: "reimbursement" | "advance" | "direct_payment";
    payer_company_name: string;
    recipient_type: "employee" | "individual" | "company";
    recipient_name: string;
    bank_name: string;
    bank_account_name: string;
    bank_account_number: string;
    installment_enabled: boolean;
    installment_payment_amount: number | null;
    items: ExpenseRequestItem[];
    vat_mode: "none" | "rate" | "amount";
    vat_rate: number;
    vat_amount: number;
    withholding_required: boolean;
    withholding_mode: "none" | "rate" | "amount";
    withholding_rate: number;
    withholding_amount: number;
    taxpayer_name: string;
    taxpayer_id: string;
    taxpayer_address: string;
    discount_amount: number;
    price_mode: "include_vat" | "exclude_vat";
    gross_up_enabled: boolean;
    requested_net_amount: number;
    requester_withholding_status: string;
    taxpayer_type: "individual" | "juristic";
    taxpayer_branch: string;
    recipient_address: string;
    service_description: string;
  }>) => api.patch(`/expense-requests/${id}`, data).then((r) => r.data),
  get: (id: string) => api.get(`/expense-requests/${id}`).then((r) => r.data),
  uploadAttachment: (id: string, file: File, requirementId?: number) => {
    const data = new FormData();
    data.append("file", file);
    if (requirementId) data.append("requirement_id", String(requirementId));
    return api.post(`/expense-requests/${id}/attachments`, data).then((r) => r.data);
  },
  generatePrimaryDocument: (id: string) =>
    api.post(`/expense-requests/${id}/generate-primary-document`).then((r) => r.data),
  deleteAttachment: (id: string, attachmentId: string) =>
    api.delete(`/expense-requests/${id}/attachments/${attachmentId}`),
  openAttachment: async (id: string, attachmentId: string, signed = true) => {
    // Open synchronously while this call still belongs to the user's click.
    // Opening only after the awaited API request is treated as an unsolicited
    // popup by production browsers, even though the file request succeeds.
    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    try {
      const response = await api.get(`/expense-requests/${id}/attachments/${attachmentId}`, {
        params: { signed: signed ? 1 : 0 }, responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.replace(url);
      } else {
        // Strict popup blockers can still refuse the pre-opened tab. Falling
        // back to the current tab guarantees that the user can view the file.
        window.location.assign(url);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (error) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      window.alert(getApiErrorMessage(error, "ไม่สามารถเปิดไฟล์แนบนี้ได้"));
      throw error;
    }
  },
  attachmentBlob: (id: string, attachmentId: string, signed = true) =>
    api.get(`/expense-requests/${id}/attachments/${attachmentId}`, {
      params: { signed: signed ? 1 : 0 }, responseType: "blob",
    }).then((response) => response.data as Blob),
  downloadAttachmentArchive: async (id: string, filename: string) => {
    const response = await api.get(`/expense-requests/${id}/attachments/archive`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  submit: (id: string) => api.post(`/expense-requests/${id}/submit`).then((r) => r.data),
  cancel: (id: string) => api.delete(`/expense-requests/${id}`),
  permanentlyDelete: (id: string) => api.delete(`/expense-requests/${id}/permanent`),
  createNextInstallment: (id: string, data: { installment_payment_amount: number }) =>
    api.post(`/expense-requests/${id}/installments/next`, data).then((r) => r.data),
};

// ── Approver inbox & decisions ────────────────────────────────────────────
export const APPROVAL_INBOX_CHANGED_EVENT = "approval-inbox:changed";

export const approvalInboxApi = {
  list: (params?: { scope?: "mine" | "all"; statuses?: InboxItem["status"][] }) => {
    const searchParams = new URLSearchParams();
    if (params?.scope) searchParams.set("scope", params.scope);
    params?.statuses?.forEach(status => searchParams.append("statuses", status));
    return api.get<InboxItem[]>("/approvals/inbox", { params: searchParams }).then((r) => r.data);
  },
  count: (params?: { scope?: "mine" | "all" }): Promise<number> =>
    api.get("/approvals/inbox/count", { params }).then((r) => Number(r.data.count || 0)),
  decide: (
    stepId: number,
    data: { action: "approve" | "reject" | "return"; comment?: string; idempotency_key: string; signature_data_url?: string; use_saved_signature?: boolean; save_signature?: boolean; placements?: Record<string, unknown>[] }
  ) => api.post(`/approval-steps/${stepId}/decisions`, data).then((r) => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(APPROVAL_INBOX_CHANGED_EVENT));
    return r.data;
  }),
};

export interface AccountingRequest {
  id: string; request_no: string; request_date: string; title: string; recipient_name?: string;
  requester_name?: string; request_format: string; status: ExpenseRequestStatus;
  gross: number; vat: number; withholding: number; net: number; paid: number; remaining: number;
  settlement_due_date?: string; submitted_at?: string; approved_at?: string;
  company_id: number; company_name?: string; department_id?: number; department_name?: string;
  expense_type_id: number; expense_type_name?: string; bank_name?: string;
  bank_account_name?: string; bank_account_number?: string;
  transfer_amount: number; is_adjustment_transfer: boolean; installment_enabled?: boolean;
  installment_no?: number; installment_chain_root_id?: string;
  installment_chain_status?: "in_progress" | "fully_disbursed"; installment_payment_amount?: number;
  approval_steps: AccountingApprovalStep[];
}

export interface AccountingApprovalStep {
  id: number; step_no: number; name?: string; approver_position_name?: string;
  approver_name?: string; status: string; decided_at?: string; is_legacy?: boolean;
  approvers?: Array<{
    user_id?: number; name?: string; position_name?: string; status: string;
    comments?: string; acted_at?: string;
  }>;
}

export interface AccountingListResponse {
  items: AccountingRequest[]; total: number; limit: number; offset: number;
}

export interface AccountingFilters {
  status?: string; statuses?: string; query?: string;
  department_id?: number; department_ids?: string;
  type_id?: number; type_ids?: string;
  date_from?: string; date_to?: string; withholding_only?: boolean;
}

export interface ExpenseHistory {
  id: number; revision: number; event: string; from_status?: string; to_status?: string;
  actor_user_id?: number; note?: string; snapshot: Record<string, unknown>; created_at: string;
}

export interface ExpenseSettlement {
  id: string; expense_request_id: string; revision: number; advance_amount: number;
  actual_amount: number; difference_amount: number; settlement_type: "equal" | "refund" | "additional";
  status: string; note?: string; submitted_at: string; reviewed_at?: string; review_comment?: string;
}

export interface ExpenseNotification {
  id: string; type: string; title: string; message: string; action_url?: string;
  read_at?: string; created_at: string;
}

export interface ExpensePaymentRecord {
  id: string; expense_request_id: string; revision: number;
  payment_type: "partial" | "full" | "adjustment";
  amount: number; paid_at: string; method?: string; reference_no?: string; note?: string;
  proof_file_name?: string; proof_sha256?: string; voided_at?: string; created_at: string;
}

export interface ExpenseWithholdingCertificate {
  id: string; expense_request_id: string; payment_id?: string;
  certificate_no: string; tax_rate: number; base_amount: number; tax_amount: number;
  issued_at: string;
}

async function openPrivateFinancialFile(path: string) {
  const previewWindow = window.open("about:blank", "_blank");
  if (previewWindow) previewWindow.opener = null;
  try {
    const response = await api.get(path, { params: { inline: 1 }, responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    if (previewWindow && !previewWindow.closed) previewWindow.location.replace(url);
    else window.location.assign(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (error) {
    if (previewWindow && !previewWindow.closed) previewWindow.close();
    window.alert(getApiErrorMessage(error, "ไม่สามารถเปิดเอกสารการเงินนี้ได้"));
    throw error;
  }
}

async function downloadPrivateFinancialFile(path: string, filename: string) {
  const response = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export const expenseNotificationsApi = {
  list: () => api.get("/notifications", { params: { limit: 50 } }).then(r => r.data),
  markRead: (id: string) => api.post(`/notifications/${id}/read`).then(r => r.data),
};

export const expenseAccountingApi = {
  list: (params?: AccountingFilters, page = 1, limit = 25): Promise<AccountingListResponse> =>
    api.get("/expense-requests/accounting/list", {
      params: { ...params, limit, offset: (page - 1) * limit },
    }).then(r => r.data),
  stats: (params?: AccountingFilters) => api.get("/expense-requests/accounting/stats", { params }).then(r => r.data),
  exportUrl: async (params?: AccountingFilters) => {
    const response = await api.get("/expense-requests/accounting/export", { params, responseType: "blob" });
    const url = URL.createObjectURL(response.data); const link = document.createElement("a");
    link.href = url; link.download = "expense-requests.xlsx"; link.click(); URL.revokeObjectURL(url);
  },
  pay: (id: string, data: Record<string, unknown>) => api.post(`/expense-requests/${id}/payments`, data).then(r => r.data),
  payments: (id: string): Promise<ExpensePaymentRecord[]> => api.get(`/expense-requests/${id}/payments`).then(r => r.data),
  openPaymentProof: (requestId: string, paymentId: string) =>
    openPrivateFinancialFile(`/expense-requests/${requestId}/payments/${paymentId}/proof`),
  downloadPaymentProof: (requestId: string, paymentId: string, filename: string) =>
    downloadPrivateFinancialFile(`/expense-requests/${requestId}/payments/${paymentId}/proof`, filename),
  replacePaymentProof: (paymentId: string, data: { proof_file_name: string; proof_content_base64: string; reason: string }) => api.patch(`/expense-payments/${paymentId}/proof`, data).then(r => r.data),
  voidPayment: (paymentId: string, reason: string) => api.post(`/expense-payments/${paymentId}/void`, { reason }).then(r => r.data),
  returnForCorrection: (id: string, reason: string) => api.post(`/expense-requests/${id}/accounting/return`, { reason }).then(r => r.data),
  reviewLegacy: (id: string) => api.post(`/expense-requests/${id}/accounting/review`).then(r => r.data),
  cancel: (id: string, reason: string) => api.post(`/expense-requests/${id}/accounting/cancel`, { reason }).then(r => r.data),
  settlements: (id: string) => api.get(`/expense-requests/${id}/settlements`).then(r => r.data),
  submitSettlement: (id: string, data: Record<string, unknown>) => api.post(`/expense-requests/${id}/settlements`, data).then(r => r.data),
  reviewSettlement: (id: string, action: "approve" | "return", comment?: string) => api.post(`/expense-settlements/${id}/review`, { action, comment }).then(r => r.data),
  histories: (id: string) => api.get(`/expense-requests/${id}/histories`).then(r => r.data),
  issueWht: (id: string) => api.post(`/expense-requests/${id}/wht-certificate`).then(r => r.data),
  whtCertificates: (id: string): Promise<ExpenseWithholdingCertificate[]> =>
    api.get(`/expense-requests/${id}/wht-certificates`).then(r => r.data),
  openWhtCertificate: (requestId: string, certificateId: string) =>
    openPrivateFinancialFile(`/expense-requests/${requestId}/wht-certificate/${certificateId}`),
  downloadWhtCertificate: (requestId: string, certificateId: string, filename: string) =>
    downloadPrivateFinancialFile(`/expense-requests/${requestId}/wht-certificate/${certificateId}`, filename),
};

export interface ExpenseDashboardOption { id: number; name: string }
export interface ExpenseDashboardMonthly {
  month: number; label: string; budget: number; used: number; remaining: number; over_budget: boolean;
}
export interface ExpenseDashboardData {
  year: number;
  available_years: number[];
  status_counts: Record<"requested" | "pending_approval" | "approved" | "paid" | "cancelled", number>;
  monthly: ExpenseDashboardMonthly[];
  total_budget: number;
  total_used: number;
  total_remaining: number;
  category_usage: Array<{ category: string; total: number }>;
  options: {
    departments: ExpenseDashboardOption[];
    positions: ExpenseDashboardOption[];
    requesters: ExpenseDashboardOption[];
  };
}

export const expenseDashboardApi = {
  get: (params: { year: number; department_ids?: number[]; position_ids?: number[]; requester_ids?: number[] }) =>
    api.get<ExpenseDashboardData>("/expense-requests/dashboard", { params }).then(r => r.data),
};

export interface Department { id: number; code?: string | null; name: string; manager_user_id?: number | null; is_active: boolean }
export interface AttachmentRequirement { id: number; expense_type_id: number; code: string; name: string; description?: string; is_required: boolean; requires_signature: boolean; allowed_mime_types: string[]; max_file_size: number; sort_order: number; is_active: boolean }
export const expenseSettingsApi = {
  departments: () => api.get("/expense-settings/departments").then(r => r.data),
  createDepartment: (data: Omit<Department, "id">) => api.post("/expense-settings/departments", data).then(r => r.data),
  updateDepartment: (id: number, data: Omit<Department, "id">) => api.put(`/expense-settings/departments/${id}`, data).then(r => r.data),
  deleteDepartment: (id: number) => api.delete(`/expense-settings/departments/${id}`),
  requirements: (typeId: number) => api.get(`/expense-types/${typeId}/attachment-requirements`).then(r => r.data),
  createRequirement: (typeId: number, data: Record<string, unknown>) => api.post(`/expense-types/${typeId}/attachment-requirements`, data).then(r => r.data),
  updateRequirement: (typeId: number, id: number, data: Record<string, unknown>) => api.put(`/expense-types/${typeId}/attachment-requirements/${id}`, data).then(r => r.data),
  deleteRequirement: (typeId: number, id: number) => api.delete(`/expense-types/${typeId}/attachment-requirements/${id}`),
};
