import { api } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Position {
  id: number;
  name: string;
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
  approver_position_id: number;
  approver_position_name?: string;
}

export interface Rule {
  id: number;
  requester_position_id: number;
  requester_position_name?: string;
  expense_type_id: number;
  expense_type_name?: string;
  amount_min: number;
  amount_max?: number | null;
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
  approver_position_id: number;
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

export type ExpenseRequestStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";

export interface ExpenseRequest {
  id: string;
  request_no?: string;
  requester_user_id: number;
  requester_name?: string;
  requester_position_id: number;
  requester_position_name?: string;
  expense_type_id: number;
  expense_type_name?: string;
  amount: number;
  title: string;
  description?: string;
  request_date: string;
  request_format: "reimbursement" | "advance" | "direct_payment";
  payer_company_name?: string;
  recipient_type?: "employee" | "individual" | "company";
  recipient_name?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_account_masked?: string;
  subtotal: number;
  vat_mode: "none" | "rate" | "amount";
  vat_rate: number;
  vat_amount: number;
  withholding_required: boolean;
  withholding_mode: "none" | "rate" | "amount";
  withholding_rate: number;
  withholding_amount: number;
  payable_total: number;
  taxpayer_name?: string;
  taxpayer_id?: string;
  taxpayer_address?: string;
  status: ExpenseRequestStatus;
  current_step_no?: number;
  submitted_at?: string;
  decided_at?: string;
  created_at: string;
}

export interface ExpenseRequestItem {
  id?: number;
  sort_order?: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total?: number;
}

export interface ExpenseRequestAttachment {
  id: string;
  attachment_type: "primary" | "supporting";
  file_name: string;
  content_type?: string;
  file_size: number;
  created_at: string;
}

export type ApprovalStepStatus = "waiting" | "pending" | "approved" | "rejected" | "skipped";

export interface ApprovalStepTimeline {
  id: number;
  step_no: number;
  approver_position_id: number;
  approver_position_name?: string;
  resolved_approver_user_id?: number;
  resolved_approver_name?: string;
  status: ApprovalStepStatus;
  comment?: string;
  decided_by?: number;
  decided_at?: string;
}

export interface ExpenseRequestDetail extends ExpenseRequest {
  items: ExpenseRequestItem[];
  attachments: ExpenseRequestAttachment[];
  steps: ApprovalStepTimeline[];
}

export interface InboxItem {
  step_id: number;
  step_no: number;
  expense_request_id: string;
  title: string;
  amount: number;
  requester_user_id: number;
  requester_name?: string;
  requester_position_name?: string;
  expense_type_name?: string;
  request_date: string;
  submitted_at?: string;
}

// ── Positions ────────────────────────────────────────────────────────────────
export const positionsApi = {
  list: () => api.get("/positions").then((r) => r.data),
  create: (data: { name: string; is_active?: boolean }) => api.post("/positions", data).then((r) => r.data),
  update: (id: number, data: Partial<{ name: string; is_active: boolean }>) =>
    api.patch(`/positions/${id}`, data).then((r) => r.data),
  mine: () => api.get("/my-positions").then((r) => r.data),
};

export const userPositionsApi = {
  list: (params?: { user_id?: number }) => api.get("/user-positions", { params }).then((r) => r.data),
  create: (data: { user_id: number; position_id: number }) =>
    api.post("/user-positions", data).then((r) => r.data),
  delete: (id: number) => api.delete(`/user-positions/${id}`),
};

// ── Expense types ──────────────────────────────────────────────────────────
export const expenseTypesApi = {
  list: () => api.get("/expense-types").then((r) => r.data),
  create: (data: { code: string; name: string; is_active?: boolean }) =>
    api.post("/expense-types", data).then((r) => r.data),
  update: (id: number, data: Partial<{ code: string; name: string; is_active: boolean }>) =>
    api.patch(`/expense-types/${id}`, data).then((r) => r.data),
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
      requester_position_id: number;
      expense_type_id: number;
      amount_min: number;
      amount_max?: number | null;
      steps: { step_no: number; approver_position_id: number }[];
    }
  ) => api.post(`/approval-policy-versions/${versionId}/rules`, data).then((r) => r.data),
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
  preview: (params: { requester_position_id: number; expense_type_id: number; amount: number }) =>
    api.get("/approval-routes/preview", { params }).then((r) => r.data),
};

// ── Expense requests ──────────────────────────────────────────────────────
export const expenseRequestsApi = {
  list: (params?: { scope?: "mine" | "all"; status?: string; limit?: number; offset?: number }) =>
    api.get("/expense-requests", { params }).then((r) => r.data),
  create: (data: {
    requester_position_id: number;
    expense_type_id: number;
    amount?: number;
    title: string;
    description?: string;
    request_date: string;
    request_format?: "reimbursement" | "advance" | "direct_payment";
    payer_company_name?: string;
    recipient_type?: "employee" | "individual" | "company";
    recipient_name?: string;
    bank_name?: string;
    bank_account_name?: string;
    bank_account_number?: string;
  }) => api.post("/expense-requests", data).then((r) => r.data),
  update: (id: string, data: Partial<{
    requester_position_id: number;
    expense_type_id: number;
    title: string;
    description: string;
    request_date: string;
    request_format: "reimbursement" | "advance" | "direct_payment";
    payer_company_name: string;
    recipient_type: "employee" | "individual" | "company";
    recipient_name: string;
    bank_name: string;
    bank_account_name: string;
    bank_account_number: string;
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
  }>) => api.patch(`/expense-requests/${id}`, data).then((r) => r.data),
  get: (id: string) => api.get(`/expense-requests/${id}`).then((r) => r.data),
  uploadAttachment: (id: string, file: File) => {
    const data = new FormData();
    data.append("file", file);
    return api.post(`/expense-requests/${id}/attachments`, data).then((r) => r.data);
  },
  generatePrimaryDocument: (id: string) =>
    api.post(`/expense-requests/${id}/generate-primary-document`).then((r) => r.data),
  deleteAttachment: (id: string, attachmentId: string) =>
    api.delete(`/expense-requests/${id}/attachments/${attachmentId}`),
  openAttachment: async (id: string, attachmentId: string) => {
    const response = await api.get(`/expense-requests/${id}/attachments/${attachmentId}`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  submit: (id: string) => api.post(`/expense-requests/${id}/submit`).then((r) => r.data),
  cancel: (id: string) => api.delete(`/expense-requests/${id}`),
  permanentlyDelete: (id: string) => api.delete(`/expense-requests/${id}/permanent`),
};

// ── Approver inbox & decisions ────────────────────────────────────────────
export const approvalInboxApi = {
  list: () => api.get("/approvals/inbox").then((r) => r.data),
  decide: (
    stepId: number,
    data: { action: "approve" | "reject"; comment?: string; idempotency_key: string }
  ) => api.post(`/approval-steps/${stepId}/decisions`, data).then((r) => r.data),
};
