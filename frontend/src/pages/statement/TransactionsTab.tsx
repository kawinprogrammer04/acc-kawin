import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CreditCard, Download, Eraser, FileText, Loader2, RefreshCcw } from "lucide-react";
import { DataListFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListPagination } from "@/components/data-list/DataListPagination";
import {
  dataListFilterControlClass,
  dataListTableHeaderCellClass,
  dataListTableScrollClass,
} from "@/components/data-list/styles";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { summaryApi, transactionsApi, type Transaction, type TransactionsData } from "@/api/statement";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FriendlyEmpty, StatementJourney } from "./StatementUx";

const STATUS_LABEL: Record<string, string> = { matched: "ตรวจเรียบร้อย", unmatched: "ต้องตรวจ", ignored: "ไม่นับ" };
const STATUS_CLASS: Record<string, string> = {
  matched: "bg-emerald-50 text-emerald-700",
  unmatched: "bg-amber-50 text-amber-700",
  ignored: "bg-slate-100 text-slate-600",
};
type TransactionView = "charges" | "payments";

function transactionAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const isParenthesizedNegative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return isParenthesizedNegative ? -Math.abs(parsed) : parsed;
}

function splitBySign(transactions: Transaction[]) {
  const charges: Transaction[] = [];
  const payments: Transaction[] = [];
  for (const transaction of transactions) (transactionAmount(transaction.amount) < 0 ? payments : charges).push(transaction);
  return { charges, payments };
}

