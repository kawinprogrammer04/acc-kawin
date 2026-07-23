import { useEffect, useState, useCallback } from "react";
import { Plus, ArrowRight, Loader2, ArrowLeftRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { transfersApi, walletAccountsApi, holdersApi } from "@/api/cashflow";
import type { Transfer, WalletAccount, Holder } from "@/api/cashflow";
import { formatCurrency, formatDate, today, monthStart } from "@/lib/format";

const TRANSFER_TYPE_LABELS: Record<string, string> = {
  account_to_account: "บัญชี → บัญชี",
  holder_to_holder: "Holder → Holder",
  account_to_holder: "บัญชี → Holder",
  holder_to_account: "Holder → บัญชี",
  owner_withdrawal: "เจ้าของถอนเงิน",
  owner_advance: "เจ้าของสำรองจ่าย",
  salary: "เงินเดือน",
  dividend: "เงินปันผล",
};

function TransferForm({ accounts, holders, onSave, onCancel }: {
  accounts: WalletAccount[]; holders: Holder[];
  onSave: (d: any) => Promise<void>; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    transfer_date: today(),
    transfer_type: "account_to_account",
    from_account_id: "",
    from_holder_id: "",
    to_account_id: "",
    to_holder_id: "",
    amount: "",
    fee: "0",
    reason: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  const tt = form.transfer_type;
  const showFromAccount = ["account_to_account", "account_to_holder", "owner_withdrawal"].includes(tt);
  const showFromHolder = ["holder_to_holder", "holder_to_account"].includes(tt);
  const showToAccount = ["account_to_account", "holder_to_account", "owner_withdrawal", "salary", "dividend"].includes(tt);
  const showToHolder = ["account_to_holder", "holder_to_holder"].includes(tt);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await onSave({
        ...form,
        amount: Number(form.amount),
        fee: Number(form.fee),
        from_account_id: form.from_account_id ? Number(form.from_account_id) : null,
        from_holder_id: form.from_holder_id ? Number(form.from_holder_id) : null,
        to_account_id: form.to_account_id ? Number(form.to_account_id) : null,
        to_holder_id: form.to_holder_id ? Number(form.to_holder_id) : null,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>วันที่โอน *</label>
          <input type="date" className={inputCls} required value={form.transfer_date}
            onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>ประเภทการโอน</label>
          <select className={inputCls} value={form.transfer_type}
            onChange={e => setForm(f => ({ ...f, transfer_type: e.target.value }))}>
            {Object.entries(TRANSFER_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">ต้นทาง</p>
          {showFromAccount && (
            <div>
              <label className={labelCls}>บัญชีต้นทาง</label>
              <select className={inputCls} value={form.from_account_id}
                onChange={e => setForm(f => ({ ...f, from_account_id: e.target.value }))}>
                <option value="">-- เลือกบัญชี --</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.current_balance)})</option>)}
              </select>
            </div>
          )}
          {showFromHolder && (
            <div>
              <label className={labelCls}>Holder ต้นทาง</label>
              <select className={inputCls} value={form.from_holder_id}
                onChange={e => setForm(f => ({ ...f, from_holder_id: e.target.value }))}>
                <option value="">-- เลือก Holder --</option>
                {holders.map(h => <option key={h.id} value={h.id}>{h.name} ({formatCurrency(h.current_balance)})</option>)}
              </select>
            </div>
          )}
          {tt === "owner_advance" && (
            <div>
              <label className={labelCls}>บัญชีเจ้าของ (ต้นทาง)</label>
              <select className={inputCls} value={form.from_account_id}
                onChange={e => setForm(f => ({ ...f, from_account_id: e.target.value }))}>
                <option value="">-- เลือกบัญชี --</option>
                {accounts.filter(a => a.owner_type === "personal").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">ปลายทาง</p>
          {showToAccount && (
            <div>
              <label className={labelCls}>บัญชีปลายทาง</label>
              <select className={inputCls} value={form.to_account_id}
                onChange={e => setForm(f => ({ ...f, to_account_id: e.target.value }))}>
                <option value="">-- เลือกบัญชี --</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          {showToHolder && (
            <div>
              <label className={labelCls}>Holder ปลายทาง</label>
              <select className={inputCls} value={form.to_holder_id}
                onChange={e => setForm(f => ({ ...f, to_holder_id: e.target.value }))}>
                <option value="">-- เลือก Holder --</option>
                {holders.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>จำนวนเงิน *</label>
          <input type="number" className={inputCls} required min="0.01" step="0.01" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>ค่าธรรมเนียม</label>
          <input type="number" className={inputCls} min="0" step="0.01" value={form.fee}
            onChange={e => setForm(f => ({ ...f, fee: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className={labelCls}>เหตุผลการโอน</label>
        <input className={inputCls} value={form.reason}
          onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>หมายเหตุ</label>
        <textarea className={inputCls} rows={2} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm">
        <p className="text-muted-foreground text-xs">หมายเหตุ: การโอนเงินภายในจะ <strong>ไม่ถูกนับ</strong>เป็นรายรับหรือรายจ่าย</p>
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          บันทึกการโอน
        </button>
      </div>
    </form>
  );
}

export function TransferPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, a, h] = await Promise.all([
        transfersApi.list({ start_date: startDate, end_date: endDate }),
        walletAccountsApi.list(),
        holdersApi.list(),
      ]);
      setTransfers(t); setAccounts(a); setHolders(h);
    } finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const getAccountName = (id?: number) => accounts.find(a => a.id === id)?.name ?? "-";
  const getHolderName = (id?: number) => holders.find(h => h.id === id)?.name ?? "-";

  const getSource = (t: Transfer) => {
    if (t.from_account_id) return getAccountName(t.from_account_id);
    if (t.from_holder_id) return `[H] ${getHolderName(t.from_holder_id)}`;
    return "-";
  };
  const getDest = (t: Transfer) => {
    if (t.to_account_id) return getAccountName(t.to_account_id);
    if (t.to_holder_id) return `[H] ${getHolderName(t.to_holder_id)}`;
    return "-";
  };

  const totalAmount = transfers.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="โอนเงินระหว่างบัญชี" subtitle="บันทึกการย้ายเงินระหว่างบัญชีและ Holder">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> บันทึกการโอน
        </button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">รายการโอนทั้งหมด ({transfers.length} รายการ)</p>
          <p className="text-xl font-bold">{formatCurrency(totalAmount)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-amber-700 font-medium">⚠ การโอนภายในไม่ถูกนับเป็นรายรับ/รายจ่าย</p>
          <p className="text-xs text-muted-foreground mt-1">เพื่อความถูกต้องของรายงานกำไรขาดทุน</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-3">
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm" />
        <span className="text-muted-foreground text-sm">ถึง</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm" />
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">บันทึกการโอนเงิน</h2>
              <button onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="px-6 py-4">
              <TransferForm accounts={accounts} holders={holders}
                onSave={async d => { await transfersApi.create(d); setShowForm(false); load(); }}
                onCancel={() => setShowForm(false)} />
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["วันที่", "ประเภท", "ต้นทาง", "", "ปลายทาง", "จำนวนเงิน", "ค่าธรรมเนียม", "เหตุผล", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transfers.map(t => (
                    <tr key={t.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(t.transfer_date)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">
                          {TRANSFER_TYPE_LABELS[t.transfer_type] || t.transfer_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{getSource(t)}</td>
                      <td className="px-4 py-3 text-muted-foreground"><ArrowRight className="h-4 w-4" /></td>
                      <td className="px-4 py-3 font-medium">{getDest(t)}</td>
                      <td className="px-4 py-3 font-semibold">{formatCurrency(t.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{t.fee > 0 ? formatCurrency(t.fee) : "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[150px] truncate">{t.reason || "-"}</td>
                      <td className="px-4 py-3">
                        {t.status !== "cancelled" && (
                          <button onClick={async () => {
                            if (!confirm("ต้องการยกเลิกการโอนนี้?")) return;
                            await transfersApi.cancel(t.id); load();
                          }} className="text-xs text-rose-600 hover:underline">ยกเลิก</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {transfers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ArrowLeftRight className="h-8 w-8 mb-2" />
                  <p className="text-sm">ยังไม่มีรายการโอนเงิน</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
