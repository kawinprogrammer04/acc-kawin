import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import {
  CheckCircle2, Clock3, Download, Eraser, FileText, Loader2, Plus,
  Search, SlidersHorizontal, WalletCards, XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DataListFilterSelect, DataListMultiFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListKpiCard } from "@/components/data-list/DataListKpiCard";
import { DataListPagination } from "@/components/data-list/DataListPagination";
import {
  dataListFilterControlClass, dataListTableHeaderCellClass, dataListTableScrollClass,
} from "@/components/data-list/styles";
import {
  expenseDashboardApi, type ExpenseDashboardData, type ExpenseDashboardQuery,
  type ExpenseDashboardRequest,
} from "@/api/approvals";
import { getApiErrorMessage } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { formatCurrency, formatDate } from "@/lib/format";

const DEFAULT_PAGE_SIZE = 25;
const CHART_COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#2563eb", "#f43f5e", "#64748b", "#8b5cf6"];
const statusCards = [
  { key: "requested", label: "ขอเบิก", icon: FileText, tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { key: "pending_approval", label: "รออนุมัติ", icon: Clock3, tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  { key: "approved", label: "อนุมัติแล้ว", icon: CheckCircle2, tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  { key: "paid", label: "เบิกจ่ายแล้ว", icon: WalletCards, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  { key: "cancelled", label: "ยกเลิก", icon: XCircle, tone: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
] as const;

const statusLabel: Record<string, string> = {
  draft: "ขอเบิก", returned_for_correction: "ส่งกลับให้แก้ไข",
  pending_approval: "รออนุมัติ", pending_adjustment_approval: "รออนุมัติส่วนต่าง",
  approved: "อนุมัติแล้ว", accounting_review: "รอบัญชีตรวจ", ready_to_pay: "พร้อมจ่าย",
  partially_paid: "จ่ายบางส่วน", paid: "จ่ายแล้ว", settlement_due: "รอเคลียร์เงินทดรอง",
  settlement_review: "รอตรวจเคลียร์", completed: "เบิกจ่ายแล้ว", rejected: "ไม่อนุมัติ", cancelled: "ยกเลิก",
};

type DashboardFilters = {
  year: number;
  q: string;
  category_id: string;
  status_group: string;
  department_ids: string[];
  position_ids: string[];
  requester_ids: string[];
};

function emptyFilters(year = new Date().getFullYear()): DashboardFilters {
  return { year, q: "", category_id: "", status_group: "", department_ids: [], position_ids: [], requester_ids: [] };
}

function toApiQuery(filters: DashboardFilters): ExpenseDashboardQuery {
  return {
    year: filters.year,
    q: filters.q.trim() || undefined,
    category_id: filters.category_id ? Number(filters.category_id) : undefined,
    status_group: filters.status_group || undefined,
    department_ids: filters.department_ids.map(Number),
    position_ids: filters.position_ids.map(Number),
    requester_ids: filters.requester_ids.map(Number),
  };
}

function StatusBadge({ item }: { item: ExpenseDashboardRequest }) {
  const color = {
    requested: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    approved: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
    paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    cancelled: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  }[item.status_group];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{statusLabel[item.status] || item.status}</span>;
}

export function ExpenseDashboardPage() {
  const { currentCompany } = useCompany();
  const [filters, setFilters] = useState<DashboardFilters>(emptyFilters);
  const [applied, setApplied] = useState<DashboardFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<ExpenseDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const cleared = emptyFilters();
    setFilters(cleared); setApplied(cleared); setPage(1);
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setApplied(current => JSON.stringify(current) === JSON.stringify(filters) ? current : { ...filters });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (!currentCompany) return;
    let active = true;
    setLoading(true); setError("");
    expenseDashboardApi.get({ ...toApiQuery(applied), page, page_size: pageSize })
      .then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(getApiErrorMessage(err, "โหลดแดชบอร์ดค่าใช้จ่ายไม่สำเร็จ")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentCompany?.id, applied, page, pageSize]);

  const categoryTotal = useMemo(() => (data?.category_usage ?? []).reduce((sum, item) => sum + Number(item.total), 0), [data]);
  const departmentMax = Math.max(0, ...(data?.department_usage ?? []).map(item => Number(item.total)));
  const requesterMax = Math.max(0, ...(data?.top_requesters ?? []).map(item => Number(item.total)));
  const overBudget = Number(data?.total_remaining ?? 0) < 0;
  const availableYears = data?.available_years?.length ? data.available_years : [filters.year];
  const option = (items: Array<{ id: number; name: string }> = []) => items.map(item => ({ value: String(item.id), label: item.name }));

  const resetFilters = () => {
    const cleared = emptyFilters();
    setFilters(cleared); setApplied(cleared); setPage(1);
  };

  const exportRows = async () => {
    setExporting(true); setError("");
    try {
      await expenseDashboardApi.exportExcel(toApiQuery(applied));
    } catch (err) { setError(getApiErrorMessage(err, "ดาวน์โหลดข้อมูลไม่สำเร็จ")); }
    finally { setExporting(false); }
  };

  return <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25"><WalletCards className="h-7 w-7" /></div>
        <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">แดชบอร์ดระบบเบิก–จ่ายเงิน</h1><p className="mt-1 text-sm text-muted-foreground">ภาพรวมคำขอ งบประมาณ และสถานะการจ่ายจากข้อมูลจริงใน ACC</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportRows} disabled={exporting} className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-bold transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-60 dark:hover:text-indigo-300">{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}ดาวน์โหลด Excel</button>
        <Link to="/expense-requests/create" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:-translate-y-0.5"><Plus className="h-4 w-4" />เพิ่มรายการ</Link>
      </div>
    </div>

    <section className="grid grid-cols-2 gap-4 xl:grid-cols-5" aria-label="สรุปสถานะคำขอ">
      {statusCards.map(card => <button key={card.key} type="button" aria-pressed={filters.status_group === card.key} onClick={() => setFilters(current => ({ ...current, status_group: current.status_group === card.key ? "" : card.key }))} className={`rounded-xl text-left outline-none transition hover:-translate-y-0.5 focus:ring-4 focus:ring-primary/20 ${filters.status_group === card.key ? "ring-2 ring-primary" : ""}`}>
        <DataListKpiCard label={card.label} value={data?.status_counts?.[card.key] ?? 0} tone={card.tone} icon={card.icon} />
      </button>)}
    </section>

    <section className="rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-xl shadow-indigo-950/20 sm:p-7">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-200">งบประมาณปี {applied.year}</p><p className="mt-1 text-sm text-slate-300">ยอดใช้คำนวณจากรายการที่อนุมัติแล้วหรือเบิกจ่ายแล้วในตัวกรองปัจจุบัน</p></div>
        <Link to="/budgets" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold transition hover:bg-white/15"><SlidersHorizontal className="h-4 w-4" />ตั้งค่างบประมาณ</Link>
      </div>
      <div className="grid gap-5 sm:grid-cols-3 sm:divide-x sm:divide-white/15">
        <div className="sm:pr-5"><p className="text-xs text-slate-300">งบประมาณรวม</p><p className="mt-1 text-2xl font-black text-amber-300">{formatCurrency(data?.total_budget ?? 0)}</p></div>
        <div className="sm:px-5"><p className="text-xs text-slate-300">ใช้ไปแล้ว</p><p className="mt-1 text-2xl font-black text-indigo-200">{formatCurrency(data?.total_used ?? 0)}</p></div>
        <div className="sm:pl-5"><p className="text-xs text-slate-300">{overBudget ? "เกินงบประมาณ" : "คงเหลือ"}</p><p className={`mt-1 text-2xl font-black ${overBudget ? "text-rose-300" : "text-emerald-300"}`}>{overBudget ? "-" : ""}{formatCurrency(Math.abs(data?.total_remaining ?? 0))}</p></div>
      </div>
    </section>

    <form onSubmit={event => event.preventDefault()} className="relative z-20 space-y-5 rounded-2xl border bg-card/90 p-5 shadow-sm backdrop-blur sm:p-6">
      <label className="block min-w-0 text-sm font-bold">ค้นหารายการ
        <span className="relative block"><Search className="pointer-events-none absolute left-4 top-6 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={filters.q} onChange={event => setFilters(current => ({ ...current, q: event.target.value }))} placeholder="เลขที่เอกสาร / ผู้เบิก / รายละเอียด" className={`${dataListFilterControlClass} pl-11`} /></span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <DataListFilterSelect label="ปี" value={String(filters.year)} allLabel="เลือกปี" allowEmpty={false} options={availableYears.map(year => ({ value: String(year), label: `ปี ${year}` }))} onChange={value => setFilters(current => ({ ...current, year: Number(value) }))} />
        <DataListFilterSelect label="หมวดหมู่" value={filters.category_id} allLabel="ทุกหมวดหมู่" options={option(data?.options.categories)} onChange={category_id => setFilters(current => ({ ...current, category_id }))} />
        <DataListFilterSelect label="สถานะ" value={filters.status_group} allLabel="ทุกสถานะ" options={statusCards.map(item => ({ value: item.key, label: item.label }))} onChange={status_group => setFilters(current => ({ ...current, status_group }))} />
        <DataListMultiFilterSelect label="แผนก" values={filters.department_ids} allLabel="ทุกแผนก" options={option(data?.options.departments)} onChange={department_ids => setFilters(current => ({ ...current, department_ids }))} />
        <DataListMultiFilterSelect label="ตำแหน่ง" values={filters.position_ids} allLabel="ทุกตำแหน่ง" options={option(data?.options.positions)} onChange={position_ids => setFilters(current => ({ ...current, position_ids }))} />
        <DataListMultiFilterSelect label="ผู้เบิก" values={filters.requester_ids} allLabel="ทุกคน" options={option(data?.options.requesters)} onChange={requester_ids => setFilters(current => ({ ...current, requester_ids }))} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><span className="text-xs font-bold text-muted-foreground">ตัวกรองทำงานอัตโนมัติและอัปเดตทุกส่วนของแดชบอร์ด</span><button type="button" onClick={resetFilters} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-5 text-sm font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"><Eraser className="h-4 w-4" />ล้างตัวกรอง</button></div>
    </form>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {loading && <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />กำลังอัปเดตข้อมูลตามตัวกรอง...</div>}

    <section className="grid gap-5 xl:grid-cols-[1.35fr_1fr_1fr]">
      <Card><CardContent className="p-5 sm:p-6"><div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="font-black">งบประมาณเทียบยอดใช้จ่ายรายเดือน</h2><p className="mt-1 text-xs text-muted-foreground">งบตั้งต้นเทียบกับยอดที่ถูกนับเป็นค่าใช้จ่าย</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{applied.year}</span></div>
        <ResponsiveContainer width="100%" height={245}><BarChart data={data?.monthly ?? []} margin={{ left: -14, right: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={value => Number(value) >= 1000 ? `${Math.round(Number(value) / 1000)}k` : String(value)} /><Tooltip formatter={value => formatCurrency(Number(value))} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="budget" name="งบประมาณ" fill="#fcd34d" radius={[4, 4, 0, 0]} /><Bar dataKey="used" name="ใช้ไปแล้ว" radius={[4, 4, 0, 0]}>{(data?.monthly ?? []).map(item => <Cell key={item.month} fill={item.over_budget ? "#f43f5e" : "#6366f1"} />)}</Bar></BarChart></ResponsiveContainer>
      </CardContent></Card>

      <Card><CardContent className="p-5 sm:p-6"><h2 className="font-black">ยอดใช้จ่ายตามหมวดหมู่</h2><p className="mt-1 text-xs text-muted-foreground">เฉพาะรายการที่อนุมัติหรือเบิกจ่ายแล้ว</p>
        {categoryTotal > 0 ? <><div className="relative"><ResponsiveContainer width="100%" height={185}><PieChart><Pie data={data?.category_usage ?? []} dataKey="total" nameKey="category" innerRadius={50} outerRadius={76} paddingAngle={2}>{(data?.category_usage ?? []).map((item, index) => <Cell key={item.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip formatter={value => formatCurrency(Number(value))} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><strong className="text-sm font-black">{formatCurrency(categoryTotal)}</strong><span className="text-[10px] text-muted-foreground">ใช้ไปแล้ว</span></div></div><div className="space-y-2.5">{(data?.category_usage ?? []).slice(0, 7).map((item, index) => <div key={item.category} className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 font-semibold"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} /><span className="truncate">{item.category}</span></span><span className="shrink-0 font-black">{formatCurrency(item.total)} <small className="font-semibold text-muted-foreground">({Math.round(item.total / categoryTotal * 100)}%)</small></span></div>)}</div></> : <p className="py-20 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลการใช้จ่าย</p>}
      </CardContent></Card>

      <Card><CardContent className="p-5 sm:p-6"><h2 className="font-black">ยอดใช้จ่ายตามแผนก</h2><p className="mt-1 text-xs text-muted-foreground">เรียงจากยอดสูงสุดในขอบเขตตัวกรอง</p><div className="mt-6 space-y-5">{(data?.department_usage ?? []).slice(0, 7).map(item => <div key={item.department}><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="truncate font-bold">{item.department}</span><span className="shrink-0 font-black">{formatCurrency(item.total)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${departmentMax ? Math.max(2, item.total / departmentMax * 100) : 0}%` }} /></div></div>)}{!data?.department_usage?.length && <p className="py-16 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลการใช้จ่าย</p>}</div></CardContent></Card>
    </section>

    <Card className="overflow-hidden"><CardContent className="p-0"><div className="border-b p-5 sm:p-6"><h2 className="font-black">รายละเอียดงบประมาณรายเดือน</h2><p className="mt-1 text-xs text-muted-foreground">ตรวจสอบงบตั้งต้น ยอดใช้จริง และยอดคงเหลือของแต่ละเดือน</p></div><div className={dataListTableScrollClass}><table className="w-full min-w-[680px] text-sm"><thead className="text-xs font-black uppercase text-muted-foreground"><tr><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-left`}>เดือน</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-right`}>งบตั้งต้น</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-right`}>ใช้ไปแล้ว</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-right`}>คงเหลือ / ติดลบ</th></tr></thead><tbody className="divide-y">{(data?.monthly ?? []).map(item => <tr key={item.month} className="hover:bg-muted/40"><td className="px-5 py-3.5 font-bold">{item.label}</td><td className="px-5 py-3.5 text-right font-mono">{formatCurrency(item.budget)}</td><td className="px-5 py-3.5 text-right font-mono">{formatCurrency(item.used)}</td><td className={`px-5 py-3.5 text-right font-mono font-black ${item.over_budget ? "text-rose-600" : "text-emerald-600"}`}>{item.over_budget ? `เกินงบ ${formatCurrency(Math.abs(item.remaining))}` : formatCurrency(item.remaining)}</td></tr>)}</tbody><tfoot className="border-t-2 bg-muted/50"><tr><td className="px-5 py-4 font-black">รวมทั้งปี</td><td className="px-5 py-4 text-right font-black">{formatCurrency(data?.total_budget ?? 0)}</td><td className="px-5 py-4 text-right font-black">{formatCurrency(data?.total_used ?? 0)}</td><td className={`px-5 py-4 text-right font-black ${overBudget ? "text-rose-600" : "text-emerald-600"}`}>{formatCurrency(data?.total_remaining ?? 0)}</td></tr></tfoot></table></div></CardContent></Card>

    <section className="grid gap-5 xl:grid-cols-[2fr_1fr]">
      <div className="space-y-4"><Card className="overflow-hidden"><CardContent className="p-0"><div className="flex flex-col gap-2 border-b p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><h2 className="font-black">รายละเอียดรายการเบิกเงิน</h2><p className="mt-1 text-xs text-muted-foreground">รายการจริงตามปีและตัวกรองที่เลือก</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-bold">ทั้งหมด {(data?.expenses.total ?? 0).toLocaleString("th-TH")} รายการ</span></div><div className={dataListTableScrollClass}><table className="w-full min-w-[900px] text-sm"><thead className="text-xs font-black uppercase text-muted-foreground"><tr><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-left`}>วันที่</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-left`}>รายการ</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-left`}>ผู้เบิก / แผนก</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-left`}>หมวดหมู่</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-right`}>จำนวนเงิน</th><th className={`${dataListTableHeaderCellClass} px-5 py-3 text-left`}>สถานะ</th></tr></thead><tbody className="divide-y">{(data?.expenses.items ?? []).map(item => <tr key={item.id} className="hover:bg-muted/40"><td className="whitespace-nowrap px-5 py-4 text-xs font-semibold text-muted-foreground">{formatDate(`${item.request_date}T00:00:00`)}</td><td className="max-w-[280px] px-5 py-4"><Link to={`/expense-requests/${item.id}`} state={{ from: "dashboard" }} className="block truncate font-bold text-primary hover:underline">{item.title || item.request_no}</Link><span className="mt-1 block font-mono text-[11px] text-muted-foreground">{item.request_no || "-"}</span></td><td className="px-5 py-4"><p className="font-bold">{item.requester_name}</p><p className="mt-1 text-xs text-muted-foreground">{item.department_name}{item.position_name ? ` · ${item.position_name}` : ""}</p></td><td className="px-5 py-4 text-xs font-semibold">{item.category}</td><td className="px-5 py-4 text-right font-black">{formatCurrency(item.amount)}</td><td className="px-5 py-4"><StatusBadge item={item} /></td></tr>)}</tbody>{!loading && (data?.expenses.total ?? 0) > 0 && <tfoot className="border-t-2 bg-muted/50"><tr><td colSpan={4} className="px-5 py-4 text-right font-black">ยอดรวมรายการตามตัวกรอง</td><td className="px-5 py-4 text-right font-black text-primary">{formatCurrency(data?.total_request_amount ?? 0)}</td><td /></tr></tfoot>}</table>{loading && !data && <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}{!loading && !data?.expenses.items.length && <p className="py-14 text-center text-sm text-muted-foreground">ไม่มีรายการตามตัวกรอง</p>}</div></CardContent></Card>
        {!loading && <DataListPagination total={data?.expenses.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={value => { setPage(1); setPageSize(value); }} />}
      </div>

      <aside className="space-y-5"><Card><CardContent className="p-5 sm:p-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-black">รอผู้อนุมัติพิจารณา</h2><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">{(data?.pending_approval.length ?? 0).toLocaleString("th-TH")} รายการล่าสุด</span></div><div className="divide-y">{(data?.pending_approval ?? []).map(item => <Link key={item.id} to={`/expense-requests/${item.id}`} state={{ from: "dashboard" }} className="block py-3 transition hover:text-primary"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.requester_name} · {item.request_no}</p></div><span className="shrink-0 text-xs font-black">{formatCurrency(item.amount)}</span></div></Link>)}{!data?.pending_approval.length && <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีรายการรออนุมัติ</p>}</div></CardContent></Card>
        <Card><CardContent className="p-5 sm:p-6"><h2 className="mb-4 font-black">ผู้เบิกสูงสุดตามยอดสะสม</h2><div className="space-y-4">{(data?.top_requesters ?? []).map((item, index) => <div key={item.requester} className="flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-black">{index + 1}</span><div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-bold">{item.requester}</span><span className="shrink-0 font-black">{formatCurrency(item.total)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${requesterMax ? Math.max(2, item.total / requesterMax * 100) : 0}%` }} /></div></div></div>)}{!data?.top_requesters.length && <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลยอดสะสม</p>}</div></CardContent></Card>
      </aside>
    </section>
  </div>;
}
