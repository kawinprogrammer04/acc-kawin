import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2, Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Eraser, FileSignature, FileSpreadsheet,
  Landmark, Loader2, RotateCcw, Settings2, Wallet, WalletCards,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { getApiErrorMessage } from "@/api/client";
import {
  expenseAccountingApi, expenseSettingsApi, expenseTypesApi,
} from "@/api/approvals";
import type {
  AccountingFilters, AccountingRequest, Department, ExpenseType,
} from "@/api/approvals";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { formatCurrency, formatDate, localDateInput, today } from "@/lib/format";

const FILTER_STORAGE_KEY = "expense_accounting_filters";
const DEFAULT_PAGE_SIZE = 25;

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

type FilterSelectOption = { value: string; label: string };
const filterControlClass = "mt-2 box-border h-12 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition hover:border-primary/50 hover:bg-muted/30 focus:border-primary focus:ring-2 focus:ring-primary/20";

type DatePreset = "all" | "today" | "yesterday" | "last_7_days" | "this_month" | "previous_month" | "custom";

const datePresetOptions: Array<{ value: DatePreset; label: string }> = [
  { value: "all", label: "ไม่กรองวันที่" },
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "last_7_days", label: "7 วันย้อนหลัง" },
  { value: "this_month", label: "เดือนนี้" },
  { value: "previous_month", label: "เดือนก่อน" },
  { value: "custom", label: "กำหนดเอง" },
];

function dateRangeForPreset(preset: Exclude<DatePreset, "custom">) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: today(), to: today() };
  if (preset === "yesterday") {
    const value = localDateInput(new Date(year, month, now.getDate() - 1));
    return { from: value, to: value };
  }
  if (preset === "last_7_days") return {
    from: localDateInput(new Date(year, month, now.getDate() - 6)), to: today(),
  };
  if (preset === "this_month") return {
    from: localDateInput(new Date(year, month, 1)),
    to: localDateInput(new Date(year, month + 1, 0)),
  };
  return {
    from: localDateInput(new Date(year, month - 1, 1)),
    to: localDateInput(new Date(year, month, 0)),
  };
}

function detectDatePreset(dateFrom: string, dateTo: string): DatePreset {
  for (const preset of ["all", "today", "yesterday", "last_7_days", "this_month", "previous_month"] as const) {
    const range = dateRangeForPreset(preset);
    if (dateFrom === range.from && dateTo === range.to) return preset;
  }
  return "custom";
}

function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatThaiDate(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "long", year: "numeric",
  }).format(value);
}

function orderedRange(first: Date, second: Date): { from: Date; to: Date } {
  return first <= second ? { from: first, to: second } : { from: second, to: first };
}

