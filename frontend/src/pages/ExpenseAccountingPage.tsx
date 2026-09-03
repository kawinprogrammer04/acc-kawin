import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2, Clipboard, Eraser, FileSignature, FileSpreadsheet,
  Landmark, Loader2, RotateCcw, Settings2, Wallet, WalletCards,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { BankLogo } from "@/components/ui/bank-logo";
import { DataListFilterSelect, DataListMultiFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListKpiCard } from "@/components/data-list/DataListKpiCard";
import { DataListPagination } from "@/components/data-list/DataListPagination";
import { PresetDateRangeFilter } from "@/components/data-list/PresetDateRangeFilter";
import {
  dataListFilterControlClass,
  dataListFilterPanelClass,
  dataListTableHeaderCellClass,
  dataListTableScrollClass,
} from "@/components/data-list/styles";
import { getApiErrorMessage } from "@/api/client";
import {
  expenseAccountingApi, expenseSettingsApi, expenseTypesApi,
} from "@/api/approvals";
import type {
  AccountingFilters, AccountingRequest, Department, ExpenseType,
} from "@/api/approvals";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { formatCurrency, formatDate, today } from "@/lib/format";
import { formatCompanyLabel } from "@/lib/companyPresentation";

const FILTER_STORAGE_KEY = "expense_accounting_filters";
const DEFAULT_PAGE_SIZE = 25;
const accountingTableHeadings = ["คำขอ", "วันที่", "ธนาคาร", "เลขบัญชี", "ชื่อผู้รับ", "ยอดโอน", "รายการ", "ประเภท", "สถานะ", "ใบกำกับ", "ดำเนินการ"];
const accountingTableGroupEndIndexes = new Set([0, 4, 7, 9]);
const accountingTableGroupDividerClass = "border-r-2 border-border";

type FilterForm = {
  statuses: string[]; company_id: string; department_ids: string[]; type_ids: string[];
  query: string; date_from: string; date_to: string; withholding_only: boolean;
};

const emptyFilters = (companyId?: number): FilterForm => ({
  statuses: [], company_id: companyId ? String(companyId) : "", department_ids: [],
  type_ids: [], query: "", date_from: today(), date_to: today(), withholding_only: false,
});

function storedStringArray(value: unknown, legacyValue: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value === "string" && value) return value.split(",").filter(Boolean);
  if (typeof legacyValue === "string" && legacyValue) return [legacyValue];
  return [];
}

function readStoredFilters(): FilterForm {
  try {
    const stored = JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "{}") as Record<string, unknown>;
    const storedDateFrom = typeof stored.date_from === "string" ? stored.date_from : "";
    const storedDateTo = typeof stored.date_to === "string" ? stored.date_to : "";
    const hasStoredDateRange = typeof stored.date_from === "string" || typeof stored.date_to === "string";
    const defaultDate = today();
    return {
      ...emptyFilters(),
      statuses: storedStringArray(stored.statuses, stored.status),
      company_id: typeof stored.company_id === "string" ? stored.company_id : "",
      department_ids: storedStringArray(stored.department_ids, stored.department_id),
      type_ids: storedStringArray(stored.type_ids, stored.type_id),
      query: typeof stored.query === "string" ? stored.query : "",
      date_from: hasStoredDateRange ? storedDateFrom : defaultDate,
      date_to: hasStoredDateRange ? storedDateTo : defaultDate,
      withholding_only: stored.withholding_only === true,
    };
  } catch {
    return emptyFilters();
  }
}

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

function CopyIconButton({ value, label, onCopy }: { value?: string; label: string; onCopy: (label: string, value?: string) => void }) {
  if (!value) return null;
  return <button
    type="button"
    onClick={() => onCopy(label, value)}
    title={`คัดลอก${label}`}
    aria-label={`คัดลอก${label}`}
    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
  ><Clipboard className="h-3.5 w-3.5" /></button>;
}

