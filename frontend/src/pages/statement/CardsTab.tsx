import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, CreditCard, Loader2, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { cardsApi, type Card as StatementCard } from "@/api/statement";
import { formatCurrency } from "@/lib/format";
import { FriendlyEmpty } from "./StatementUx";

type UnknownCard = { card_last4: string; transaction_count: number; total_topup: number; total_spend: number };

export function CardsTab() {
  const [cards, setCards] = useState<StatementCard[]>([]);
  const [unknownCards, setUnknownCards] = useState<UnknownCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cardsApi.list();
      setCards(data.cards);
      setUnknownCards(data.unknown_cards);
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดรายการบัตรไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("ลบบัตรนี้?")) return;
    try {
      await cardsApi.delete(id);
      showToast("ลบบัตรแล้ว");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "ลบไม่สำเร็จ"));
    }
  };

  const handleCreate = async (payload: { name: string; last4: string; holder_name?: string; bank_name?: string }) => {
    await cardsApi.create(payload);
    setShowCreate(null);
    showToast("บันทึกบัตรแล้ว");
    load();
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="จัดการบัตร"
        subtitle="ตั้งชื่อเลขท้ายบัตรที่ระบบอ่านพบ เพื่อให้เลือกและตรวจยอดแต่ละใบได้ง่ายขึ้น"
        actions={
          <button onClick={() => setShowCreate("")} className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            <Plus className="h-3.5 w-3.5" /> เพิ่มบัตร
          </button>
        }
      />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><p className="text-xs text-rose-700">{error}</p></div>
          <button onClick={() => setError(null)}><span className="text-rose-400">✕</span></button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : cards.length === 0 ? (
            <FriendlyEmpty title="ยังไม่มีบัตรที่ตั้งชื่อไว้" description="เมื่ออัปโหลด Statement แล้วพบเลขท้ายบัตร ระบบจะแสดงไว้ด้านล่างให้ตั้งชื่อได้" icon={<CreditCard className="h-5 w-5" />} />
          ) : (
            <div className="divide-y">
              {cards.map((card) => {
                const shortfall = card.total_spend - card.total_topup;
                return (
                  <div key={card.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{card.name} ••••{card.last4}</p>
                          <p className="text-xs text-muted-foreground">{[card.bank_name, card.holder_name].filter(Boolean).join(" · ") || "-"} · {card.transaction_count} รายการ</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2"><Link to={`/statement?tab=transactions&card=${card.last4}`} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">ดูรายการบัตรนี้</Link><button type="button" aria-label={`ลบ ${card.name}`} onClick={() => handleDelete(card.id)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 pl-7 text-xs">
                      <span className="text-muted-foreground">เงินเติมเข้าบัตร <b className="text-slate-700">{formatCurrency(card.total_topup)}</b></span>
                      <span className="text-muted-foreground">ยอดใช้จ่ายจากบัตร <b className="text-slate-700">{formatCurrency(card.total_spend)}</b></span>
                      {shortfall > 0 ? (
                        <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                          <AlertTriangle className="h-3 w-3" /> ยังเติมไม่พอ ขาด {formatCurrency(shortfall)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">เติมครบแล้ว</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {unknownCards.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3"><p className="text-sm font-semibold">พบเลขบัตรใหม่ที่ยังไม่รู้ชื่อ</p><p className="mt-0.5 text-xs text-muted-foreground">ตั้งชื่อครั้งเดียว ระบบจะใช้ชื่อนี้กับรายการเลขท้ายเดียวกัน</p></div>
            <div className="divide-y">
              {unknownCards.map((u) => (
                <div key={u.card_last4} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>••••{u.card_last4} · {u.transaction_count} รายการ · เติม {formatCurrency(u.total_topup)} / ใช้จ่าย {formatCurrency(u.total_spend)}</span>
                  <button onClick={() => setShowCreate(u.card_last4)} className="text-xs font-medium text-primary hover:underline">ตั้งชื่อบัตรนี้</button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate !== null} onOpenChange={(open) => !open && setShowCreate(null)}>
        <DialogContent>
          {showCreate !== null && <CreateCardForm defaultLast4={showCreate} onCancel={() => setShowCreate(null)} onSave={handleCreate} />}
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>
          <p className="text-xs font-semibold text-slate-700">{toast}</p>
        </div>
      )}
    </div>
  );
}

function CreateCardForm({
  defaultLast4, onCancel, onSave,
}: { defaultLast4: string; onCancel: () => void; onSave: (payload: { name: string; last4: string; holder_name?: string; bank_name?: string }) => Promise<void> }) {
  const [form, setForm] = useState({ name: "", last4: defaultLast4, holder_name: "", bank_name: "" });
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-md border px-3 py-1.5 text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

  const submit = async () => {
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div>
      <DialogHeader><DialogTitle>ตั้งชื่อบัตร</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3 p-6 pt-4">
        <div><label className={labelCls}>ชื่อบัตร *</label><input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div><label className={labelCls}>เลขท้าย 4 หลัก *</label><input className={inputCls} maxLength={4} value={form.last4} onChange={(e) => setForm((f) => ({ ...f, last4: e.target.value.replace(/\D/g, "") }))} /></div>
        <div><label className={labelCls}>ธนาคาร</label><input className={inputCls} value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} /></div>
        <div><label className={labelCls}>ผู้ถือบัตร</label><input className={inputCls} value={form.holder_name} onChange={(e) => setForm((f) => ({ ...f, holder_name: e.target.value }))} /></div>
      </div>
      <DialogFooter>
        <button onClick={onCancel} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</button>
        <button onClick={submit} disabled={saving || !form.name || form.last4.length !== 4}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />} บันทึก
        </button>
      </DialogFooter>
    </div>
  );
}

