import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const companyId = localStorage.getItem("company_id");
  if (companyId) config.headers["X-Company-Id"] = companyId;

  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post("/auth/login", { username, password }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
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