function DateRangeFilter({
  dateFrom, dateTo, onChange,
}: { dateFrom: string; dateTo: string; onChange: (dateFrom: string, dateTo: string) => void }) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(() => detectDatePreset(dateFrom, dateTo) === "custom");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(() => dateFrom || dateTo ? {
    from: parseLocalDate(dateFrom), to: parseLocalDate(dateTo),
  } : undefined);
  const [hoveredDay, setHoveredDay] = useState<Date>();
  const detectedPreset = detectDatePreset(dateFrom, dateTo);
  const selectedPreset = customMode ? "custom" : detectedPreset;
  const selectedFrom = parseLocalDate(dateFrom);
  const selectedTo = parseLocalDate(dateTo);
  const selectedLabel = selectedFrom && selectedTo
    ? selectedFrom.getTime() === selectedTo.getTime()
      ? formatThaiDate(selectedFrom)
      : `${formatThaiDate(selectedFrom)} – ${formatThaiDate(selectedTo)}`
    : datePresetOptions.find(option => option.value === selectedPreset)?.label || "ช่วงวันที่";
  const previewRange = customRange?.from && !customRange.to && hoveredDay
    ? orderedRange(customRange.from, hoveredDay)
    : customRange;

  useEffect(() => {
    if (!open && detectedPreset !== "custom") setCustomMode(false);
  }, [dateFrom, dateTo, detectedPreset, open]);

  const choosePreset = (preset: DatePreset) => {
    if (preset === "custom") {
      setCustomMode(true); setCustomRange(undefined); setHoveredDay(undefined); return;
    }
    const range = dateRangeForPreset(preset);
    setCustomMode(false); setHoveredDay(undefined); onChange(range.from, range.to); setOpen(false);
  };

  const chooseCustomDay = (day: Date) => {
    if (!customRange?.from || customRange.to) {
      setCustomRange({ from: day, to: undefined });
      setHoveredDay(undefined);
      return;
    }
    const { from, to } = orderedRange(customRange.from, day);
    setCustomRange({ from, to }); setHoveredDay(undefined);
    onChange(localDateInput(from), localDateInput(to));
    setOpen(false);
  };

  return <div className="min-w-0 text-sm font-bold">
    <span>ช่วงวันที่</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`ช่วงวันที่: ${selectedLabel}`} className={`${filterControlClass} flex items-center justify-between gap-3 text-left font-medium`}>
          <span className="truncate">{selectedLabel}</span><ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`${customMode ? "w-[640px]" : "w-[var(--radix-popover-trigger-width)] min-w-[320px]"} max-w-[calc(100vw-2rem)] p-2`}>
        <div className={customMode ? "grid grid-cols-1 sm:grid-cols-[220px_minmax(0,1fr)]" : ""}>
          <div className={customMode ? "sm:pr-2" : ""}>
            <p className="border-b px-2 pb-2 text-xs font-bold text-muted-foreground">เลือกช่วงวันที่</p>
            <div className="space-y-1 py-2">{datePresetOptions.map(option => {
              const selected = selectedPreset === option.value;
              return <button key={option.value} type="button" onClick={() => choosePreset(option.value)} className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-bold text-primary" : "font-medium hover:bg-muted"}`}>
                <span>{option.label}</span>{selected && <Check className="h-4 w-4" />}
              </button>;
            })}</div>
          </div>
          {customMode && <div className="border-t px-2 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-1">
            <p className="text-center text-xs font-bold text-muted-foreground">
              {customRange?.from && !customRange.to
                ? `วันเริ่มต้น ${formatThaiDate(customRange.from)} · เลือกวันสิ้นสุด`
                : "เลือกวันเริ่มต้น แล้วเลือกวันสิ้นสุด"}
            </p>
            {previewRange?.from && previewRange.to && <p className="mt-1 text-center text-xs font-bold text-primary">
              {formatThaiDate(previewRange.from)} – {formatThaiDate(previewRange.to)}
            </p>}
            <Calendar
              mode="range"
              selected={previewRange}
              defaultMonth={customRange?.from || parseLocalDate(dateFrom)}
              onDayClick={chooseCustomDay}
              onDayMouseEnter={day => setHoveredDay(day)}
              onDayMouseLeave={() => setHoveredDay(undefined)}
              numberOfMonths={1}
              formatters={{
                formatCaption: date => new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(date),
              }}
              classNames={{
                day_range_start: "rounded-l-md bg-primary text-primary-foreground",
                day_range_end: "rounded-r-md bg-primary text-primary-foreground",
                day_range_middle: "aria-selected:bg-primary/[0.08] aria-selected:text-foreground",
              }}
              className="mx-auto"
            />
          </div>}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}

