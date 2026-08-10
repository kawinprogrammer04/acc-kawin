import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileClock,
  FileImage,
  FileSpreadsheet,
  HelpCircle,
  Landmark,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import {
  bankReconciliationApi,
  type BankReconciliationAccount,
  type BankStatementImport,
  type BankStatementLine,
  type BankStatementLinesResponse,
} from "@/api/cashflow";
import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ReconcileTab = "suggested" | "waiting" | "completed";

const money = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const thaiDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function localDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  return thaiDate.format(new Date(`${value}T00:00:00`));
}

function accountStatus(account: BankReconciliationAccount) {
  if (account.total_count > 0 && account.progress === 100) {
    return { label: "ครบเรียบร้อย", dot: "bg-emerald-500", ring: "#10b981" };
  }
  if (account.progress > 0) {
    return { label: "กำลังดำเนินการ", dot: "bg-sky-500", ring: "#1e9bd7" };
  }
  return { label: "ยังไม่เริ่ม", dot: "bg-slate-300", ring: "#cbd5e1" };
}

function ProgressRing({ account }: { account: BankReconciliationAccount }) {
  const status = accountStatus(account);
  return (
    <div
      className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(${status.ring} ${account.progress * 3.6}deg, #eef2f6 0deg)`,
      }}
    >
      <div className="grid h-[46px] w-[46px] place-items-center rounded-full bg-white text-[11px] font-bold text-slate-700">
        {account.progress}%
      </div>
    </div>
  );
}

