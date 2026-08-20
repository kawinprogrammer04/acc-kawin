import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

const apiDebugEnabled =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
  localStorage.getItem("debug_api") === "1";

function sanitizePayload(data: unknown): unknown {
  if (!data || typeof data !== "object" || data instanceof FormData) return data;
  const copy = { ...(data as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    if (/password|token|secret|authorization/i.test(key)) copy[key] = "[REDACTED]";
  }
  return copy;
}

export function getApiErrorMessage(error: unknown, fallback = "เกิดข้อผิดพลาด"): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })
    ?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return null;
        const validation = item as { loc?: unknown[]; msg?: string };
        const field = validation.loc?.filter((part) => part !== "body").join(".");
        return validation.msg ? `${field ? `${field}: ` : ""}${validation.msg}` : null;
      })
      .filter(Boolean);
    if (messages.length) return messages.join("\n");
  }
  return fallback;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const companyId = localStorage.getItem("company_id");
  if (companyId) config.headers["X-Company-Id"] = companyId;

  (config as typeof config & { _startedAt?: number })._startedAt = performance.now();
  if (apiDebugEnabled && localStorage.getItem("debug_api") === "verbose") {
    console.debug(`[API] ${config.method?.toUpperCase()} ${config.url}`, {
      params: config.params,
      data: sanitizePayload(config.data),
      companyId: companyId || null,
    });
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    if (apiDebugEnabled && localStorage.getItem("debug_api") === "verbose") {
      const startedAt = (res.config as typeof res.config & { _startedAt?: number })._startedAt;
      console.debug(
        `[API OK] ${res.config.method?.toUpperCase()} ${res.config.url} → ${res.status}`,
        { durationMs: startedAt ? Math.round(performance.now() - startedAt) : undefined }
      );
    }
    return res;
  },
  (err) => {
    const config = err.config || {};
    const startedAt = (config as typeof config & { _startedAt?: number })._startedAt;
    const responseData = err.response?.data;
    const requestId =
      err.response?.headers?.["x-request-id"] || responseData?.request_id || null;

    if (apiDebugEnabled) {
      const method = config.method?.toUpperCase() || "REQUEST";
      const status = err.response?.status ?? "NETWORK";
      console.groupCollapsed(
        `%c[API ERROR] ${method} ${config.url || "(unknown)"} → ${status}`,
        "color:#dc2626;font-weight:bold"
      );
      console.error({
        message: err.message,
        status: err.response?.status,
        detail: responseData?.detail,
        debug: responseData?.debug,
        errorType: responseData?.error_type,
        requestId,
        durationMs: startedAt ? Math.round(performance.now() - startedAt) : undefined,
        params: config.params,
        requestData: sanitizePayload(config.data),
        responseData,
      });
      console.trace("Action stack");
      console.groupEnd();
    }

    if (err.response?.status === 401 && localStorage.getItem("token")) {
      localStorage.removeItem("token");
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post("/auth/login", { username, password }).then((r) => r.data),
  ssoLoginHr: (token: string) =>
    api.post("/auth/sso/hr-login", { token }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
  mySignature: () => api.get("/auth/me/signature").then((r) => r.data as { signature_data_url: string }),
};

// ── Accounts ─────────────────────────────────────────────────────────────────
export const accountsApi = {
  list: (params?: { account_type?: string; is_active?: boolean; is_header?: boolean }) =>
    api.get("/accounts", { params }).then((r) => r.data),
  postable: () => api.get("/accounts/postable").then((r) => r.data),
  tree: () => api.get("/accounts/tree").then((r) => r.data),
  get: (id: number) => api.get(`/accounts/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post("/accounts", data).then((r) => r.data),
  update: (id: number, data: unknown) => api.patch(`/accounts/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/accounts/${id}`),
};

// ── Journals ──────────────────────────────────────────────────────────────────
export const journalsApi = {
  list: (params?: { period_id?: number; status?: string; limit?: number; offset?: number }) =>
    api.get("/journals", { params }).then((r) => r.data),
  get: (id: string) => api.get(`/journals/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post("/journals", data).then((r) => r.data),
  post: (id: string) => api.post(`/journals/${id}/post`).then((r) => r.data),
  void: (id: string, reason: string) => api.post(`/journals/${id}/void`, { reason }).then((r) => r.data),
  delete: (id: string) => api.delete(`/journals/${id}`),
};

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoicesApi = {
  list: (params?: { invoice_type?: string; status?: string; party_id?: string; period_id?: number; limit?: number }) =>
    api.get("/invoices", { params }).then((r) => r.data),
  get: (id: string) => api.get(`/invoices/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post("/invoices", data).then((r) => r.data),
  post: (id: string) => api.post(`/invoices/${id}/post`).then((r) => r.data),
  void: (id: string) => api.patch(`/invoices/${id}/void`).then((r) => r.data),
  calculateVat: (amount: number, inclusive: boolean) =>
    api.get("/invoices/calculate-vat", { params: { amount, inclusive } }).then((r) => r.data),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportsApi = {
  incomeStatement: (params: { fiscal_year_id: number; period_from?: number; period_to?: number }) =>
    api.get("/reports/income-statement", { params }).then((r) => r.data),
  balanceSheet: (params: { as_of_date: string }) =>
    api.get("/reports/balance-sheet", { params }).then((r) => r.data),
  trialBalance: (params: { fiscal_year_id: number; period_number: number }) =>
    api.get("/reports/trial-balance", { params }).then((r) => r.data),
  arAging: () => api.get("/reports/ar-aging").then((r) => r.data),
  apAging: () => api.get("/reports/ap-aging").then((r) => r.data),
  vatPP30: (params: { year: number; month: number }) =>
    api.get("/reports/vat-pp30", { params }).then((r) => r.data),
};