function toApiFilters(filters: FilterForm): AccountingFilters {
  return {
    statuses: filters.statuses.length ? filters.statuses.join(",") : undefined,
    department_ids: filters.department_ids.length ? filters.department_ids.join(",") : undefined,
    type_ids: filters.type_ids.length ? filters.type_ids.join(",") : undefined,
    query: filters.query.trim() || undefined,
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

export function ExpenseAccountingPage() {
  const { companies, currentCompany, setCurrentCompany } = useCompany();
  const [rows, setRows] = useState<AccountingRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [departments, setDepartments] = useState<Department[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [filters, setFilters] = useState<FilterForm>(readStoredFilters);
  const [applied, setApplied] = useState<FilterForm>(readStoredFilters);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!currentCompany) return;
    setPage(1);
    setFilters(current => ({ ...current, company_id: String(currentCompany.id) }));
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const selectedCompany = companies.find(company => company.id === Number(filters.company_id));
      if (selectedCompany && selectedCompany.id !== currentCompany?.id) {
        setCurrentCompany(selectedCompany);
        return;
      }
      setPage(1);
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
      setApplied(current => JSON.stringify(current) === JSON.stringify(filters) ? current : { ...filters });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [companies, currentCompany?.id, filters, setCurrentCompany]);

  useEffect(() => {
    Promise.all([expenseSettingsApi.departments(), expenseTypesApi.list()])
      .then(([departmentRows, typeRows]) => { setDepartments(departmentRows); setTypes(typeRows); })
      .catch(() => { setDepartments([]); setTypes([]); });
  }, [currentCompany?.id]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [result, summary] = await Promise.all([
        expenseAccountingApi.list(toApiFilters(applied), page, pageSize),
        expenseAccountingApi.stats(toApiFilters(applied)),
      ]);
      setRows(result.items); setTotal(result.total); setStats(summary);
    } catch (e) { setError(getApiErrorMessage(e, "โหลดรายการบัญชีไม่สำเร็จ")); }
    finally { setLoading(false); }
  }, [applied, page, pageSize]);
  useEffect(() => { load(); }, [load]);

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

  const copyField = async (label: string, value?: string) => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setNotice(`คัดลอก${label}แล้ว`); window.setTimeout(() => setNotice(""), 2000); }
    catch { setError("เบราว์เซอร์ไม่อนุญาตให้คัดลอก กรุณาคัดลอกจากข้อมูลในตาราง"); }
  };

  const visibleDepartments = useMemo(() => departments.filter(item => item.is_active), [departments]);
  const visibleTypes = useMemo(() => types.filter(item => item.is_active), [types]);
  return <div className="w-full space-y-6 p-6">
    {/* <FinanceNav /> */}

    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg"><Landmark className="h-7 w-7" /></div><div><h1 className="text-3xl font-black">บัญชีจ่ายเงิน</h1><p className="mt-1 text-sm text-muted-foreground">ตรวจรายการที่กำลังอนุมัติและรายการที่อนุมัติครบแล้ว พร้อมตรวจสอบผู้อนุมัติจริงก่อนจ่ายเงิน</p></div></div>
      <button type="button" onClick={exportExcel} disabled={exporting} aria-busy={exporting} className="group relative flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-emerald-500/50 disabled:cursor-wait disabled:opacity-60 md:w-auto">{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 transition-transform group-hover:scale-110" />}ส่งออก Excel</button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <DataListKpiCard label="กำลังอนุมัติ" value={stats.pending_approval_count || 0} tone="bg-violet-100 text-violet-700 dark:bg-violet-950" icon={FileSignature} />
      <DataListKpiCard label="รายการเก่ารอส่งต่อ" value={stats.accounting_review_count || 0} tone="bg-cyan-100 text-cyan-700 dark:bg-cyan-950" icon={RotateCcw} />
      <DataListKpiCard label="พร้อมจ่าย" value={stats.ready_to_pay_count || 0} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950" icon={WalletCards} />
      <DataListKpiCard label="จ่ายบางส่วน" value={stats.partially_paid_count || 0} tone="bg-teal-100 text-teal-700 dark:bg-teal-950" icon={WalletCards} />
      <DataListKpiCard label="รอตรวจเคลียร์" value={stats.settlement_review_count || 0} tone="bg-amber-100 text-amber-700 dark:bg-amber-950" icon={Landmark} />
      <DataListKpiCard label="ยอดโอนรวม" value={Number(stats.transfer_amount_total || 0)} currency tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-950" icon={Wallet} />
    </div>

    <form onSubmit={event => event.preventDefault()} className={`${dataListFilterPanelClass} space-y-5 rounded-2xl border bg-card/80 p-6 shadow-lg backdrop-blur-xl`}>
      <label className="block min-w-0 text-sm font-bold">ค้นหาคำขอ
        <input className={dataListFilterControlClass} value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} placeholder="เลขที่คำขอ รายการ หรือชื่อผู้รับ" />
      </label>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DataListMultiFilterSelect label="สถานะ" values={filters.statuses} allLabel="ทุกสถานะ" options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))} onChange={statuses => setFilters(current => ({ ...current, statuses }))} />
        <DataListFilterSelect label="บริษัท" value={filters.company_id} allLabel="เลือกบริษัท" allowEmpty={false} options={companies.filter(company => company.is_active).map(company => ({ value: String(company.id), label: formatCompanyLabel(company) }))} onChange={company_id => setFilters(current => ({ ...current, company_id }))} />
        <DataListMultiFilterSelect label="แผนก" values={filters.department_ids} allLabel="ทุกแผนก" options={visibleDepartments.map(item => ({ value: String(item.id), label: item.name }))} onChange={department_ids => setFilters(current => ({ ...current, department_ids }))} />
        <DataListMultiFilterSelect label="ประเภท" values={filters.type_ids} allLabel="ทุกประเภท" options={visibleTypes.map(item => ({ value: String(item.id), label: item.name }))} onChange={type_ids => setFilters(current => ({ ...current, type_ids }))} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <PresetDateRangeFilter dateFrom={filters.date_from} dateTo={filters.date_to} onChange={(date_from, date_to) => setFilters(current => ({ ...current, date_from, date_to }))} />
        <label className="flex min-h-12 items-center gap-3 px-1 text-sm font-bold sm:col-span-1 lg:col-span-3"><input type="checkbox" checked={filters.withholding_only} onChange={event => setFilters(current => ({ ...current, withholding_only: event.target.checked }))} className="h-4 w-4 shrink-0 rounded border-input text-primary" />รายการเกี่ยวกับหัก ณ ที่จ่ายเท่านั้น</label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <span className="text-xs font-bold text-muted-foreground">ตัวกรองทำงานอัตโนมัติเมื่อเลือกหรือกรอกข้อมูล</span>
        <button type="button" onClick={resetFilters} className="inline-flex h-11 items-center gap-2 rounded-md border border-input bg-background px-8 text-sm font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Eraser className="h-4 w-4" />ล้างตัวกรอง</button>
      </div>
    </form>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}

    <Card className="overflow-hidden"><CardContent className="p-0"><div className={dataListTableScrollClass}><table className="w-full min-w-[1760px] text-sm"><thead className="text-left text-xs font-black uppercase text-muted-foreground"><tr>{accountingTableHeadings.map((heading, index) => <th key={heading} className={`${dataListTableHeaderCellClass} px-4 py-3 ${[5, 10].includes(index) ? "text-right" : "text-left"} ${accountingTableGroupEndIndexes.has(index) ? accountingTableGroupDividerClass : ""}`}>{heading}</th>)}</tr></thead>
      <tbody className="divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-muted/40">
        <td className={`px-4 py-4 ${accountingTableGroupDividerClass}`}><Link to={`/expense-requests/${row.id}`} state={{ from: "accounting" }} className="font-mono font-black text-primary hover:underline">{row.request_no}</Link><p className="mt-1 text-xs text-muted-foreground">{row.department_name || "ไม่ระบุแผนก"}</p></td>
        <td className="whitespace-nowrap px-4 py-4 font-medium">{formatDate(`${row.request_date}T00:00:00`)}</td>
        <td className="px-4 py-4"><div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2.5"><BankLogo bankName={row.bank_name} /><span className="font-bold">{row.bank_name || "-"}</span></div><CopyIconButton value={row.bank_name} label="ธนาคาร" onCopy={copyField} /></div></td>
        <td className="px-4 py-4"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{row.bank_account_number || "-"}</span><CopyIconButton value={row.bank_account_number} label="เลขบัญชี" onCopy={copyField} /></div></td>
        <td className={`px-4 py-4 ${accountingTableGroupDividerClass}`}><div className="flex items-center justify-between gap-2"><span className="font-bold">{row.bank_account_name || "-"}</span><CopyIconButton value={row.bank_account_name} label="ชื่อผู้รับ" onCopy={copyField} /></div></td>
        <td className="px-4 py-4 text-right"><div className="flex items-center justify-end gap-2"><span className="font-black text-primary">{formatCurrency(row.transfer_amount)}</span><CopyIconButton value={row.transfer_amount != null ? String(row.transfer_amount) : undefined} label="ยอดโอน" onCopy={copyField} /></div></td>
        <td className="px-4 py-4"><p className="max-w-xs break-words">{row.title || "-"}</p></td>
        <td className={`px-4 py-4 ${accountingTableGroupDividerClass}`}><p className="font-bold">{row.expense_type_name || "-"}</p></td>
        <td className="px-4 py-4">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusColor[row.status] || "bg-muted"}`}>{statusLabel[row.status] || row.status}</span>
          {row.installment_no && <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">งวด {row.installment_no}</span>}
          {row.installment_chain_status === "in_progress" && <p className="mt-1 text-xs font-bold text-orange-600">แบ่งจ่ายยังไม่ครบ</p>}
        </td>
        <td className={`px-4 py-4 ${accountingTableGroupDividerClass}`}>
          {Number(row.vat || 0) > 0 && <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">มีใบกำกับภาษี</span>}
        </td>
        <td className="px-4 py-4 text-right"><Link to={`/expense-requests/${row.id}`} state={{ from: "accounting" }} className="inline-flex h-10 items-center rounded-md bg-primary/10 px-6 text-xs font-black text-primary hover:bg-primary/20 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700">เปิดรายการ</Link></td>
      </tr>)}</tbody>
      {!loading && total > 0 && <tfoot className="border-t-2 bg-muted/50">
        <tr>
          <td colSpan={5} className={`px-4 py-4 text-right text-sm font-black ${accountingTableGroupDividerClass}`}>ยอดโอนรวม</td>
          <td className="whitespace-nowrap px-4 py-4 text-right text-base font-black text-primary">{formatCurrency(stats.transfer_amount_total || 0)}</td>
          <td colSpan={2} className={accountingTableGroupDividerClass} />
          <td colSpan={2} className={accountingTableGroupDividerClass} />
          <td />
        </tr>
      </tfoot>}
    </table>
      {loading && <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {!loading && rows.length === 0 && <div className="flex flex-col items-center py-14 text-muted-foreground"><Building2 className="mb-3 h-9 w-9" /><p>ไม่มีรายการตามตัวกรอง</p></div>}
    </div></CardContent></Card>
    {!loading && <DataListPagination
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={value => { setError(""); setPage(1); setPageSize(value); }}
    />}
  </div>;
}