export function TransactionsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatementId = searchParams.get("statement_id") ?? "";
  const activeView: TransactionView = searchParams.get("view") === "payments" ? "payments" : "charges";
  const [data, setData] = useState<TransactionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ statement_id: initialStatementId, status: "", card: searchParams.get("card") ?? "", q: "" });
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await transactionsApi.list({
        statement_id: filters.statement_id ? Number(filters.statement_id) : undefined,
        status: filters.status || undefined,
        card: filters.card || undefined,
        q: filters.q || undefined,
      }));
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดรายการไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, [filters.statement_id, filters.status, filters.card, filters.q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = query.trim();
      setFilters((current) => current.q === nextQuery ? current : { ...current, q: nextQuery });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const changeStatement = (value: string) => {
    setFilters((current) => ({ ...current, statement_id: value }));
    const next = new URLSearchParams(searchParams);
    next.set("tab", "transactions");
    if (value) next.set("statement_id", value); else next.delete("statement_id");
    setSearchParams(next, { replace: true });
  };

  const changeView = (value: TransactionView) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "transactions");
    next.set("view", value);
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    setQuery("");
    setFilters({ statement_id: "", status: "", card: "", q: "" });
    const next = new URLSearchParams(searchParams);
    next.set("tab", "transactions");
    next.delete("statement_id");
    next.delete("card");
    setSearchParams(next, { replace: true });
  };

  const doExport = async (fn: () => Promise<void>) => {
    setExporting(true);
    try {
      await fn();
    } catch (err) {
      setError(getApiErrorMessage(err, "ดาวน์โหลดรายงานไม่สำเร็จ"));
    } finally {
      setExporting(false);
    }
  };

  const { charges, payments } = useMemo(() => splitBySign(data?.transactions ?? []), [data]);
  const selectedFilename = data?.statements.find((statement) => String(statement.id) === filters.statement_id)?.original_filename;
  const activeRows = activeView === "charges" ? charges : payments;
  const activeLabel = activeView === "charges" ? "ยอดใช้จ่าย" : "ยอดชำระหรือเงินคืน";
  const chargesTotal = charges.reduce((sum, transaction) => sum + transactionAmount(transaction.amount), 0);
  const paymentsTotal = payments.reduce((sum, transaction) => sum + transactionAmount(transaction.amount), 0);
  const hasFilters = Boolean(filters.statement_id || filters.status || filters.card || query);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <StatementJourney active="review" />
      <PageHeader
        title={selectedFilename ? `รายการใน ${selectedFilename}` : "รายการจาก Statement ทั้งหมด"}
        subtitle="แยกยอดใช้จ่ายออกจากยอดชำระ/เงินคืน และแบ่งหน้าให้อ่านง่ายขึ้น"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={exporting} onClick={() => doExport(() => summaryApi.exportCsv("matched"))} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"><Download className="h-3.5 w-3.5" /> CSV ที่ตรวจแล้ว</button>
            <button type="button" disabled={exporting} onClick={() => doExport(() => summaryApi.exportExcel())} className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"><FileText className="h-3.5 w-3.5" /> รายงาน Excel</button>
          </div>
        }
      />

      {selectedFilename && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <span><b>กำลังดูเฉพาะไฟล์:</b> {selectedFilename}</span>
          <Link to="/statement?tab=upload" className="inline-flex items-center gap-1 font-medium hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> กลับไปเลือกไฟล์อื่น</Link>
        </div>
      )}

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><p className="text-xs text-rose-700">{error}</p></div>
          <button type="button" aria-label="ปิดข้อความ" onClick={() => setError(null)} className="text-rose-400">✕</button>
        </div>
      )}

      <form onSubmit={(event) => event.preventDefault()} className="space-y-5 rounded-2xl border bg-card/80 p-6 shadow-lg backdrop-blur-xl">
        <label className="block min-w-0 text-sm font-bold">ค้นหารายการ
          <input
            className={dataListFilterControlClass}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="รายละเอียด เลขอ้างอิง หรือชื่อไฟล์"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DataListFilterSelect
            label="ไฟล์ Statement"
            value={filters.statement_id}
            allLabel="ทุกไฟล์"
            options={(data?.statements ?? []).map((statement) => ({ value: String(statement.id), label: statement.original_filename }))}
            onChange={changeStatement}
          />
          <DataListFilterSelect
            label="สถานะ"
            value={filters.status}
            allLabel="ทุกสถานะ"
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            onChange={(status) => setFilters((current) => ({ ...current, status }))}
          />
          <DataListFilterSelect
            label="บัตร"
            value={filters.card}
            allLabel="ทุกบัตร"
            options={(data?.cards ?? []).map((card) => ({ value: card.last4, label: `${card.name} ••••${card.last4}` }))}
            onChange={(card) => setFilters((current) => ({ ...current, card }))}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <span className="text-xs font-bold text-muted-foreground">ตัวกรองทำงานอัตโนมัติ · พบ {activeRows.length.toLocaleString("th-TH")} รายการใน “{activeLabel}”</span>
          <button type="button" onClick={resetFilters} disabled={!hasFilters} className="inline-flex h-11 items-center gap-2 rounded-md border border-input bg-background px-8 text-sm font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-950/30"><Eraser className="h-4 w-4" />ล้างตัวกรอง</button>
        </div>
      </form>

      <Tabs value={activeView} onValueChange={(value) => changeView(value as TransactionView)}>
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold">เลือกแท็บรายการที่ต้องการดู</p>
            <p className="mt-0.5 text-xs text-muted-foreground">กดแท็บด้านล่างเพื่อสลับระหว่างยอดที่ตัดจากบัตรกับยอดที่ชำระเข้าหรือได้รับคืน</p>
          </div>
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-none bg-transparent p-0 text-left">
            <TabsTrigger value="charges" className="min-h-[88px] flex-col items-start gap-1.5 rounded-none border-b-4 border-transparent bg-transparent px-3 py-3 text-left sm:px-5 data-[state=active]:border-sky-600 data-[state=active]:bg-sky-50 data-[state=active]:text-sky-900 data-[state=active]:shadow-none">
              <span className="flex w-full flex-wrap items-center justify-between gap-1.5">
                <span className="inline-flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4" /> ยอดใช้จ่าย</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", activeView === "charges" ? "bg-sky-600 text-white" : "bg-muted text-muted-foreground")}>{activeView === "charges" ? "กำลังดูแท็บนี้" : "กดเพื่อดู"}</span>
              </span>
              <span className="text-xs text-muted-foreground">{charges.length.toLocaleString("th-TH")} รายการ · รวม {formatCurrency(chargesTotal)}</span>
            </TabsTrigger>
            <TabsTrigger value="payments" className="min-h-[88px] flex-col items-start gap-1.5 rounded-none border-b-4 border-transparent bg-transparent px-3 py-3 text-left sm:px-5 data-[state=active]:border-emerald-600 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-900 data-[state=active]:shadow-none">
              <span className="flex w-full flex-wrap items-center justify-between gap-1.5">
                <span className="inline-flex items-center gap-2 font-semibold"><RefreshCcw className="h-4 w-4" /> ยอดชำระหรือเงินคืน</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", activeView === "payments" ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground")}>{activeView === "payments" ? "กำลังดูแท็บนี้" : "กดเพื่อดู"}</span>
              </span>
              <span className="text-xs text-muted-foreground">{payments.length.toLocaleString("th-TH")} รายการ · รวม {formatCurrency(Math.abs(paymentsTotal))}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeView} className="mt-4">
          <TransactionTable
            title={activeLabel}
            hint={activeView === "charges" ? "รายการที่ตัดจากบัตร และควรมีหลักฐานค่าโฆษณามาเทียบ" : "เงินที่ชำระเข้าบัตร เงินคืน หรือ Cashback ซึ่งไม่ต้องเทียบกับหลักฐานค่าโฆษณา"}
            rows={activeRows}
            emptyText={`ไม่พบ${activeLabel}ตามเงื่อนไขนี้`}
            loading={loading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TransactionTable({ title, hint, rows, emptyText, loading }: { title: string; hint: string; rows: Transaction[]; emptyText: string; loading: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(1); }, [rows]);
  const total = rows.reduce((sum, transaction) => sum + transactionAmount(transaction.amount), 0);
  const pageRows = pageSize === 0 ? rows : rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div><p className="text-sm font-semibold">{title} <span className="text-xs font-normal text-muted-foreground">({rows.length.toLocaleString("th-TH")} รายการ)</span></p><p className="mt-0.5 text-xs text-muted-foreground">{hint}</p></div>
        </div>
        <div className={dataListTableScrollClass}>
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-xs font-black uppercase text-muted-foreground"><tr>{["วันที่", "บัตร", "รายละเอียด", "จำนวนเงิน", "ไฟล์ต้นทาง", "สถานะ"].map((heading, index) => <th key={heading} className={cn(dataListTableHeaderCellClass, "px-4 py-3", index === 3 ? "text-right" : "text-left")}>{heading}</th>)}</tr></thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={6}><div className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />กำลังโหลดรายการ</div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6}><FriendlyEmpty title={emptyText} description="ลองเปลี่ยนไฟล์ บัตร สถานะ หรือคำค้นหา" /></td></tr>
              ) : (
                <>
                  {pageRows.map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-muted/20">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(transaction.transaction_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{transaction.card_last4 ? `••••${transaction.card_last4}` : "-"}</td>
                      <td className="max-w-[320px] px-4 py-3"><p className="truncate font-medium">{transaction.description}</p>{transaction.is_duplicate && <p className="mt-0.5 text-[10px] text-rose-600">อาจเป็นรายการซ้ำ</p>}</td>
                      <td className={cn("whitespace-nowrap px-4 py-3 text-right font-semibold", transactionAmount(transaction.amount) < 0 ? "text-rose-600" : "text-slate-800")}>{formatCurrency(transactionAmount(transaction.amount))}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">{transaction.original_filename}</td>
                      <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_CLASS[transaction.match_status] ?? "bg-muted")}>{STATUS_LABEL[transaction.match_status] ?? transaction.match_status}</span></td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            {!loading && rows.length > 0 && <tfoot className="border-t-2 bg-muted/50">
              <tr>
                <td colSpan={3} className="px-4 py-4 text-right text-sm font-black">ยอดรวม {title}</td>
                <td className={cn("whitespace-nowrap px-4 py-4 text-right text-base font-black", total < 0 ? "text-rose-600" : "text-primary")}>{formatCurrency(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>}
          </table>
        </div>
        </CardContent>
      </Card>
      {!loading && <DataListPagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
    </div>
  );
}