function FilterSelect({
  label, value, allLabel, options, onChange, allowEmpty = true,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(option => option.value === value)?.label || allLabel;
  const selectableOptions = allowEmpty ? [{ value: "", label: allLabel }, ...options] : options;

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return <div className="min-w-0 text-sm font-bold">
    <span>{label}</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${selectedLabel}`}
          className={`${filterControlClass} flex items-center justify-between gap-3 text-left font-medium`}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-2">
        <p className="border-b px-2 pb-2 text-xs font-bold text-muted-foreground">เลือก{label}</p>
        <div className="max-h-72 space-y-1 overflow-y-auto pt-2">
          {selectableOptions.map(option => {
            const selected = value === option.value;
            return <button
              key={option.value || "all"}
              type="button"
              onClick={() => selectOption(option.value)}
              className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-bold text-primary" : "font-medium hover:bg-muted"}`}
            >
              <span className="truncate">{option.label}</span>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? "bg-primary text-primary-foreground" : "border border-input"}`}>
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>;
          })}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}

function MultiFilterSelect({
  label, values, allLabel, options, onChange,
}: {
  label: string;
  values: string[];
  allLabel: string;
  options: FilterSelectOption[];
  onChange: (values: string[]) => void;
}) {
  const selectedLabel = values.length === 0
    ? allLabel
    : values.length === 1
      ? options.find(option => option.value === values[0])?.label || values[0]
      : `เลือกแล้ว ${values.length} รายการ`;

  const toggleOption = (value: string) => {
    onChange(values.includes(value)
      ? values.filter(current => current !== value)
      : [...values, value]);
  };

  return <div className="min-w-0 text-sm font-bold">
    <span>{label}</span>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${selectedLabel}`}
          className={`${filterControlClass} flex items-center justify-between gap-3 text-left font-medium`}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          {values.length > 1 && <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-black text-primary-foreground">{values.length}</span>}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-2">
        <div className="flex items-center justify-between gap-3 border-b px-2 pb-2">
          <p className="text-xs font-bold text-muted-foreground">เลือก{label}ได้หลายรายการ</p>
          <button type="button" onClick={() => onChange([])} disabled={values.length === 0} className="shrink-0 text-xs font-bold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">เลือกทั้งหมด</button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto py-2">
          {options.map(option => {
            const selected = values.includes(option.value);
            return <button
              key={option.value}
              type="button"
              onClick={() => toggleOption(option.value)}
              className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-bold text-primary" : "font-medium hover:bg-muted"}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>;
          })}
        </div>
        <p className="border-t px-2 pt-2 text-xs text-muted-foreground">{values.length === 0 ? allLabel : `เลือกไว้ ${values.length} รายการ`}</p>
      </PopoverContent>
    </Popover>
  </div>;
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

function StatCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: typeof RotateCcw }) {
  return <Card className="overflow-hidden"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-black">{value.toLocaleString("th-TH")}</p></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-6 w-6" /></div></CardContent></Card>;
}

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
        expenseAccountingApi.list(toApiFilters(applied), page, pageSize), expenseAccountingApi.stats(),
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

  const changePageSize = (value: string) => {
    setError(""); setPage(1); setPageSize(value === "all" ? 0 : Number(value));
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
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const displayedFrom = total === 0 ? 0 : pageSize === 0 ? 1 : ((page - 1) * pageSize) + 1;
  const displayedTo = pageSize === 0 ? total : Math.min(page * pageSize, total);

  return <div className="w-full space-y-6 p-6">
    {/* <FinanceNav /> */}

    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg"><Landmark className="h-7 w-7" /></div><div><h1 className="text-3xl font-black">บัญชีจ่ายเงิน</h1><p className="mt-1 text-sm text-muted-foreground">ตรวจรายการที่กำลังอนุมัติและรายการที่อนุมัติครบแล้ว พร้อมตรวจสอบผู้อนุมัติจริงก่อนจ่ายเงิน</p></div></div>
      <button type="button" onClick={exportExcel} disabled={exporting} aria-busy={exporting} className="group relative flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-emerald-500/50 disabled:cursor-wait disabled:opacity-60 md:w-auto">{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 transition-transform group-hover:scale-110" />}ส่งออก Excel</button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard label="กำลังอนุมัติ" value={stats.pending_approval_count || 0} tone="bg-violet-100 text-violet-700 dark:bg-violet-950" icon={FileSignature} />
      <StatCard label="รายการเก่ารอส่งต่อ" value={stats.accounting_review_count || 0} tone="bg-cyan-100 text-cyan-700 dark:bg-cyan-950" icon={RotateCcw} />
      <StatCard label="พร้อมจ่าย" value={stats.ready_to_pay_count || 0} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950" icon={WalletCards} />
      <StatCard label="จ่ายบางส่วน" value={stats.partially_paid_count || 0} tone="bg-teal-100 text-teal-700 dark:bg-teal-950" icon={WalletCards} />
      <StatCard label="รอตรวจเคลียร์" value={stats.settlement_review_count || 0} tone="bg-amber-100 text-amber-700 dark:bg-amber-950" icon={Landmark} />
    </div>

    <form onSubmit={event => event.preventDefault()} className="space-y-5 rounded-2xl border bg-card/80 p-6 shadow-lg backdrop-blur-xl">
      <label className="block min-w-0 text-sm font-bold">ค้นหาคำขอ
        <input className={filterControlClass} value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} placeholder="เลขที่คำขอ รายการ หรือชื่อผู้รับ" />
      </label>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MultiFilterSelect label="สถานะ" values={filters.statuses} allLabel="ทุกสถานะ" options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))} onChange={statuses => setFilters(current => ({ ...current, statuses }))} />
        <FilterSelect label="บริษัท" value={filters.company_id} allLabel="เลือกบริษัท" allowEmpty={false} options={companies.filter(company => company.is_active).map(company => ({ value: String(company.id), label: company.name_th }))} onChange={company_id => setFilters(current => ({ ...current, company_id }))} />
        <MultiFilterSelect label="แผนก" values={filters.department_ids} allLabel="ทุกแผนก" options={visibleDepartments.map(item => ({ value: String(item.id), label: item.name }))} onChange={department_ids => setFilters(current => ({ ...current, department_ids }))} />
        <MultiFilterSelect label="ประเภท" values={filters.type_ids} allLabel="ทุกประเภท" options={visibleTypes.map(item => ({ value: String(item.id), label: item.name }))} onChange={type_ids => setFilters(current => ({ ...current, type_ids }))} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <DateRangeFilter dateFrom={filters.date_from} dateTo={filters.date_to} onChange={(date_from, date_to) => setFilters(current => ({ ...current, date_from, date_to }))} />
        <label className="flex min-h-12 items-center gap-3 px-1 text-sm font-bold sm:col-span-1 lg:col-span-3"><input type="checkbox" checked={filters.withholding_only} onChange={event => setFilters(current => ({ ...current, withholding_only: event.target.checked }))} className="h-4 w-4 shrink-0 rounded border-input text-primary" />รายการเกี่ยวกับหัก ณ ที่จ่ายเท่านั้น</label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <span className="text-xs font-bold text-muted-foreground">ตัวกรองทำงานอัตโนมัติเมื่อเลือกหรือกรอกข้อมูล</span>
        <button type="button" onClick={resetFilters} className="inline-flex h-11 items-center gap-2 rounded-md border border-input bg-background px-8 text-sm font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Eraser className="h-4 w-4" />ล้างตัวกรอง</button>
      </div>
    </form>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}

    <Card className="overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1760px] text-sm"><thead className="bg-muted/50 text-left text-xs font-black uppercase text-muted-foreground"><tr>{["คำขอ", "วันที่", "ธนาคาร", "เลขบัญชี", "ชื่อผู้รับ", "ยอดโอน", "รายการ", "ประเภท", "สถานะ", "ใบกำกับ", "ดำเนินการ"].map((heading, index) => <th key={heading} className={`px-4 py-3 ${[5, 10].includes(index) ? "text-right" : "text-left"}`}>{heading}</th>)}</tr></thead>
      <tbody className="divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-muted/40">
        <td className="px-4 py-4"><Link to={`/expense-requests/${row.id}`} state={{ from: "accounting" }} className="font-mono font-black text-primary hover:underline">{row.request_no}</Link><p className="mt-1 text-xs text-muted-foreground">{row.department_name || "ไม่ระบุแผนก"}</p></td>
        <td className="whitespace-nowrap px-4 py-4 font-medium">{formatDate(`${row.request_date}T00:00:00`)}</td>
        <td className="px-4 py-4"><div className="flex items-center justify-between gap-2"><span className="font-bold">{row.bank_name || "-"}</span><CopyIconButton value={row.bank_name} label="ธนาคาร" onCopy={copyField} /></div></td>
        <td className="px-4 py-4"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{row.bank_account_number || "-"}</span><CopyIconButton value={row.bank_account_number} label="เลขบัญชี" onCopy={copyField} /></div></td>
        <td className="px-4 py-4"><div className="flex items-center justify-between gap-2"><span className="font-bold">{row.bank_account_name || "-"}</span><CopyIconButton value={row.bank_account_name} label="ชื่อผู้รับ" onCopy={copyField} /></div></td>
        <td className="px-4 py-4 text-right"><div className="flex items-center justify-end gap-2"><span className="font-black text-primary">{formatCurrency(row.transfer_amount)}</span><CopyIconButton value={row.transfer_amount != null ? String(row.transfer_amount) : undefined} label="ยอดโอน" onCopy={copyField} /></div></td>
        <td className="px-4 py-4"><p className="max-w-xs break-words">{row.title || "-"}</p></td>
        <td className="px-4 py-4"><p className="font-bold">{row.expense_type_name || "-"}</p></td>
        <td className="px-4 py-4">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusColor[row.status] || "bg-muted"}`}>{statusLabel[row.status] || row.status}</span>
          {row.installment_no && <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">งวด {row.installment_no}</span>}
          {row.installment_chain_status === "in_progress" && <p className="mt-1 text-xs font-bold text-orange-600">แบ่งจ่ายยังไม่ครบ</p>}
        </td>
        <td className="px-4 py-4" />
        <td className="px-4 py-4 text-right"><Link to={`/expense-requests/${row.id}`} state={{ from: "accounting" }} className="inline-flex h-10 items-center rounded-md bg-primary/10 px-6 text-xs font-black text-primary hover:bg-primary/20 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700">เปิดรายการ</Link></td>
      </tr>)}</tbody></table>
      {loading && <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {!loading && rows.length === 0 && <div className="flex flex-col items-center py-14 text-muted-foreground"><Building2 className="mb-3 h-9 w-9" /><p>ไม่มีรายการตามตัวกรอง</p></div>}
    </div></CardContent></Card>
    {!loading && total > 0 && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span>แสดง {displayedFrom.toLocaleString("th-TH")}–{displayedTo.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} รายการ</span>
        <span>· ต่อหน้า</span>
        <select aria-label="จำนวนรายการต่อหน้า" value={pageSize === 0 ? "all" : String(pageSize)} onChange={event => changePageSize(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-black text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
          <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="all">ทั้งหมด</option>
        </select>
        <span>· อัปเดตล่าสุด {formatDate(new Date().toISOString())}</span>
      </div>
      {pageSize !== 0 && <div className="flex items-center gap-2"><button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 font-bold disabled:opacity-40"><ChevronLeft className="h-4 w-4" />ก่อนหน้า</button><span className="px-2 font-bold">หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</span><button type="button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page >= totalPages} className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 font-bold disabled:opacity-40">ถัดไป<ChevronRight className="h-4 w-4" /></button></div>}
    </div>}
  </div>;
}
