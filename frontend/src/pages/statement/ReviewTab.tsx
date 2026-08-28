import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, FileSearch, Loader2,
  Search, Sparkles, Undo2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { matchesApi, reviewApi, type MatchCandidate, type ReviewData, type SummaryFilters, type Transaction } from "@/api/statement";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterPanel, FriendlyEmpty, ListPagination, StatementJourney } from "./StatementUx";

const STATUS_LABEL: Record<string, string> = { matched: "ตรวจเรียบร้อย", unmatched: "ต้องตรวจ", ignored: "ไม่นับ" };
const STATUS_CLASS: Record<string, string> = {
  matched: "bg-emerald-50 text-emerald-700",
  unmatched: "bg-amber-50 text-amber-700",
  ignored: "bg-slate-100 text-slate-600",
};

export function ReviewTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const summaryScope = searchParams.get("scope") === "summary";
  const requestedStatementId = Number(searchParams.get("statement_id")) || "";
  const scopedFilters = useMemo<SummaryFilters>(() => ({
    date_from: searchParams.get("date_from") || undefined,
    date_to: searchParams.get("date_to") || undefined,
    card_last4: searchParams.get("card_last4") || undefined,
    platform: (searchParams.get("platform") || undefined) as SummaryFilters["platform"],
    status: (searchParams.get("status") || undefined) as SummaryFilters["status"],
  }), [searchParams]);
  const scopeKey = [scopedFilters.date_from, scopedFilters.date_to, scopedFilters.card_last4, scopedFilters.platform, scopedFilters.status].join("|");
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<number | "">(requestedStatementId);
  const [issue, setIssue] = useState(searchParams.get("issue") ?? "");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [autoMatching, setAutoMatching] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await reviewApi.get({
        ...scopedFilters,
        statement_id: statementId === "" ? undefined : statementId,
        issue: issue || undefined,
        all_statements: summaryScope && statementId === "" ? true : undefined,
      });
      setData(result);
      if (!summaryScope && statementId === "" && result.selected_statement_id) setStatementId(result.selected_statement_id);
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดข้อมูลตรวจสอบไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  // scopeKey is the stable serialization of filters received from Summary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementId, issue, summaryScope, scopeKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setExpandedRows(new Set()); }, [statementId, issue, query]);

  const changeStatement = (value: string) => {
    const id = value ? Number(value) : "";
    setStatementId(id);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "review");
    if (id === "") next.delete("statement_id"); else next.set("statement_id", String(id));
    setSearchParams(next, { replace: true });
  };

  const changeIssue = (value: string) => {
    setIssue(value);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "review");
    if (value) next.set("issue", value); else next.delete("issue");
    setSearchParams(next, { replace: true });
  };

  const summaryUrl = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "summary");
    next.delete("issue");
    next.delete("scope");
    return `/statement?${next.toString()}`;
  }, [searchParams]);

  const handleMatchCandidate = async (transaction: Transaction, candidate: MatchCandidate) => {
    setBusyId(transaction.id);
    setError(null);
    try {
      await matchesApi.withReference({ transaction_ids: [transaction.id], reference_item_id: candidate.id });
      showToast("จับคู่รายการสำเร็จ");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "จับคู่ไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveMatch = async (transaction: Transaction) => {
    if (!transaction.match_group_id) return;
    setBusyId(transaction.id);
    setError(null);
    try {
      await matchesApi.remove(transaction.match_group_id);
      showToast("ยกเลิกการจับคู่แล้ว");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "ยกเลิกไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  };

  const handleAutoMatch = async () => {
    setAutoMatching(true);
    setError(null);
    try {
      const result = await matchesApi.auto(statementId === "" ? undefined : statementId);
      showToast(`ระบบช่วยจับคู่ได้ ${result.matched} รายการ`);
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "ระบบช่วยจับคู่ไม่สำเร็จ"));
    } finally {
      setAutoMatching(false);
    }
  };

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("th");
    if (!keyword) return data?.rows ?? [];
    return (data?.rows ?? []).filter((row) => [
      row.description, row.original_filename, row.card_last4, row.target_reference,
    ].some((value) => String(value ?? "").toLocaleLowerCase("th").includes(keyword)));
  }, [data, query]);

  const pageRows = pageSize === 0 ? filteredRows : filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const totals = data?.totals;

  const toggleExpanded = (id: number) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <StatementJourney active="review" />
      <PageHeader
        title="ตรวจยอดที่ต้องจัดการ"
        subtitle="เริ่มจากรายการสีเหลือง ระบบจะซ่อนรายละเอียดที่ยังไม่จำเป็นเพื่อให้ไล่ตรวจได้เร็วขึ้น"
        actions={
          <button type="button" onClick={handleAutoMatch} disabled={autoMatching}
            className="flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            {autoMatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            ให้ระบบช่วยจับคู่
          </button>
        }
      />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><p className="text-xs leading-5 text-rose-700">{error}</p></div>
          <button type="button" aria-label="ปิดข้อความ" onClick={() => setError(null)} className="text-rose-400">✕</button>
        </div>
      )}

      {summaryScope && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
          <span><b>กำลังดูตามตัวกรองจากหน้าสรุป</b> · รายการในหน้านี้ใช้ช่วงเวลา บัตร แพลตฟอร์ม และไฟล์ชุดเดียวกัน</span>
          <Link to={summaryUrl} className="font-semibold underline underline-offset-2">กลับไปเปลี่ยนตัวกรอง</Link>
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Metric label="รายการในไฟล์" value={String(totals.total)} helper="ทั้งหมด" />
          <Metric label="ตรวจเรียบร้อย" value={String(totals.matched)} tone="emerald" onClick={() => changeIssue("matched")} helper="ดูรายการ" />
          <Metric label="ควรตรวจต่อ" value={String(totals.unmatched)} tone="amber" onClick={() => changeIssue("unmatched")} helper="เริ่มจากตรงนี้" />
          <Metric label="อาจซ้ำ" value={String(totals.duplicates)} tone="rose" onClick={() => changeIssue("duplicates")} helper="ตรวจความซ้ำ" />
          <Metric label="ยอดชำระ/เงินคืน" value={formatCurrency(totals.deposits)} helper="ยอดรวม" />
        </div>
      )}

      <FilterPanel resultText={`พบ ${filteredRows.length} รายการ${pageSize === 0 ? " · แสดงทั้งหมด" : ` · แสดงครั้งละ ${pageSize} รายการ`}`}>
        <label className="min-w-[210px] flex-1 text-[11px] font-medium text-muted-foreground">
          เลือกไฟล์ Statement
          <select value={statementId} onChange={(event) => changeStatement(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">ทุกไฟล์</option>
            {data?.statements.map((statement) => <option key={statement.id} value={statement.id}>{statement.original_filename}</option>)}
          </select>
        </label>
        <label className="min-w-[150px] text-[11px] font-medium text-muted-foreground">
          สถานะ
          <select value={issue} onChange={(event) => changeIssue(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">ทุกสถานะ</option>
            <option value="unmatched">ต้องตรวจ</option>
            <option value="matched">ตรวจเรียบร้อย</option>
            <option value="duplicates">อาจเป็นรายการซ้ำ</option>
            <option value="missing-attachments">ยังไม่มีหลักฐาน</option>
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-[11px] font-medium text-muted-foreground">
          ค้นหาในรายการ
          <span className="mt-1.5 flex h-9 items-center gap-2 rounded-md border bg-background px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ชื่อรายการ เลขบัตร หรือชื่อไฟล์" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" />
          </span>
        </label>
        {(issue || query) && <button type="button" onClick={() => { changeIssue(""); setQuery(""); }} className="h-9 rounded-md px-3 text-xs font-medium text-sky-700 hover:bg-sky-50">ล้างตัวกรอง</button>}
      </FilterPanel>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : pageRows.length === 0 ? (
            <FriendlyEmpty title="ไม่พบรายการตามที่เลือก" description="ลองเปลี่ยนไฟล์ สถานะ หรือคำค้นหา" icon={<FileSearch className="h-5 w-5" />} />
          ) : (
            <div className="divide-y">
              {pageRows.map((row) => {
                const candidates = data?.candidates_by_tx[String(row.id)] ?? [];
                const expanded = expandedRows.has(row.id);
                return (
                  <article key={row.id} className={cn("transition-colors", expanded && "bg-muted/10")}>
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold">{row.description}</p>
                          {row.is_duplicate && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">อาจซ้ำ</span>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(row.transaction_date)} · {row.card_last4 ? `บัตร ••••${row.card_last4}` : "ไม่พบเลขบัตร"} · <span className="break-all">{row.original_filename}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                        <span className={cn("text-sm font-bold", row.amount < 0 ? "text-rose-600" : "text-slate-800")}>{formatCurrency(row.amount)}</span>
                        <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-medium", STATUS_CLASS[row.match_status] ?? "bg-muted")}>{STATUS_LABEL[row.match_status] ?? row.match_status}</span>
                        <button type="button" onClick={() => toggleExpanded(row.id)} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted">
                          {expanded ? "ย่อ" : row.match_status === "unmatched" ? `ดูตัวเลือก (${candidates.length})` : "ดูรายละเอียด"}
                          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {expanded && row.match_status === "matched" && (
                      <div className="mx-4 mb-4 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-xs text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
                        <span><b>จับคู่กับ:</b> {row.target_reference || "ไม่ระบุเลขอ้างอิง"} {row.ref_party_name ? `· ${row.ref_party_name}` : ""}</span>
                        <button type="button" disabled={busyId === row.id} onClick={() => handleRemoveMatch(row)} className="flex h-8 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 font-medium hover:bg-emerald-100 disabled:opacity-50"><Undo2 className="h-3 w-3" /> ยกเลิกการจับคู่</button>
                      </div>
                    )}

                    {expanded && row.match_status === "unmatched" && !row.is_duplicate && (
                      <div className="mx-4 mb-4 rounded-lg border bg-background p-3">
                        <p className="mb-2 text-xs font-semibold">หลักฐานที่ระบบคิดว่าอาจเป็นรายการเดียวกัน</p>
                        {candidates.length > 0 ? (
                          <div className="grid gap-2 lg:grid-cols-2">
                            {candidates.map((candidate) => (
                              <button key={candidate.id} type="button" disabled={busyId === row.id} onClick={() => handleMatchCandidate(row, candidate)} className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-left hover:bg-sky-100 disabled:opacity-50">
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">{candidate.match_score}%</span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold">{candidate.reference || "ไม่ระบุเลขอ้างอิง"}</span>
                                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{candidate.party_name || candidate.source_filename || "หลักฐานค่าโฆษณา"}</span>
                                  <span className="mt-1 block text-[10px] text-sky-700">{candidate.match_reason || "ยอดและข้อมูลใกล้เคียงกัน"}</span>
                                </span>
                                <span className="text-xs font-bold">{formatCurrency(candidate.amount)}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground">ยังไม่พบหลักฐานที่ใกล้เคียง ไปที่เมนู “จับคู่ด้วยตนเอง” เพื่อเลือกเองได้</p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <ListPagination page={page} pageSize={pageSize} total={filteredRows.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
        </CardContent>
      </Card>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>
          <p className="text-xs font-semibold text-slate-700">{toast}</p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label, value, helper, tone, onClick,
}: {
  label: string;
  value: string;
  helper: string;
  tone?: "emerald" | "amber" | "rose";
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold", tone === "emerald" && "text-emerald-600", tone === "amber" && "text-amber-600", tone === "rose" && "text-rose-600")}>{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{helper}</p>
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} className="rounded-xl border bg-card p-3 text-left transition hover:border-sky-200 hover:shadow-sm">{content}</button>;
  return <div className="rounded-xl border bg-card p-3">{content}</div>;
}
