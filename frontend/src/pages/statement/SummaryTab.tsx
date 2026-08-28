import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, CheckCircle2, Download, FileSearch,
  FileText, Loader2, RotateCcw, SearchX, SlidersHorizontal, Wallet, WalletCards,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { DataListFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListKpiCard } from "@/components/data-list/DataListKpiCard";
import { PresetDateRangeFilter } from "@/components/data-list/PresetDateRangeFilter";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { summaryApi, type SummaryData, type SummaryFilters } from "@/api/statement";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FriendlyEmpty, StatementJourney } from "./StatementUx";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook/Meta", tiktok: "TikTok", google: "Google",
  payment: "ชำระบัตร/เงินคืน", other: "อื่น ๆ/ไม่ระบุ",
};

const STATUS_LABELS: Record<string, string> = {
  matched: "ตรวจเรียบร้อย", unmatched: "ต้องตรวจ", duplicates: "รายการซ้ำ",
  "missing-attachments": "ไม่มีหลักฐาน", ignored: "ไม่นำมาคำนวณ",
};

const FILTER_KEYS = ["date_from", "date_to", "card_last4", "platform", "status", "statement_id"] as const;

function filtersFromParams(params: URLSearchParams): SummaryFilters {
  const statementId = Number(params.get("statement_id"));
  return {
    date_from: params.get("date_from") || undefined,
    date_to: params.get("date_to") || undefined,
    card_last4: params.get("card_last4") || undefined,
    platform: (params.get("platform") || undefined) as SummaryFilters["platform"],
    status: (params.get("status") || undefined) as SummaryFilters["status"],
    statement_id: statementId > 0 ? statementId : undefined,
  };
}

function thaiMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, value - 1, 1)));
}

