import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeftRight, CheckCircle2, Link2, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { manualEditApi, matchesApi, type ManualEditData } from "@/api/statement";
import { formatCurrency, formatDate } from "@/lib/format";

export function ManualEditTab() {
  const [data, setData] = useState<ManualEditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<Set<number>>(new Set());
  const [selectedRef, setSelectedRef] = useState<number | null>(null);
  const [manualReference, setManualReference] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [transactionQuery, setTransactionQuery] = useState("");
  const [referenceQuery, setReferenceQuery] = useState("");

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await manualEditApi.get());
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดข้อมูลไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedTxTotal = useMemo(
    () => (data?.transactions ?? []).filter((tx) => selectedTx.has(tx.id)).reduce((sum, tx) => sum + tx.amount, 0),
    [data, selectedTx]
  );

  const toggleTx = (id: number) => {
    setSelectedTx((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedReference = data?.reference_items.find((r) => r.id === selectedRef) ?? null;
  const filteredTransactions = useMemo(() => {
    const keyword = transactionQuery.trim().toLocaleLowerCase("th");
    if (!keyword) return data?.transactions ?? [];
    return (data?.transactions ?? []).filter((transaction) => [transaction.description, transaction.card_last4, transaction.original_filename]
      .some((value) => String(value ?? "").toLocaleLowerCase("th").includes(keyword)));
  }, [data, transactionQuery]);
  const filteredReferences = useMemo(() => {
    const keyword = referenceQuery.trim().toLocaleLowerCase("th");
    if (!keyword) return data?.reference_items ?? [];
    return (data?.reference_items ?? []).filter((reference) => [reference.reference, reference.party_name, reference.source_filename]
      .some((value) => String(value ?? "").toLocaleLowerCase("th").includes(keyword)));
  }, [data, referenceQuery]);
  const expectedAmount = selectedReference?.amount ?? (manualAmount ? Number(manualAmount) : 0);
  const difference = selectedTxTotal - expectedAmount;

  const canSubmit = selectedTx.size > 0 && (selectedReference || (manualReference.trim() && manualAmount.trim()));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const transaction_ids = Array.from(selectedTx);
      if (selectedReference) {
        await matchesApi.withReference({ transaction_ids, reference_item_id: selectedReference.id, notes });
      } else {
        await matchesApi.manual({
          transaction_ids,
          target_reference: manualReference.trim(),
          expected_amount: Number(manualAmount),
          notes,
        });
      }
      showToast("จับคู่รายการสำเร็จ");
      setSelectedTx(new Set());
      setSelectedRef(null);
      setManualReference("");
      setManualAmount("");
      setNotes("");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "จับคู่ไม่สำเร็จ"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="จับคู่ด้วยตนเอง" subtitle="ใช้เมื่อระบบยังหาคู่ให้ไม่ได้: เลือกรายการจากบัตร แล้วเลือกหลักฐานที่เป็นรายการเดียวกัน" />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><p className="text-xs text-rose-700">{error}</p></div>
          <button onClick={() => setError(null)}><span className="text-rose-400">✕</span></button>
        </div>
      )}

      {data && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3 text-xs"><span>ค้างตรวจ <b className="text-amber-700">{data.warning_stats.unmatched}</b> รายการ · อาจซ้ำ <b className="text-rose-700">{data.warning_stats.duplicates}</b> รายการ</span><span className="text-muted-foreground">ทำตามลำดับ 1 → 2 → 3</span></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-0">
            <div className="space-y-3 border-b px-4 py-3">
              <div><p className="text-sm font-semibold"><span className="mr-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">1</span>เลือกรายการจากบัตร</p><p className="mt-1 text-xs text-muted-foreground">เลือกได้มากกว่า 1 รายการ · เลือกแล้ว {selectedTx.size} รายการ รวม {formatCurrency(selectedTxTotal)}</p></div>
              <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3"><Search className="h-3.5 w-3.5 text-muted-foreground" /><input value={transactionQuery} onChange={(event) => setTransactionQuery(event.target.value)} placeholder="ค้นหารายการ เลขบัตร หรือชื่อไฟล์" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
            </div>
            <div className="max-h-[460px] divide-y overflow-auto">
              {filteredTransactions.map((tx) => (
                <label key={tx.id} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm hover:bg-muted/20">
                  <input type="checkbox" className="mt-1" checked={selectedTx.has(tx.id)} onChange={() => toggleTx(tx.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(tx.transaction_date)} · {tx.card_last4 ? `••••${tx.card_last4}` : "ไม่ระบุบัตร"}</p>
                  </div>
                  <span className={`font-semibold ${tx.amount < 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatCurrency(tx.amount)}</span>
                </label>
              ))}
              {filteredTransactions.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ไม่พบรายการตามคำค้นหา</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="space-y-3 border-b px-4 py-3">
              <div><p className="text-sm font-semibold"><span className="mr-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700">2</span>เลือกหลักฐานที่ตรงกัน</p><p className="mt-1 text-xs text-muted-foreground">เทียบวันที่ เลขบัตร เลขอ้างอิง และยอดเงิน</p></div>
              <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3"><Search className="h-3.5 w-3.5 text-muted-foreground" /><input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="ค้นหาเลขอ้างอิง ชื่อ หรือไฟล์" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
            </div>
            <div className="max-h-[300px] divide-y overflow-auto">
              {filteredReferences.map((ref) => (
                <label key={ref.id} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm hover:bg-muted/20">
                  <input type="radio" className="mt-1" checked={selectedRef === ref.id} onChange={() => setSelectedRef(ref.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{ref.reference}{ref.party_name ? ` · ${ref.party_name}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{ref.transaction_date ? formatDate(ref.transaction_date) : "ไม่ระบุวันที่"} · {ref.source_filename || "เพิ่มด้วยตนเอง"}</p>
                  </div>
                  <span className="font-semibold">{formatCurrency(ref.amount)}</span>
                </label>
              ))}
              {filteredReferences.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ไม่พบหลักฐานตามคำค้นหา</p>}
            </div>
            <div className="space-y-2 border-t p-4">
              <p className="text-xs font-medium text-muted-foreground">หาไม่เจอ? ระบุข้อมูลหลักฐานเองได้</p>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="เลขอ้างอิง" value={manualReference} disabled={!!selectedReference}
                  onChange={(e) => setManualReference(e.target.value)} className="rounded-md border px-3 py-1.5 text-sm disabled:bg-muted" />
                <input placeholder="ยอดเงินที่คาดไว้" type="number" step="0.01" value={manualAmount} disabled={!!selectedReference}
                  onChange={(e) => setManualAmount(e.target.value)} className="rounded-md border px-3 py-1.5 text-sm disabled:bg-muted" />
              </div>
              <input placeholder="หมายเหตุ (ถ้ามี)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border px-3 py-1.5 text-sm" />
              {(selectedTx.size > 0 || selectedReference) && <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg bg-muted/40 p-3 text-center text-xs"><span><small className="block text-[10px] text-muted-foreground">ยอดจากบัตร</small><b>{formatCurrency(selectedTxTotal)}</b></span><ArrowLeftRight className="h-4 w-4 text-muted-foreground" /><span><small className="block text-[10px] text-muted-foreground">ยอดจากหลักฐาน</small><b>{formatCurrency(expectedAmount)}</b></span><span className="col-span-3 border-t pt-2 text-[11px]">ส่วนต่าง <b className={Math.abs(difference) > 0.01 ? "text-rose-600" : "text-emerald-600"}>{formatCurrency(difference)}</b></span></div>}
              <p className="pt-1 text-xs font-semibold"><span className="mr-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">3</span>ตรวจยอดแล้วกดยืนยัน</p>
              <button onClick={handleSubmit} disabled={!canSubmit || submitting}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} ยืนยันการจับคู่
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>
          <p className="text-xs font-semibold text-slate-700">{toast}</p>
        </div>
      )}
    </div>
  );
}

