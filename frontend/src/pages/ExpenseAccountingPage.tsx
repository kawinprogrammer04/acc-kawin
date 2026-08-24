import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2, ChevronLeft, ChevronRight, Clipboard, Download, Eraser, Eye, FileSignature,
  Filter, Landmark, Loader2, RotateCcw, Settings2, UserCheck, Wallet, WalletCards,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getApiErrorMessage } from "@/api/client";
import {
  expenseAccountingApi, expenseSettingsApi, expenseTypesApi,
} from "@/api/approvals";
import type {
  AccountingApprovalStep, AccountingFilters, AccountingRequest, Department, ExpenseType,
} from "@/api/approvals";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

const FILTER_STORAGE_KEY = "expense_accounting_filters";
const PAGE_SIZE = 25;

type FilterForm = {
  status: string; company_id: string; department_id: string; type_id: string;
  date_from: string; date_to: string; withholding_only: boolean;
};

const emptyFilters = (companyId?: number): FilterForm => ({
  status: "", company_id: companyId ? String(companyId) : "", department_id: "",
  type_id: "", date_from: "", date_to: "", withholding_only: false,
});

const statusLabel: Record<string, string> = {
  pending_approval: "กำลังอนุมัติ", pending_adjustment_approval: "กำลังอนุมัติส่วนต่าง",
  accounting_review: "รายการเก่ารอส่งต่อ", ready_to_pay: "พร้อมจ่าย", partially_paid: "จ่ายบางส่วน",
  paid: "จ่ายแล้ว", settlement_due: "รอเคลียร์", settlement_review: "ตรวจเคลียร์",
  completed: "เสร็จสิ้น",
};

const statusColor: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  pending_adjustment_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  accounting_review: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200",
  ready_to_pay: "bg-orange-700 text-white dark:bg-orange-800",
  partially_paid: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  settlement_due: "bg-yellow-200 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-50",
  settlement_review: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
};

const approvalStepLabel: Record<string, string> = {
  waiting: "รออนุมัติ", pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
  active: "รออนุมัติ", completed: "อนุมัติแล้ว",
  skipped: "ข้ามขั้น", rejected: "ไม่อนุมัติ", returned_for_correction: "ส่งคืนแก้ไข",
};

const approvalStatusColor: Record<string, string> = {
  approved: "text-emerald-600 dark:text-emerald-400",
  completed: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-rose-600 dark:text-rose-400",
  returned_for_correction: "text-orange-600 dark:text-orange-400",
  waiting: "text-amber-600 dark:text-amber-400",
  pending: "text-amber-600 dark:text-amber-400",
  active: "text-amber-600 dark:text-amber-400",
};

function formatApprovalDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Bangkok",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

const completedApprovalStatuses = ["approved", "completed", "skipped"];

function getApprovalStepApprovers(step: AccountingApprovalStep) {
  return step.approvers?.length
    ? step.approvers
    : [{ name: step.approver_name, status: step.status, acted_at: step.decided_at }];
}

function getCurrentApprovalStep(steps: AccountingApprovalStep[]) {
  return [...steps]
    .sort((left, right) => left.step_no - right.step_no)
    .find(step => getApprovalStepApprovers(step).some(approver => !completedApprovalStatuses.includes(approver.status)));
}

function ApprovalRouteSummary({
  steps, approvedAt, onDetails,
}: { steps: AccountingApprovalStep[]; approvedAt?: string; onDetails: () => void }) {
  const orderedSteps = [...steps].sort((left, right) => left.step_no - right.step_no);
  const currentStep = getCurrentApprovalStep(orderedSteps);

  if (orderedSteps.length === 0 && !approvedAt) {
    return <div className="space-y-2 text-xs"><p className="text-muted-foreground">ยังไม่สร้างสายอนุมัติ</p><ApprovalDetailsButton onClick={onDetails} /></div>;
  }

  if (!currentStep) {
    return <div className="space-y-2 text-xs"><div><p className="font-bold text-emerald-600">อนุมัติครบแล้ว</p>{approvedAt && <p className="mt-1 text-muted-foreground">{formatApprovalDateTime(approvedAt)}</p>}</div><ApprovalDetailsButton onClick={onDetails} /></div>;
  }

  const currentApprovers = getApprovalStepApprovers(currentStep).filter(approver => !completedApprovalStatuses.includes(approver.status));
  const approverNames = currentApprovers.map(approver => approver.name).filter(Boolean).join(", ");
  const currentStatus = currentApprovers[0]?.status || currentStep.status;

  return <div className="space-y-2 text-xs"><div><p className="font-black text-foreground">ขั้นที่ {currentStep.step_no} จาก {orderedSteps.length}</p><p className="mt-1 font-bold text-foreground">{currentStep.name || currentStep.approver_position_name || "ผู้อนุมัติ"}</p><p className={`mt-1 font-black ${approvalStatusColor[currentStatus] || "text-muted-foreground"}`}>{approverNames || "ยังไม่ระบุผู้อนุมัติ"} · {approvalStepLabel[currentStatus] || currentStatus}</p></div><ApprovalDetailsButton onClick={onDetails} /></div>;
}

function ApprovalDetailsButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-black text-primary transition hover:bg-primary/10"><Eye className="h-3.5 w-3.5" />รายละเอียด</button>;
}

function ApprovalRouteTimeline({ steps, approvedAt }: { steps: AccountingApprovalStep[]; approvedAt?: string }) {
  if (steps.length === 0) {
    return approvedAt
      ? <div className="text-xs"><p className="font-bold text-emerald-600">อนุมัติครบแล้ว</p><p className="mt-1 text-muted-foreground">{formatApprovalDateTime(approvedAt)}</p></div>
      : <span className="text-xs text-muted-foreground">ยังไม่สร้างสายอนุมัติ</span>;
  }

  const orderedSteps = [...steps].sort((left, right) => left.step_no - right.step_no);
  return <ol className="space-y-0">{orderedSteps.map((step, stepIndex) => {
    const approvers = getApprovalStepApprovers(step);
    const stepDone = approvers.every(approver => ["approved", "completed", "skipped"].includes(approver.status));
    return <li key={step.id} className="relative pb-4 pl-7 last:pb-0">
      {stepIndex < orderedSteps.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />}
      <span className={`absolute left-0 top-1 h-[15px] w-[15px] rounded-full border-2 ${stepDone ? "border-emerald-500 bg-emerald-500" : "border-amber-500 bg-background"}`} aria-hidden="true" />
      <p className="text-xs font-black text-foreground">ขั้นที่ {step.step_no}: {step.name || step.approver_position_name || "ผู้อนุมัติ"}</p>
      <div className="mt-2 space-y-3">{approvers.map((approver, approverIndex) => {
        const status = approver.status || step.status;
        const actedAt = approver.acted_at || step.decided_at;
        return <div key={`${step.id}-${approver.user_id || approverIndex}`} className="rounded-lg border bg-muted/30 px-3 py-2.5">
          <p className="break-words text-xs font-bold text-foreground"><UserCheck className="mr-1.5 inline h-3.5 w-3.5 text-primary" />{approver.name || "ยังไม่ระบุผู้อนุมัติ"}</p>
          <p className={`mt-1 text-xs font-black ${approvalStatusColor[status] || "text-muted-foreground"}`}>{approvalStepLabel[status] || status}</p>
          {actedAt && <p className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{formatApprovalDateTime(actedAt)}</p>}
        </div>;
      })}</div>
    </li>;
  })}</ol>;
}

const inputClass = "mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

function toApiFilters(filters: FilterForm): AccountingFilters {
  return {
    status: filters.status || undefined,
    department_id: filters.department_id ? Number(filters.department_id) : undefined,
    type_id: filters.type_id ? Number(filters.type_id) : undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    withholding_only: filters.withholding_only || undefined,
  };
}

// function FinanceNav() {
//   const { can } = useAuth();
//   const links = [
//     { href: "/expense-requests", label: "คำขอของฉัน", icon: Wallet, show: true },
//     { href: "/approvals/inbox", label: "รอฉันอนุมัติ", icon: FileSignature, show: true },
//     { href: "/expense-requests/accounting", label: "บัญชีตรวจจ่าย", icon: WalletCards, show: can("expense_accounting") },
//     { href: "/expense-requests/settings", label: "ตั้งค่า", icon: Settings2, show: can("expense_settings") },
//   ];
//   return <nav className="flex flex-wrap items-center gap-2">{links.filter(item => item.show).map(item => {
//     const Icon = item.icon; const active = item.href === "/expense-requests/accounting";
//     return <Link key={item.href} to={item.href} className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${active ? "bg-primary text-primary-foreground shadow-sm" : "border bg-card text-foreground hover:bg-muted"}`}><Icon className="h-4 w-4" />{item.label}</Link>;
//   })}</nav>;
// }

function StatCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: typeof RotateCcw }) {
  return <Card className="overflow-hidden"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-black">{value.toLocaleString("th-TH")}</p></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-6 w-6" /></div></CardContent></Card>;
}

export function ExpenseAccountingPage() {
  const { companies, currentCompany, setCurrentCompany } = useCompany();
  const [rows, setRows] = useState<AccountingRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [departments, setDepartments] = useState<Department[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [filters, setFilters] = useState<FilterForm>(() => {
    try { return { ...emptyFilters(), ...JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "{}") }; }
    catch { return emptyFilters(); }
  });
  const [applied, setApplied] = useState<FilterForm>(() => {
    try { return { ...emptyFilters(), ...JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "{}") }; }
    catch { return emptyFilters(); }
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [routeDetails, setRouteDetails] = useState<AccountingRequest | null>(null);

  useEffect(() => {
    if (!currentCompany) return;
    setPage(1);
    setFilters(current => ({ ...current, company_id: String(currentCompany.id) }));
    setApplied(current => ({ ...current, company_id: String(currentCompany.id) }));
  }, [currentCompany?.id]);

  useEffect(() => {
    Promise.all([expenseSettingsApi.departments(), expenseTypesApi.list()])
      .then(([departmentRows, typeRows]) => { setDepartments(departmentRows); setTypes(typeRows); })
      .catch(() => { setDepartments([]); setTypes([]); });
  }, [currentCompany?.id]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [result, summary] = await Promise.all([
        expenseAccountingApi.list(toApiFilters(applied), page, PAGE_SIZE), expenseAccountingApi.stats(),
      ]);
      setRows(result.items); setTotal(result.total); setStats(summary);
    } catch (e) { setError(getApiErrorMessage(e, "โหลดรายการบัญชีไม่สำเร็จ")); }
    finally { setLoading(false); }
  }, [applied, page]);
  useEffect(() => { load(); }, [load]);

  const submitFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    const selectedCompany = companies.find(company => company.id === Number(filters.company_id));
    if (selectedCompany && selectedCompany.id !== currentCompany?.id) {
      setCurrentCompany(selectedCompany); return;
    }
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    const cleared = emptyFilters(currentCompany?.id);
    setPage(1);
    sessionStorage.removeItem(FILTER_STORAGE_KEY); setFilters(cleared); setApplied(cleared);
  };

  const exportExcel = async () => {
    setExporting(true); setError("");
    try { await expenseAccountingApi.exportUrl(toApiFilters(applied)); }
    catch (e) { setError(getApiErrorMessage(e, "ส่งออก Excel ไม่สำเร็จ")); }
    finally { setExporting(false); }
  };

  const copyForScb = async (row: AccountingRequest) => {
    const value = `${row.recipient_name || ""} | ${row.bank_name || ""} | ${row.bank_account_number || ""} | ${Number(row.transfer_amount || 0).toFixed(2)}`;
    try { await navigator.clipboard.writeText(value); setNotice(`คัดลอกข้อมูล ${row.request_no} แล้ว`); window.setTimeout(() => setNotice(""), 2500); }
    catch { setError("เบราว์เซอร์ไม่อนุญาตให้คัดลอก กรุณาคัดลอกจากข้อมูลในตาราง"); }
  };

  const visibleDepartments = useMemo(() => departments.filter(item => item.is_active), [departments]);
  const visibleTypes = useMemo(() => types.filter(item => item.is_active), [types]);

  return <div className="w-full space-y-6 p-6">
    {/* <FinanceNav /> */}

    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg"><Landmark className="h-7 w-7" /></div><div><h1 className="text-3xl font-black">บัญชีจ่ายเงิน</h1><p className="mt-1 text-sm text-muted-foreground">ตรวจรายการที่กำลังอนุมัติและรายการที่อนุมัติครบแล้ว พร้อมตรวจสอบผู้อนุมัติจริงก่อนจ่ายเงิน</p></div></div>
      <button type="button" onClick={exportExcel} disabled={exporting} className="group inline-flex h-11 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-emerald-500 to-teal-600 px-8 text-sm font-black text-white shadow-lg shadow-emerald-500/30 transition hover:-translate-y-0.5 hover:shadow-emerald-500/50 disabled:opacity-60">{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 transition-transform group-hover:scale-110" />} ส่งออก Excel</button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard label="กำลังอนุมัติ" value={stats.pending_approval_count || 0} tone="bg-violet-100 text-violet-700 dark:bg-violet-950" icon={FileSignature} />
      <StatCard label="รายการเก่ารอส่งต่อ" value={stats.accounting_review_count || 0} tone="bg-cyan-100 text-cyan-700 dark:bg-cyan-950" icon={RotateCcw} />
      <StatCard label="พร้อมจ่าย" value={stats.ready_to_pay_count || 0} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950" icon={WalletCards} />
      <StatCard label="จ่ายบางส่วน" value={stats.partially_paid_count || 0} tone="bg-teal-100 text-teal-700 dark:bg-teal-950" icon={WalletCards} />
      <StatCard label="รอตรวจเคลียร์" value={stats.settlement_review_count || 0} tone="bg-amber-100 text-amber-700 dark:bg-amber-950" icon={Landmark} />
    </div>

    <form onSubmit={submitFilters} className="space-y-5 rounded-2xl border bg-card/80 p-6 shadow-lg backdrop-blur-xl">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-bold">สถานะ<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={inputClass}><option value="">ทุกสถานะ</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm font-bold">บริษัท<select value={filters.company_id} onChange={event => setFilters(current => ({ ...current, company_id: event.target.value }))} className={inputClass}><option value="">ทุกบริษัท</option>{companies.filter(company => company.is_active).map(company => <option key={company.id} value={company.id}>{company.name_th}</option>)}</select></label>
        <label className="text-sm font-bold">แผนก<select value={filters.department_id} onChange={event => setFilters(current => ({ ...current, department_id: event.target.value }))} className={inputClass}><option value="">ทุกแผนก</option>{visibleDepartments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-bold">ประเภท<select value={filters.type_id} onChange={event => setFilters(current => ({ ...current, type_id: event.target.value }))} className={inputClass}><option value="">ทุกประเภท</option>{visibleTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-bold">ตั้งแต่วันที่<input type="date" value={filters.date_from} onChange={event => setFilters(current => ({ ...current, date_from: event.target.value }))} className={inputClass} /></label>
        <label className="text-sm font-bold">ถึงวันที่<input type="date" value={filters.date_to} onChange={event => setFilters(current => ({ ...current, date_to: event.target.value }))} className={inputClass} /></label>
        <label className="flex items-center gap-3 rounded-xl border border-input bg-background px-4 text-sm font-bold sm:col-span-2 lg:col-span-2"><input type="checkbox" checked={filters.withholding_only} onChange={event => setFilters(current => ({ ...current, withholding_only: event.target.checked }))} className="h-4 w-4 shrink-0 rounded border-input text-primary" />รายการเกี่ยวกับหัก ณ ที่จ่ายเท่านั้น</label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
        <button type="button" onClick={resetFilters} className="inline-flex h-11 items-center gap-2 rounded-md border border-input bg-background px-8 text-sm font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Eraser className="h-4 w-4" />ล้างตัวกรอง</button>
        <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-md bg-slate-900 px-8 text-sm font-black text-white shadow-sm transition hover:bg-slate-700 dark:bg-primary dark:hover:bg-primary/90"><Filter className="h-4 w-4" />กรองข้อมูล</button>
      </div>
    </form>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}

    <Card className="overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1440px] text-sm"><thead className="bg-muted/50 text-left text-xs font-black uppercase text-muted-foreground"><tr>{["คำขอ", "ผู้รับเงิน", "บัญชีสำหรับ SCB", "ยอดอนุมัติ", "ยอดโอนสุทธิ", "สถานะ", "เส้นทางอนุมัติ / ผู้อนุมัติจริง", "ดำเนินการ"].map((heading, index) => <th key={heading} className={`px-4 py-3 ${index === 6 ? "min-w-[250px]" : ""} ${[3, 4, 7].includes(index) ? "text-right" : "text-left"}`}>{heading}</th>)}</tr></thead>
      <tbody className="divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-muted/40">
        <td className="px-4 py-4"><Link to={`/expense-requests/${row.id}`} state={{ from: "accounting" }} className="font-mono font-black text-primary hover:underline">{row.request_no}</Link><p className="mt-1 text-xs text-muted-foreground">{row.expense_type_name || "-"} · {row.department_name || "ไม่ระบุแผนก"}</p></td>
        <td className="px-4 py-4"><p className="font-bold">{row.recipient_name || "-"}</p><p className="mt-1 text-xs text-muted-foreground">ผู้ส่งคำขอ: {row.requester_name || "-"}</p><p className="mt-1 text-[11px] text-muted-foreground/70">ส่งเมื่อ: {row.submitted_at ? formatDateTime(row.submitted_at) : "-"}</p></td>
        <td className="px-4 py-4"><div className="flex items-center gap-2"><div className="min-w-0"><p className="font-bold">{row.bank_name || "-"} · {row.bank_account_name || "-"}</p><p className="font-mono text-xs text-muted-foreground">{row.bank_account_number || "-"}</p></div><button type="button" onClick={() => copyForScb(row)} className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl bg-muted px-3 text-xs font-black hover:bg-primary/10 hover:text-primary"><Clipboard className="h-3.5 w-3.5" />คัดลอก</button></div></td>
        <td className="px-4 py-4 text-right font-bold">{formatCurrency(row.gross)}</td>
        <td className="px-4 py-4 text-right font-black text-primary">{formatCurrency(row.transfer_amount)}{row.is_adjustment_transfer ? <p className="text-xs font-bold text-amber-600">ส่วนต่างเงินทดรอง</p> : row.withholding > 0 ? <p className="text-xs font-bold text-rose-500">หัก {formatCurrency(row.withholding)}</p> : null}</td>
        <td className="px-4 py-4">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusColor[row.status] || "bg-muted"}`}>{statusLabel[row.status] || row.status}</span>
          {row.installment_no && <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">งวด {row.installment_no}</span>}
          {row.installment_chain_status === "in_progress" && <p className="mt-1 text-xs font-bold text-orange-600">แบ่งจ่ายยังไม่ครบ</p>}
        </td>
        <td className="px-4 py-4 align-top"><ApprovalRouteSummary steps={row.approval_steps} approvedAt={row.approved_at} onDetails={() => setRouteDetails(row)} /></td>
        <td className="px-4 py-4 text-right"><Link to={`/expense-requests/${row.id}`} state={{ from: "accounting" }} className="inline-flex h-10 items-center rounded-md bg-primary/10 px-6 text-xs font-black text-primary hover:bg-primary/20 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700">เปิดรายการ</Link></td>
      </tr>)}</tbody></table>
      {loading && <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {!loading && rows.length === 0 && <div className="flex flex-col items-center py-14 text-muted-foreground"><Building2 className="mb-3 h-9 w-9" /><p>ไม่มีรายการตามตัวกรอง</p></div>}
    </div></CardContent></Card>
    <Dialog open={!!routeDetails} onOpenChange={(open) => !open && setRouteDetails(null)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>รายละเอียดเส้นทางอนุมัติ</DialogTitle>
          <DialogDescription>{routeDetails?.request_no} · {routeDetails?.title}</DialogDescription>
        </DialogHeader>
        {routeDetails && <div className="px-6 pb-2"><ApprovalRouteTimeline steps={routeDetails.approval_steps} approvedAt={routeDetails.approved_at} /></div>}
        <DialogFooter><button type="button" onClick={() => setRouteDetails(null)} className="rounded-lg border px-4 py-2 text-sm font-bold hover:bg-muted">ปิด</button></DialogFooter>
      </DialogContent>
    </Dialog>
    {!loading && total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>แสดง {((page - 1) * PAGE_SIZE + 1).toLocaleString("th-TH")}–{Math.min(page * PAGE_SIZE, total).toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} รายการ · อัปเดตล่าสุด {formatDate(new Date().toISOString())}</p><div className="flex items-center gap-2"><button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 font-bold disabled:opacity-40"><ChevronLeft className="h-4 w-4" />ก่อนหน้า</button><span className="px-2 font-bold">หน้า {page.toLocaleString("th-TH")} / {Math.max(1, Math.ceil(total / PAGE_SIZE)).toLocaleString("th-TH")}</span><button type="button" onClick={() => setPage(current => Math.min(Math.ceil(total / PAGE_SIZE), current + 1))} disabled={page >= Math.ceil(total / PAGE_SIZE)} className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 font-bold disabled:opacity-40">ถัดไป<ChevronRight className="h-4 w-4" /></button></div></div>}
  </div>;
}