function shortDate(value?: string) {
  if (!value) return "ไม่จำกัด";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function SummaryTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const filterKey = FILTER_KEYS.map((key) => `${key}:${filters[key] ?? ""}`).join("|");
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await summaryApi.get(filters)); }
    catch (err) { setError(getApiErrorMessage(err, "โหลดสรุปผลไม่สำเร็จ")); }
    finally { setLoading(false); }
  // filterKey is the stable serialization of the URL-backed filters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => { load(); }, [load]);

  const updateFilters = (changes: Partial<Record<(typeof FILTER_KEYS)[number], string | number | undefined>>) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "summary");
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    setSearchParams({ tab: "summary" }, { replace: true });
  };

  const options = data?.filter_options;
  const totals = data?.totals;
  const hasFilters = FILTER_KEYS.some((key) => filters[key] !== undefined);
  const reviewedTotal = (totals?.matched ?? 0) + (totals?.unmatched ?? 0);
  const progress = reviewedTotal ? Math.round(((totals?.matched ?? 0) / reviewedTotal) * 100) : 0;

  const activeLabels = useMemo(() => {
    const labels: string[] = [];
    if (filters.date_from || filters.date_to) labels.push(`${shortDate(filters.date_from)}–${shortDate(filters.date_to)}`);
    if (filters.card_last4) {
      const card = options?.cards.find((item) => item.last4 === filters.card_last4);
      labels.push(`${card?.name ? `${card.name} ` : "บัตร "}••••${filters.card_last4}`);
    }
    if (filters.platform) labels.push(PLATFORM_LABELS[filters.platform] ?? filters.platform);
    if (filters.status) labels.push(STATUS_LABELS[filters.status] ?? filters.status);
    if (filters.statement_id) {
      const statement = options?.statements.find((item) => item.id === filters.statement_id);
      labels.push(statement?.original_filename ?? `ไฟล์ #${filters.statement_id}`);
    }
    return labels;
  }, [filters, options]);

  const reviewUrl = (issue: string) => {
    const params = new URLSearchParams({ tab: "review", issue, scope: "summary" });
    FILTER_KEYS.forEach((key) => {
      const value = filters[key];
      if (value !== undefined) params.set(key, String(value));
    });
    return `/statement?${params.toString()}`;
  };

  const doExport = async (fn: () => Promise<void>) => {
    setExporting(true); setError(null);
    try { await fn(); }
    catch (err) { setError(getApiErrorMessage(err, "ดาวน์โหลดรายงานไม่สำเร็จ")); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <StatementJourney active="summary" />
      <PageHeader
        title="สรุปผลการตรวจยอด"
        subtitle="ดูภาพรวมทั้งหมด หรือเลือกเฉพาะช่วงเวลา บัตร และข้อมูลที่ต้องการตรวจต่อ"
        actions={<div className="flex flex-wrap gap-2">
          <button type="button" disabled={exporting || loading || !totals?.unmatched} title={!totals?.unmatched ? "ไม่มีรายการที่ต้องตรวจตามตัวกรองนี้" : undefined} onClick={() => doExport(() => summaryApi.exportCsv("unmatched", filters))} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" /> รายการที่ต้องตรวจ (CSV)</button>
          <button type="button" disabled={exporting || loading || !totals?.transaction_count} onClick={() => doExport(() => summaryApi.exportExcel(filters))} className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} ดาวน์โหลดข้อมูลที่กำลังดู</button>
        </div>}
      />

      <Card className="overflow-hidden border-sky-100 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-sky-50/60 px-4 py-3">
            <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-sky-700 ring-1 ring-sky-100"><SlidersHorizontal className="h-4 w-4" /></span><div><p className="text-sm font-semibold">เลือกข้อมูลที่อยากดู</p><p className="text-[11px] text-muted-foreground">ตัวเลขและรายงานดาวน์โหลดจะเปลี่ยนตามที่เลือก</p></div></div>
            {hasFilters && <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-sky-700 hover:bg-white"><RotateCcw className="h-3.5 w-3.5" /> ล้างตัวกรองทั้งหมด</button>}
          </div>

          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-5">
            <PresetDateRangeFilter
              label="ช่วงเวลา"
              dateFrom={filters.date_from ?? ""}
              dateTo={filters.date_to ?? ""}
              onChange={(dateFrom, dateTo) => updateFilters({ date_from: dateFrom || undefined, date_to: dateTo || undefined })}
            />
            <DataListFilterSelect
              label="บัตร"
              value={filters.card_last4 ?? ""}
              allLabel="ทุกบัตร"
              options={(options?.cards ?? []).map((card) => ({ value: card.last4, label: `${card.name ? `${card.name} ` : "บัตร "}••••${card.last4} (${card.count})` }))}
              onChange={(value) => updateFilters({ card_last4: value || undefined })}
            />
            <DataListFilterSelect
              label="แพลตฟอร์ม"
              value={filters.platform ?? ""}
              allLabel="ทุกแพลตฟอร์ม"
              options={(options?.platforms ?? []).map((platform) => ({ value: platform.value, label: `${platform.label} (${platform.count})` }))}
              onChange={(value) => updateFilters({ platform: value || undefined })}
            />
            <DataListFilterSelect
              label="สถานะ"
              value={filters.status ?? ""}
              allLabel="ทุกสถานะ"
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => updateFilters({ status: value || undefined })}
            />
            <DataListFilterSelect
              label="ไฟล์ Statement"
              value={filters.statement_id ? String(filters.statement_id) : ""}
              allLabel="ทุกไฟล์"
              options={(options?.statements ?? []).map((statement) => ({ value: String(statement.id), label: `${statement.original_filename} (${statement.count})` }))}
              onChange={(value) => updateFilters({ statement_id: value ? Number(value) : undefined })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-xs"><span className="font-medium text-muted-foreground">กำลังดู:</span>{activeLabels.length ? activeLabels.map((label) => <span key={label} className="max-w-full truncate rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-800">{label}</span>) : <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">ข้อมูลทั้งหมด</span>}{loading && <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังคำนวณใหม่</span>}{!loading && totals && <span className="ml-auto text-muted-foreground">พบ {totals.transaction_count.toLocaleString("th-TH")} รายการ</span>}</div>
        </CardContent>
      </Card>

      {error && <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"><div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><div><p className="text-xs text-rose-700">{error}</p><button type="button" onClick={load} className="mt-1 text-xs font-medium text-rose-700 underline">ลองโหลดอีกครั้ง</button></div></div><button type="button" aria-label="ปิดข้อความ" onClick={() => setError(null)}><span className="text-rose-400">✕</span></button></div>}

      {!data && loading ? <SummarySkeleton /> : totals?.transaction_count === 0 && !loading ? <Card><FriendlyEmpty title="ไม่พบข้อมูลตามเงื่อนไขที่เลือก" description="ลองเปลี่ยนช่วงเวลา บัตร แพลตฟอร์ม หรือกลับไปดูข้อมูลทั้งหมด" icon={<SearchX className="h-5 w-5" />} action={<button type="button" onClick={resetFilters} className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700">ดูข้อมูลทั้งหมด</button>} /></Card> : <div className={cn("space-y-5 transition-opacity", loading && "pointer-events-none opacity-55")}>
        {totals && <Card className="overflow-hidden border-sky-200"><CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">ตรวจเรียบร้อยแล้ว {progress}%</p><span className="text-xs text-muted-foreground">{totals.matched} จาก {reviewedTotal} รายการ</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">ยังเหลือ {totals.unmatched} รายการที่ควรตรวจ และ {totals.missing_attachments} รายการที่ยังไม่มีหลักฐาน</p></div><Link to={reviewUrl("unmatched")} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-xs font-medium text-white hover:bg-sky-700"><FileSearch className="h-3.5 w-3.5" /> ไปตรวจรายการ <ArrowRight className="h-3.5 w-3.5" /></Link></CardContent></Card>}

        {totals && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DataListKpiCard label="รายการทั้งหมด" value={totals.transaction_count} tone="bg-sky-100 text-sky-700" icon={FileText} />
          <DataListKpiCard label="ยอดใช้จ่ายจากบัตร" value={totals.charges} currency tone="bg-violet-100 text-violet-700" icon={WalletCards} />
          <DataListKpiCard label="ยอดชำระ/เงินคืน" value={totals.refunds} currency tone="bg-emerald-100 text-emerald-700" icon={Wallet} />
          <DataListKpiCard label="ยอดสุทธิ" value={totals.net} currency tone="bg-slate-100 text-slate-700" icon={Wallet} />
          <DataListKpiCard label="ตรวจเรียบร้อย" value={totals.matched} tone="bg-emerald-100 text-emerald-700" icon={CheckCircle2} />
          <Link to={reviewUrl("unmatched")} aria-label="ดูรายการที่ต้องตรวจ" className="rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400"><DataListKpiCard label="ต้องตรวจ" value={totals.unmatched} tone="bg-amber-100 text-amber-700" icon={AlertCircle} /></Link>
          <Link to={reviewUrl("duplicates")} aria-label="ดูรายการซ้ำ" className="rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400"><DataListKpiCard label="รายการซ้ำ" value={totals.duplicates} tone="bg-rose-100 text-rose-700" icon={RotateCcw} /></Link>
          <Link to={reviewUrl("missing-attachments")} aria-label="ดูรายการที่ยังไม่มีเอกสาร" className="rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400"><DataListKpiCard label="ยังไม่มีเอกสาร" value={totals.missing_attachments} tone="bg-orange-100 text-orange-700" icon={FileSearch} /></Link>
        </div>}

        {data?.match_groups && <Card><CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> ยืนยันแล้ว <b>{data.match_groups.count}</b></span><span>รวมหลายรายการเป็นคู่เดียว <b>{data.match_groups.group_count}</b></span><Link to={reviewUrl("missing-attachments")} className="font-medium text-amber-700 hover:underline">ยังไม่มีหลักฐาน <b>{data.match_groups.no_attachment_count}</b> รายการ</Link></CardContent></Card>}

        <div className="grid gap-4 lg:grid-cols-2"><BreakdownCard title="ยอดแยกตามประเภท" description="ช่วยดูว่าค่าใช้จ่ายส่วนใหญ่อยู่ที่ประเภทใด" rows={(data?.categories ?? []).map((item) => ({ key: item.category, label: item.category, count: item.count, total: item.total }))} /><BreakdownCard title="ยอดแยกตามเดือน" description="เปรียบเทียบจำนวนรายการและยอดรวมในแต่ละเดือน" rows={(data?.months ?? []).map((item) => ({ key: item.month, label: thaiMonth(item.month), count: item.count, total: item.total }))} /></div>
      </div>}
    </div>
  );
}

function BreakdownCard({ title, description, rows }: { title: string; description: string; rows: { key: string; label: string; count: number; total: number }[] }) {
  return <Card><CardContent className="p-0"><div className="border-b px-4 py-3"><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><div className="divide-y">{rows.map((row) => <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 truncate">{row.label} <span className="text-xs text-muted-foreground">({row.count} รายการ)</span></span><span className={`shrink-0 font-semibold ${row.total < 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatCurrency(row.total)}</span></div>)}{rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</p>}</div></CardContent></Card>;
}

function SummarySkeleton() {
  return <div className="space-y-4" aria-label="กำลังโหลดข้อมูล"><div className="h-28 animate-pulse rounded-xl bg-muted" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div><div className="grid gap-4 lg:grid-cols-2"><div className="h-52 animate-pulse rounded-xl bg-muted" /><div className="h-52 animate-pulse rounded-xl bg-muted" /></div></div>;
}
