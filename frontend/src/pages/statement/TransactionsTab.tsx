import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CreditCard, Download, FileSearch, FileText, Loader2, RefreshCcw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { summaryApi, transactionsApi, type Transaction, type TransactionsData } from "@/api/statement";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterPanel, FriendlyEmpty, ListPagination, StatementJourney } from "./StatementUx";

const STATUS_LABEL: Record<string, string> = { matched: "ตรวจเรียบร้อย", unmatched: "ต้องตรวจ", ignored: "ไม่นับ" };
const STATUS_CLASS: Record<string, string> = {
  matched: "bg-emerald-50 text-emerald-700",
  unmatched: "bg-amber-50 text-amber-700",
  ignored: "bg-slate-100 text-slate-600",
};
type TransactionView = "charges" | "payments";

function splitBySign(transactions: Transaction[]) {
  const charges: Transaction[] = [];
  const payments: Transaction[] = [];
  for (const transaction of transactions) (transaction.amount < 0 ? payments : charges).push(transaction);
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
  const chargesTotal = charges.reduce((sum, transaction) => sum + transaction.amount, 0);
  const paymentsTotal = payments.reduce((sum, transaction) => sum + transaction.amount, 0);
  const hasFilters = Boolean(filters.status || filters.card || filters.q);

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

      <Tabs value={activeView} onValueChange={(value) => changeView(value as TransactionView)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-xl border bg-card p-2 shadow-sm">
          <TabsTrigger value="charges" className="min-h-[76px] flex-col items-stretch gap-1 rounded-lg border border-transparent px-4 py-3 text-left data-[state=active]:border-sky-200 data-[state=active]:bg-sky-50 data-[state=active]:text-sky-900 data-[state=active]:shadow-none">
            <span className="flex w-full items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4" /> ยอดใช้จ่าย</span>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold ring-1 ring-border">{charges.length.toLocaleString("th-TH")} รายการ</span>
            </span>
            <span className="w-full text-xs text-muted-foreground">ยอดรวม {formatCurrency(chargesTotal)}</span>
          </TabsTrigger>
          <TabsTrigger value="payments" className="min-h-[76px] flex-col items-stretch gap-1 rounded-lg border border-transparent px-4 py-3 text-left data-[state=active]:border-emerald-200 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-900 data-[state=active]:shadow-none">
            <span className="flex w-full items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-semibold"><RefreshCcw className="h-4 w-4" /> ยอดชำระหรือเงินคืน</span>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold ring-1 ring-border">{payments.length.toLocaleString("th-TH")} รายการ</span>
            </span>
            <span className="w-full text-xs text-muted-foreground">ยอดรวม {formatCurrency(Math.abs(paymentsTotal))}</span>
          </TabsTrigger>
        </TabsList>

        <FilterPanel resultText={`พบ ${activeRows.length} รายการใน “${activeLabel}” ตามเงื่อนไข`}>
        <label className="min-w-[200px] flex-1 text-[11px] font-medium text-muted-foreground">ไฟล์ Statement
          <select value={filters.statement_id} onChange={(event) => changeStatement(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">ทุกไฟล์</option>
            {data?.statements.map((statement) => <option key={statement.id} value={statement.id}>{statement.original_filename}</option>)}
          </select>
        </label>
        <label className="min-w-[135px] text-[11px] font-medium text-muted-foreground">สถานะ
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">ทุกสถานะ</option><option value="unmatched">ต้องตรวจ</option><option value="matched">ตรวจเรียบร้อย</option><option value="ignored">ไม่นับ</option>
          </select>
        </label>
        <label className="min-w-[140px] text-[11px] font-medium text-muted-foreground">บัตร
          <select value={filters.card} onChange={(event) => setFilters((current) => ({ ...current, card: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">ทุกบัตร</option>{data?.cards.map((card) => <option key={card.id} value={card.last4}>{card.name} ••••{card.last4}</option>)}
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-[11px] font-medium text-muted-foreground">ค้นหา
          <span className="mt-1.5 flex h-9 items-center gap-2 rounded-md border bg-background px-3"><Search className="h-3.5 w-3.5" /><input placeholder="รายละเอียดหรือเลขอ้างอิง" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" /></span>
        </label>
        {hasFilters && <button type="button" onClick={() => setFilters((current) => ({ ...current, status: "", card: "", q: "" }))} className="h-9 rounded-md px-3 text-xs font-medium text-sky-700 hover:bg-sky-50">ล้างตัวกรอง</button>}
        </FilterPanel>

        <TabsContent value={activeView} className="mt-4">
          {loading ? (
            <Card><CardContent className="flex h-48 items-center justify-center p-0"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
          ) : activeRows.length === 0 ? (
            <Card><CardContent className="p-0"><FriendlyEmpty title={`ไม่พบ${activeLabel}`} description="ลองเปลี่ยนไฟล์ บัตร สถานะ หรือคำค้นหา" icon={<FileSearch className="h-5 w-5" />} /></CardContent></Card>
          ) : (
            <TransactionTable
              key={activeView}
              title={activeLabel}
              hint={activeView === "charges" ? "รายการที่ตัดจากบัตร และควรมีหลักฐานค่าโฆษณามาเทียบ" : "เงินที่ชำระเข้าบัตร เงินคืน หรือ Cashback ซึ่งไม่ต้องเทียบกับหลักฐานค่าโฆษณา"}
              rows={activeRows}
              emptyText={`ไม่พบ${activeLabel}ตามเงื่อนไขนี้`}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TransactionTable({ title, hint, rows, emptyText }: { title: string; hint: string; rows: Transaction[]; emptyText: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(1); }, [rows]);
  const total = rows.reduce((sum, transaction) => sum + transaction.amount, 0);
  const pageRows = pageSize === 0 ? rows : rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div><p className="text-sm font-semibold">{title} <span className="text-xs font-normal text-muted-foreground">({rows.length} รายการ)</span></p><p className="mt-0.5 text-xs text-muted-foreground">{hint}</p></div>
          <span className={cn("font-semibold", total < 0 ? "text-rose-600" : "text-slate-800")}>{formatCurrency(total)}</span>
        </div>
        {rows.length === 0 ? (
          <FriendlyEmpty title={emptyText} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30"><tr>{["วันที่", "บัตร", "รายละเอียด", "จำนวนเงิน", "ไฟล์ต้นทาง", "สถานะ"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{heading}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {pageRows.map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-muted/20">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(transaction.transaction_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{transaction.card_last4 ? `••••${transaction.card_last4}` : "-"}</td>
                      <td className="max-w-[320px] px-4 py-3"><p className="truncate font-medium">{transaction.description}</p>{transaction.is_duplicate && <p className="mt-0.5 text-[10px] text-rose-600">อาจเป็นรายการซ้ำ</p>}</td>
                      <td className={cn("whitespace-nowrap px-4 py-3 text-right font-semibold", transaction.amount < 0 ? "text-rose-600" : "text-slate-800")}>{formatCurrency(transaction.amount)}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">{transaction.original_filename}</td>
                      <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_CLASS[transaction.match_status] ?? "bg-muted")}>{STATUS_LABEL[transaction.match_status] ?? transaction.match_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y md:hidden">
              {pageRows.map((transaction) => (
                <div key={transaction.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{transaction.description}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(transaction.transaction_date)} · {transaction.card_last4 ? `••••${transaction.card_last4}` : "ไม่พบเลขบัตร"}</p></div><span className={cn("whitespace-nowrap text-sm font-bold", transaction.amount < 0 ? "text-rose-600" : "text-slate-800")}>{formatCurrency(transaction.amount)}</span></div>
                  <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] text-muted-foreground">{transaction.original_filename}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_CLASS[transaction.match_status] ?? "bg-muted")}>{STATUS_LABEL[transaction.match_status] ?? transaction.match_status}</span></div>
                </div>
              ))}
            </div>
          </>
        )}
        <ListPagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
      </CardContent>
    </Card>
  );
}