function AccountOverview({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: BankReconciliationAccount[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (!accounts.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <Landmark className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-600">ยังไม่มีบัญชีธนาคาร</p>
        <p className="mt-1 text-xs text-slate-400">เพิ่มบัญชีประเภทธนาคารในเมนูบัญชีเงินก่อนเริ่มกระทบยอด</p>
      </div>
    );
  }
  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {accounts.map((account) => {
        const status = accountStatus(account);
        const active = account.id === selectedId;
        return (
          <button
            key={account.id}
            type="button"
            onClick={() => onSelect(account.id)}
            className="text-left"
          >
            <Card
              className={cn(
                "h-full overflow-hidden border-slate-200 shadow-none transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md",
                active && "border-cyan-300 ring-1 ring-cyan-100"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <ProgressRing account={account} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="truncate text-sm font-semibold text-slate-800">{account.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {account.bank_name || "ธนาคาร"} · •• {account.account_number?.slice(-4) || "—"}
                        </p>
                      </div>
                      {active && (
                        <Badge className="border-0 bg-cyan-50 text-[10px] text-cyan-700 hover:bg-cyan-50">
                          กำลังดู
                        </Badge>
                      )}
                    </div>
                    <p className="mt-3 text-lg font-bold tracking-tight text-slate-800">
                      ฿{money.format(account.current_balance)}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", status.dot)} />
                      <span className="text-[11px] font-medium text-slate-600">{status.label}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      กระทบยอดแล้ว {account.reconciled_count} จาก {account.total_count} รายการ
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </section>
  );
}

function MatchTable({
  tab,
  rows,
  selected,
  loading,
  onSelect,
  onDismiss,
  onUnreconcile,
}: {
  tab: ReconcileTab;
  rows: BankStatementLine[];
  selected: Set<number>;
  loading: boolean;
  onSelect: (id: number) => void;
  onDismiss: (id: number) => void;
  onUnreconcile: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="grid min-h-[310px] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-600" />
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="grid min-h-[310px] place-items-center px-6 text-center">
        <div>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <p className="mt-4 font-semibold text-slate-700">
            {tab === "completed" ? "ยังไม่มีรายการที่กระทบยอดแล้ว" : "ไม่มีรายการในสถานะนี้"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {tab === "suggested"
              ? "นำเข้า Statement หรือสั่งจับคู่อัตโนมัติเพื่อค้นหาคู่รายการ"
              : tab === "waiting"
                ? "รายการ Statement ทั้งหมดมีคู่จับหรือกระทบยอดแล้ว"
                : "เมื่อยืนยันการกระทบยอด รายการจะแสดงที่นี่"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[950px] border-collapse text-left">
        <thead>
          <tr className="border-b bg-slate-50/80 text-[11px] font-medium text-slate-500">
            <th className="w-12 px-4 py-3"><span className="sr-only">เลือกรายการ</span></th>
            <th className="px-3 py-3">รายการเคลื่อนไหวธนาคาร</th>
            <th className="w-14 px-2 py-3 text-center">จับคู่</th>
            <th className="px-3 py-3">รายการที่บันทึกบัญชี</th>
            <th className="w-36 px-4 py-3 text-right">จำนวนเงิน</th>
            <th className="w-32 px-4 py-3 text-right">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const incoming = row.amount > 0;
            const accountingRows = row.cash_transactions?.length
              ? row.cash_transactions
              : (row.cash_transaction ? [row.cash_transaction] : []);
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-slate-100 transition-colors last:border-0 hover:bg-cyan-50/30",
                  selected.has(row.id) && "bg-cyan-50/60"
                )}
              >
                <td className="px-4 py-4 align-top">
                  {tab === "suggested" && (
                    <button
                      type="button"
                      onClick={() => onSelect(row.id)}
                      className={cn(
                        "grid h-4 w-4 place-items-center rounded border transition-colors",
                        selected.has(row.id)
                          ? "border-cyan-600 bg-cyan-600 text-white"
                          : "border-slate-300 bg-white hover:border-cyan-500"
                      )}
                      aria-label={`เลือก ${row.description}`}
                    >
                      {selected.has(row.id) && <Check className="h-3 w-3" />}
                    </button>
                  )}
                </td>
                <td className="px-3 py-4 align-top">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      incoming ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"
                    )}>
                      {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{row.description}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatDate(row.transaction_date)}
                        {row.transaction_time ? ` ${row.transaction_time.slice(0, 5)}` : ""}
                        {row.reference ? ` · ${row.reference}` : ""}
                        {row.channel ? ` · ${row.channel}` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-4 align-top">
                  <div className="flex items-center justify-center pt-1">
                    <div className={cn(
                      "grid h-7 w-7 place-items-center rounded-full",
                      accountingRows.length ? "bg-cyan-50 text-cyan-600" : "bg-amber-50 text-amber-500"
                    )}>
                      {accountingRows.length
                        ? <RefreshCcw className="h-3.5 w-3.5" />
                        : <AlertCircle className="h-3.5 w-3.5" />}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-4 align-top">
                  {accountingRows.length ? (
                    <div className="space-y-2">
                      {row.match_type === "group" && (
                        <Badge className="border-0 bg-violet-50 text-[10px] text-violet-700 hover:bg-violet-50">
                          จับคู่แบบกลุ่ม {accountingRows.length} รายการ
                        </Badge>
                      )}
                      {accountingRows.map((transaction) => (
                        <div key={transaction.id} className={cn(
                          accountingRows.length > 1 && "border-l-2 border-cyan-100 pl-2"
                        )}>
                          <p className="text-xs font-semibold text-slate-700">
                            {transaction.document_no || "รายการบัญชี"} · ฿{money.format(transaction.amount)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {transaction.description || "ไม่มีคำอธิบาย"} · {formatDate(transaction.transaction_date)}
                          </p>
                          <p className={cn(
                            "mt-0.5 text-[10px]",
                            transaction.document_count > 0 ? "text-emerald-600" : "text-amber-600"
                          )}>
                            {transaction.document_count > 0
                              ? `มีเอกสารหลักฐาน ${transaction.document_count} ไฟล์`
                              : "ยังไม่มีเอกสารหลักฐาน"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-amber-700">ยังไม่พบรายการบันทึกที่ตรงกัน</p>
                      <p className="mt-1 text-[11px] text-slate-400">บันทึกรายรับ/รายจ่ายแล้วกดจับคู่อัตโนมัติอีกครั้ง</p>
                    </>
                  )}
                </td>
                <td className="px-4 py-4 text-right align-top">
                  <p className={cn(
                    "text-sm font-bold tabular-nums",
                    incoming ? "text-emerald-600" : "text-slate-700"
                  )}>
                    {incoming ? "+" : "−"}฿{money.format(Math.abs(row.amount))}
                  </p>
                </td>
                <td className="px-4 py-4 text-right align-top">
                  {tab === "completed" ? (
                    <div>
                      <Badge className="border-0 bg-emerald-50 text-[10px] text-emerald-700 hover:bg-emerald-50">
                        กระทบยอดแล้ว
                      </Badge>
                      <button
                        type="button"
                        onClick={() => onUnreconcile(row.id)}
                        className="mt-2 block w-full text-[10px] text-rose-500 hover:text-rose-700"
                      >
                        ยกเลิกกระทบยอด
                      </button>
                    </div>
                  ) : tab === "suggested" ? (
                    <div>
                      <Badge className="border-0 bg-cyan-50 text-[10px] text-cyan-700 hover:bg-cyan-50">
                        จับคู่ {row.suggested_score || 0}%
                      </Badge>
                      <button
                        type="button"
                        onClick={() => onDismiss(row.id)}
                        className="mt-2 flex w-full items-center justify-end gap-0.5 text-[10px] text-slate-400 hover:text-slate-600"
                      >
                        นำออก <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <Badge className="border-0 bg-amber-50 text-[10px] text-amber-700 hover:bg-amber-50">
                      รอตรวจสอบ
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BankReconciliationPage() {
  const today = useMemo(() => new Date(), []);
  const [accounts, setAccounts] = useState<BankReconciliationAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [tab, setTab] = useState<ReconcileTab>("suggested");
  const [startDate, setStartDate] = useState(localDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [endDate, setEndDate] = useState(localDateInput(today));
  const [search, setSearch] = useState("");
  const [data, setData] = useState<BankStatementLinesResponse>({
    items: [],
    total: 0,
    counts: { suggested: 0, waiting: 0, completed: 0 },
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingLines, setLoadingLines] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [imports, setImports] = useState<BankStatementImport[]>([]);
  const [loadingImports, setLoadingImports] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || null;

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  };

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const result = await bankReconciliationApi.accounts();
      setAccounts(result);
      setSelectedAccountId((current) =>
        current && result.some((account) => account.id === current)
          ? current
          : result[0]?.id ?? null
      );
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "โหลดบัญชีธนาคารไม่สำเร็จ"));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadLines = useCallback(async () => {
    if (!selectedAccountId) {
      setData({ items: [], total: 0, counts: { suggested: 0, waiting: 0, completed: 0 } });
      return;
    }
    setLoadingLines(true);
    setError(null);
    try {
      const result = await bankReconciliationApi.lines({
        wallet_account_id: selectedAccountId,
        status: tab,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        search: search.trim() || undefined,
        limit: 100,
      });
      setData(result);
      setSelected(new Set());
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "โหลดรายการกระทบยอดไม่สำเร็จ"));
    } finally {
      setLoadingLines(false);
    }
  }, [selectedAccountId, tab, startDate, endDate, search]);

  const loadImports = useCallback(async () => {
    if (!selectedAccountId) {
      setImports([]);
      return;
    }
    setLoadingImports(true);
    try {
      setImports(await bankReconciliationApi.imports(selectedAccountId, true));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "โหลดประวัติ Statement ไม่สำเร็จ"));
    } finally {
      setLoadingImports(false);
    }
  }, [selectedAccountId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadLines(); }, [loadLines]);

  const toggleSelection = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = data.items.length > 0 && data.items.every((row) => selected.has(row.id));
  const selectAll = () => {
    setSelected(allSelected ? new Set() : new Set(data.items.map((row) => row.id)));
  };

  const selectedAmount = data.items
    .filter((row) => selected.has(row.id))
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);

  const importStatement = async () => {
    if (!selectedAccountId || !importFile) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await bankReconciliationApi.importStatement(selectedAccountId, importFile);
      setShowImport(false);
      setImportFile(null);
      showToast(
        `นำเข้า ${result.imported_count} รายการ — พบคู่แนะนำ ${result.suggested_count} รายการ`
      );
      await Promise.all([loadAccounts(), loadLines(), loadImports()]);
      setTab("suggested");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "นำเข้า Statement ไม่สำเร็จ"));
    } finally {
      setActionLoading(false);
    }
  };

  const downloadImport = async (item: BankStatementImport) => {
    try {
      const blob = await bankReconciliationApi.downloadImport(item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.original_filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "ดาวน์โหลดไฟล์ต้นฉบับไม่สำเร็จ"));
    }
  };

  const archiveImport = async (item: BankStatementImport) => {
    if (!window.confirm(`เก็บ “${item.original_filename}” เข้าคลังใช่หรือไม่`)) return;
    try {
      await bankReconciliationApi.archiveImport(item.id);
      showToast("เก็บ Statement เข้าคลังแล้ว");
      await loadImports();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "เก็บ Statement เข้าคลังไม่สำเร็จ"));
    }
  };

  const restoreImport = async (item: BankStatementImport) => {
    try {
      await bankReconciliationApi.restoreImport(item.id);
      showToast("นำ Statement ออกจากคลังแล้ว");
      await loadImports();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "นำ Statement ออกจากคลังไม่สำเร็จ"));
    }
  };

  const deleteImport = async (item: BankStatementImport) => {
    if (!window.confirm(
      `ลบ “${item.original_filename}” และรายการที่นำเข้าถาวรใช่หรือไม่ การลบนี้ย้อนกลับไม่ได้`
    )) return;
    try {
      await bankReconciliationApi.deleteImport(item.id);
      showToast("ลบ Statement ที่ยังไม่เคยกระทบยอดแล้ว");
      await Promise.all([loadImports(), loadAccounts(), loadLines()]);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "ลบ Statement ไม่สำเร็จ"));
    }
  };

  const autoMatch = async () => {
    if (!selectedAccountId) return;
    setActionLoading(true);
    try {
      const result = await bankReconciliationApi.autoMatch(selectedAccountId);
      showToast(`ระบบพบคู่รายการ ${result.suggested_count} รายการ`);
      setTab("suggested");
      await loadLines();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "จับคู่อัตโนมัติไม่สำเร็จ"));
    } finally {
      setActionLoading(false);
    }
  };

  const confirmReconcile = async () => {
    const items = data.items
      .filter((row) => selected.has(row.id) && (row.cash_transactions?.length || row.cash_transaction))
      .map((row) => ({
        statement_line_id: row.id,
        cash_transaction_ids: row.cash_transactions?.length
          ? row.cash_transactions.map((transaction) => transaction.id)
          : (row.cash_transaction ? [row.cash_transaction.id] : []),
      }));
    if (!items.length) return;
    setActionLoading(true);
    try {
      const result = await bankReconciliationApi.reconcile(items);
      showToast(`กระทบยอดสำเร็จ ${result.reconciled_count} รายการ`);
      await Promise.all([loadAccounts(), loadLines()]);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "กระทบยอดไม่สำเร็จ"));
    } finally {
      setActionLoading(false);
    }
  };

  const dismiss = async (lineId: number) => {
    try {
      await bankReconciliationApi.dismiss(lineId);
      showToast("นำคู่แนะนำออกแล้ว");
      await loadLines();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "นำคู่รายการออกไม่สำเร็จ"));
    }
  };

  const unreconcile = async (lineId: number) => {
    const reason = window.prompt("เหตุผลที่ยกเลิกการกระทบยอด", "แก้ไขรายการบัญชี");
    if (reason === null) return;
    setActionLoading(true);
    try {
      await bankReconciliationApi.unreconcile(lineId, reason || "แก้ไขรายการบัญชี");
      showToast("ยกเลิกการกระทบยอดแล้ว สามารถแก้ไขรายการบัญชีได้");
      await Promise.all([loadAccounts(), loadLines()]);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "ยกเลิกการกระทบยอดไม่สำเร็จ"));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#f5f7f9] text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
              <span>การเงิน</span><span>/</span><span>เงินสด / ธนาคาร / e-Wallet</span>
              <span>/</span><span className="text-cyan-700">กระทบยอดธนาคาร</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <RefreshCcw className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-800">กระทบยอดธนาคาร</h1>
                <p className="mt-0.5 text-xs text-slate-400">
                  ตรวจสอบยอดธนาคารกับรายการบันทึกบัญชีและเก็บประวัติอย่างปลอดภัย
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!selectedAccountId}
              onClick={() => {
                setShowHistory(true);
                void loadImports();
              }}
              className="h-9 border-slate-200 text-slate-600"
            >
              <FileClock className="h-4 w-4" /> ประวัติ Statement
            </Button>
            <Button variant="outline" className="h-9 border-slate-200 text-slate-600">
              <HelpCircle className="h-4 w-4" /> วิธีใช้งาน
            </Button>
            <Button
              onClick={() => {
                setError(null);
                setImportFile(null);
                setShowImport(true);
              }}
              disabled={!selectedAccountId}
              className="h-9 bg-[#087c8c] shadow-sm hover:bg-[#066b79]"
            >
              <UploadCloud className="h-4 w-4" /> นำเข้า Statement
            </Button>
          </div>
        </div>
      </header>

      <main className="space-y-5 p-6">
        {error && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <p className="whitespace-pre-line text-xs text-rose-700">{error}</p>
            </div>
            <button type="button" onClick={() => setError(null)} aria-label="ปิดข้อความ">
              <X className="h-4 w-4 text-rose-400" />
            </button>
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-cyan-100 bg-gradient-to-r from-[#073b4c] via-[#07596a] to-[#087c8c] text-white shadow-sm">
          <div className="relative flex flex-wrap items-center justify-between gap-6 px-6 py-5">
            <div className="absolute -right-8 -top-16 h-48 w-48 rounded-full border-[32px] border-white/5" />
            <div className="relative flex items-center gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <Sparkles className="h-6 w-6 text-cyan-200" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">จับคู่รายการอัตโนมัติ</p>
                  <Badge className="border-0 bg-cyan-300/20 text-[10px] text-cyan-100 hover:bg-cyan-300/20">
                    ข้อมูลจริง
                  </Badge>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-cyan-50/75">
                  ระบบเทียบยอดเงิน ทิศทาง วันที่ และคำอธิบายกับรายการบัญชีของบริษัท
                  ก่อนเสนอคู่ที่มีความมั่นใจสูงให้ตรวจสอบ
                </p>
              </div>
            </div>
            <div className="relative flex items-center gap-5">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/60">คู่รายการรอยืนยัน</p>
                <p className="mt-1 text-xl font-bold">{data.counts.suggested} รายการ</p>
              </div>
              <Button
                onClick={autoMatch}
                disabled={!selectedAccountId || actionLoading}
                className="bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 text-amber-300" />}
                จับคู่อีกครั้ง
              </Button>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold text-slate-800">สถานะช่องทางการเงิน</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              สรุปการกระทบยอดรายการเคลื่อนไหวของเดือนที่ผ่านมา
            </p>
          </div>
          {loadingAccounts ? (
            <div className="grid h-32 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-600" /></div>
          ) : (
            <AccountOverview
              accounts={accounts}
              selectedId={selectedAccountId}
              onSelect={(id) => {
                setSelectedAccountId(id);
                setSelected(new Set());
              }}
            />
          )}
        </section>

        {selectedAccount && (
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Landmark className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800">{selectedAccount.name}</p>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedAccount.bank_name || "ธนาคาร"} · •• {selectedAccount.account_number?.slice(-4) || "—"}
                    {selectedAccount.last_import_at
                      ? ` · นำเข้าล่าสุด ${new Date(selectedAccount.last_import_at).toLocaleString("th-TH")}`
                      : " · ยังไม่เคยนำเข้า Statement"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="w-[112px] bg-transparent outline-none"
                    aria-label="วันที่เริ่มต้น"
                  />
                  <span>–</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="w-[112px] bg-transparent outline-none"
                    aria-label="วันที่สิ้นสุด"
                  />
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="ค้นหารายการ"
                    className="h-8 w-44 rounded-lg border border-slate-200 pl-8 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                    placeholder="ค้นหารายการ..."
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4">
              <div className="flex items-center">
                {[
                  { id: "suggested" as const, label: "รอยืนยัน", count: data.counts.suggested },
                  { id: "waiting" as const, label: "รอกระทบยอด", count: data.counts.waiting },
                  { id: "completed" as const, label: "กระทบยอดแล้ว", count: data.counts.completed },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "relative flex h-12 items-center gap-2 px-4 text-xs font-medium transition-colors",
                      tab === item.id ? "text-cyan-700" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    {item.label}
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px]",
                      tab === item.id ? "bg-cyan-50 text-cyan-700" : "bg-slate-100 text-slate-500"
                    )}>
                      {item.count}
                    </span>
                    {tab === item.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-cyan-600" />}
                  </button>
                ))}
              </div>
              {tab === "suggested" && (
                <button
                  type="button"
                  onClick={selectAll}
                  className="flex items-center gap-2 px-2 text-xs font-medium text-cyan-700 hover:text-cyan-800"
                >
                  <span className={cn(
                    "grid h-4 w-4 place-items-center rounded border",
                    allSelected ? "border-cyan-600 bg-cyan-600 text-white" : "border-slate-300 bg-white"
                  )}>
                    {allSelected && <Check className="h-3 w-3" />}
                  </span>
                  เลือกทุกรายการในหน้านี้
                </button>
              )}
            </div>

            <MatchTable
              tab={tab}
              rows={data.items}
              selected={selected}
              loading={loadingLines}
              onSelect={toggleSelection}
              onDismiss={dismiss}
              onUnreconcile={unreconcile}
            />

            {tab === "suggested" && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-cyan-50 text-cyan-700">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">เลือกแล้ว {selected.size} รายการ</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">ยืนยันแล้วรายการบัญชีจะถูกล็อกจนกว่าจะยกเลิกกระทบยอด</p>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">ยอดรวมรายการที่เลือก</p>
                    <p className="mt-0.5 text-base font-bold tabular-nums text-slate-800">฿{money.format(selectedAmount)}</p>
                  </div>
                  <Button
                    disabled={!selected.size || actionLoading}
                    onClick={confirmReconcile}
                    className="bg-[#087c8c] px-5 hover:bg-[#066b79]"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    กระทบยอด {selected.size || ""}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-semibold text-amber-800">รายการที่กระทบยอดแล้วจะถูกป้องกันการแก้ไข</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-700/80">
              หากต้องการแก้ไขจำนวนเงิน วันที่ หรือยกเลิกรายการ กรุณายกเลิกการกระทบยอดก่อน
              ระบบจะเก็บผู้ทำรายการ เวลา และเหตุผลไว้ใน Activity Log
            </p>
          </div>
        </div>
      </main>

      <Dialog open={showImport} onOpenChange={(open) => !actionLoading && setShowImport(open)}>
        <DialogContent className="max-w-xl overflow-hidden p-0">
          <DialogHeader className="border-b bg-slate-50/70 px-6 py-5">
            <DialogTitle className="flex items-center gap-3 text-base text-slate-800">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <UploadCloud className="h-4 w-4" />
              </span>
              นำเข้ารายการเคลื่อนไหวธนาคาร
            </DialogTitle>
            <DialogDescription className="pl-12 text-xs">
              {selectedAccount?.name} · •• {selectedAccount?.account_number?.slice(-4) || "—"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div className="flex items-start gap-3 rounded-xl border-2 border-cyan-500 bg-cyan-50/50 p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-100 text-cyan-700">
                <Sparkles className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-xs font-bold text-slate-800">กระทบยอดด้วยระบบอัตโนมัติ</span>
                <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                  ระบบจะบันทึกรายการ กันข้อมูลซ้ำ และค้นหาคู่จากข้อมูลบัญชีจริง
                </span>
              </span>
            </div>

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xlsm,.csv,.pdf,.png,.jpg,.jpeg"
              onChange={(event) => setImportFile(event.target.files?.[0] || null)}
            />

            {!importFile ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setImportFile(event.dataTransfer.files?.[0] || null);
                }}
                className="grid w-full place-items-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-6 py-9 text-center transition-colors hover:border-cyan-400 hover:bg-cyan-50/30"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-cyan-600 shadow-sm">
                  <UploadCloud className="h-5 w-5" />
                </span>
                <span className="mt-3 text-xs font-semibold text-slate-700">ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</span>
                <span className="mt-1 text-[10px] text-slate-400">
                  รองรับ PDF, PDF สแกน, รูปภาพ, Excel และ CSV ขนาดไม่เกิน 25 MB
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-600 shadow-sm">
                  <FileSpreadsheet className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-700">{importFile.name}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {(importFile.size / 1024).toFixed(1)} KB · พร้อมตรวจสอบและนำเข้า
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportFile(null)}
                  className="rounded-full p-1 text-slate-400 hover:bg-white hover:text-slate-600"
                  aria-label="นำไฟล์ออก"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
              <p className="text-[10px] leading-4 text-blue-700">
                ระบบเก็บไฟล์ต้นฉบับพร้อม SHA-256 ไฟล์สแกนจะอ่านด้วย OCR
                และจะกระทบยอดเมื่อคุณตรวจสอบและกดยืนยันเท่านั้น
              </p>
            </div>
          </div>

          <DialogFooter className="border-t bg-slate-50/70 px-6 py-4">
            <Button variant="outline" disabled={actionLoading} onClick={() => setShowImport(false)} className="border-slate-200">
              ยกเลิก
            </Button>
            <Button
              disabled={!importFile || actionLoading}
              onClick={importStatement}
              className="bg-[#087c8c] hover:bg-[#066b79]"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              นำเข้าและตรวจสอบ <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b bg-slate-50/70 px-6 py-5">
            <DialogTitle className="flex items-center gap-3 text-base text-slate-800">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <FileClock className="h-4 w-4" />
              </span>
              ประวัติและไฟล์ต้นฉบับ Statement
            </DialogTitle>
            <DialogDescription className="pl-12 text-xs">
              เก็บผู้ส่งไฟล์ เวลา วิธีอ่าน และรหัส SHA-256 เพื่อใช้เป็นหลักฐานตรวจสอบ
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-auto">
            {loadingImports ? (
              <div className="grid h-52 place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
              </div>
            ) : !imports.length ? (
              <div className="grid h-52 place-items-center text-center">
                <div>
                  <FileClock className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-600">ยังไม่มีประวัติ Statement</p>
                </div>
              </div>
            ) : (
              <table className="w-full min-w-[820px] text-left">
                <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    <th className="px-5 py-3">ไฟล์ต้นฉบับ</th>
                    <th className="px-3 py-3">แหล่งข้อมูล</th>
                    <th className="px-3 py-3">ผลการอ่าน</th>
                    <th className="px-3 py-3">หลักฐานตรวจสอบ</th>
                    <th className="px-5 py-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500">
                            {item.source_type === "manual_image"
                              ? <FileImage className="h-4 w-4" />
                              : <FileSpreadsheet className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-[230px] truncate text-xs font-semibold text-slate-700">
                              {item.original_filename}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-400">
                              {(item.file_size / 1024).toFixed(1)} KB · {new Date(item.created_at).toLocaleString("th-TH")}
                            </p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            โดย {item.uploaded_by_name || "ผู้ใช้งาน"}
                          </p>
                          {item.archived_at && (
                            <Badge className="mt-2 border-0 bg-slate-100 text-[10px] text-slate-600">
                              อยู่ในคลัง
                            </Badge>
                          )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <Badge className={cn(
                          "border-0 text-[10px]",
                          item.trust_level === "bank_verified"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.trust_level === "editable_file"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-blue-50 text-blue-700"
                        )}>
                          {item.trust_level === "bank_verified"
                            ? "ยืนยันจากธนาคาร"
                            : item.trust_level === "editable_file"
                              ? "ไฟล์แก้ไขได้"
                              : item.trust_level === "uploaded_image"
                                ? "รูปภาพอัปโหลด"
                                : "PDF อัปโหลด"}
                        </Badge>
                        <p className="mt-2 text-[10px] text-slate-400">
                          {item.processing_method === "ocr"
                            ? "อ่านด้วย OCR"
                            : item.processing_method === "pdf_text"
                              ? "อ่านข้อความจาก PDF"
                              : item.processing_method || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <Badge className={cn(
                          "border-0 text-[10px]",
                          item.status === "processed"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.status === "failed"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-blue-50 text-blue-700"
                        )}>
                          {item.status === "processed"
                            ? `สำเร็จ ${item.imported_count} รายการ`
                            : item.status === "failed" ? "อ่านไม่สำเร็จ" : "กำลังประมวลผล"}
                        </Badge>
                        {item.parse_message && (
                          <p className="mt-2 max-w-[220px] text-[10px] leading-4 text-slate-500">
                            {item.parse_message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-mono text-[9px] text-slate-500" title={item.file_sha256}>
                          SHA-256<br />{item.file_sha256.slice(0, 16)}…
                        </p>
                        <p className="mt-2 text-[10px] text-slate-400">
                          ซ้ำ {item.duplicate_count} รายการ
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void downloadImport(item)}
                            title="ดาวน์โหลดไฟล์ต้นฉบับ"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {item.archived_at ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void restoreImport(item)}
                              title="นำออกจากคลัง"
                            >
                              <RefreshCcw className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void archiveImport(item)}
                              title="เก็บเข้าคลัง"
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!item.can_delete}
                            onClick={() => void deleteImport(item)}
                            title={item.can_delete
                              ? "ลบถาวร"
                              : "มีประวัติกระทบยอดแล้ว จึงลบถาวรไม่ได้"}
                            className="text-rose-500 hover:text-rose-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter className="border-t bg-slate-50/70 px-6 py-4">
            <p className="mr-auto text-[10px] text-slate-500">
              ไฟล์ที่เคยกระทบยอดแล้วเก็บเข้าคลังได้ แต่ลบถาวรไม่ได้
            </p>
            <Button variant="outline" onClick={() => setShowHistory(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-700">{toast}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">บันทึกข้อมูลลงระบบเรียบร้อยแล้ว</p>
          </div>
        </div>
      )}
    </div>
  );
}
