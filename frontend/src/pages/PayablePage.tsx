import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Loader2, CreditCard, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { payablesApi, walletAccountsApi, holdersApi } from "@/api/cashflow";
import type { Payable, WalletAccount, Holder } from "@/api/cashflow";
import { formatCurrency, formatDate, STATUS_COLORS, STATUS_LABELS, today, isOverdue } from "@/lib/format";

function PayableForm({
  initial, onSave, onCancel
}: {
  initial?: Partial<Payable>; onSave: (data: any) => Promise<void>; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    creditor_name: initial?.creditor_name ?? "",
    creditor_type: initial?.creditor_type ?? "",
    description: initial?.description ?? "",
    issue_date: initial?.issue_date ?? today(),
    due_date: initial?.due_date ?? "",
    total_amount: initial?.total_amount?.toString() ?? "",
    reference_doc: initial?.reference_doc ?? "",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, total_amount: Number(form.total_amount), due_date: form.due_date || null });
    } finally { setSaving(false); }
  };

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>ชื่อเจ้าหนี้ *</label>
          <input className={inputCls} required value={form.creditor_name}
            onChange={e => setForm(f => ({ ...f, creditor_name: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>ประเภทเจ้าหนี้</label>
          <select className={inputCls} value={form.creditor_type}
            onChange={e => setForm(f => ({ ...f, creditor_type: e.target.value }))}>
            <option value="">-- เลือก --</option>
            <option value="supplier">Supplier / ผู้ขาย</option>
            <option value="employee">พนักงาน</option>
            <option value="owner">เจ้าของ</option>
            <option value="external">บุคคลภายนอก</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>รายละเอียดหนี้</label>
        <textarea className={inputCls} rows={2} value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>วันที่เกิดหนี้ *</label>
          <input type="date" className={inputCls} required value={form.issue_date}
            onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>วันครบกำหนด</label>
          <input type="date" className={inputCls} value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>จำนวนเงิน *</label>
          <input type="number" className={inputCls} required min="0" step="0.01" value={form.total_amount}
            onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>เอกสารอ้างอิง</label>
          <input className={inputCls} value={form.reference_doc}
            onChange={e => setForm(f => ({ ...f, reference_doc: e.target.value }))} placeholder="เลขที่ใบแจ้งหนี้..." />
        </div>
        <div>
          <label className={labelCls}>หมายเหตุ</label>
          <input className={inputCls} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {initial ? "บันทึก" : "เพิ่มเจ้าหนี้"}
        </button>
      </div>
    </form>
  );
}

function PayModal({
  payable, accounts, holders, onPay, onClose
}: {
  payable: Payable; accounts: WalletAccount[]; holders: Holder[];
  onPay: (data: any) => Promise<void>; onClose: () => void;
}) {
  const [amount, setAmount] = useState(payable.remaining_amount.toString());
  const [account_id, setAccountId] = useState("");
  const [holder_id, setHolderId] = useState("");
  const [paid_date, setPaidDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onPay({
        amount: Number(amount),
        account_id: account_id ? Number(account_id) : null,
        holder_id: holder_id ? Number(holder_id) : null,
        paid_date,
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold">บันทึกการจ่ายหนี้</h2>
          <p className="text-sm text-muted-foreground">{payable.creditor_name}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="rounded-lg bg-muted/30 px-4 py-3 text-sm">
            <div className="flex justify-between"><span>ยอดหนี้รวม</span><span>{formatCurrency(payable.total_amount)}</span></div>
            <div className="flex justify-between"><span>จ่ายแล้ว</span><span>{formatCurrency(payable.paid_amount)}</span></div>
            <div className="flex justify-between font-bold text-rose-600"><span>คงค้าง</span><span>{formatCurrency(payable.remaining_amount)}</span></div>
          </div>
          <div>
            <label className={labelCls}>จำนวนที่จ่าย *</label>
            <input type="number" className={inputCls} required min="0.01" step="0.01"
              max={payable.remaining_amount} value={amount}
              onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>บัญชีที่จ่าย</label>
            <select className={inputCls} value={account_id} onChange={e => setAccountId(e.target.value)}>
              <option value="">-- เลือกบัญชี --</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.current_balance)})</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>วันที่จ่าย *</label>
            <input type="date" className={inputCls} required value={paid_date}
              onChange={e => setPaidDate(e.target.value)} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              บันทึกการจ่าย
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PayablePage() {
  const [items, setItems] = useState<Payable[]>([]);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Payable | null>(null);
  const [paying, setPaying] = useState<Payable | null>(null);
  const [filters, setFilters] = useState({ status: "", keyword: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a, h] = await Promise.all([
        payablesApi.list({ ...filters, limit: 200 }),
        walletAccountsApi.list(),
        holdersApi.list(),
      ]);
      setItems(p); setAccounts(a); setHolders(h);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const totalOutstanding = items.filter(i => !["paid", "cancelled"].includes(i.status))
    .reduce((s, i) => s + i.remaining_amount, 0);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="เจ้าหนี้" subtitle="ติดตามหนี้ที่ต้องจ่าย">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> เพิ่มเจ้าหนี้
        </button>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4">
        {["unpaid", "partial", "overdue", "paid"].map(s => {
          const count = items.filter(i => i.status === s).length;
          const total = items.filter(i => i.status === s).reduce((sum, i) => sum + i.remaining_amount, 0);
          return (
            <Card key={s} className={`cursor-pointer ${filters.status === s ? "ring-2 ring-primary" : ""}`}
              onClick={() => setFilters(f => ({ ...f, status: f.status === s ? "" : s }))}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</p>
                <p className="text-lg font-bold">{count} รายการ</p>
                <p className={`text-xs font-medium ${s === "overdue" ? "text-rose-600" : "text-muted-foreground"}`}>
                  {formatCurrency(total)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <select value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="rounded-md border px-3 py-1.5 text-sm">
          <option value="">ทุกสถานะ</option>
          <option value="unpaid">ยังไม่จ่าย</option>
          <option value="partial">จ่ายบางส่วน</option>
          <option value="overdue">เลยกำหนด</option>
          <option value="paid">จ่ายครบ</option>
        </select>
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input placeholder="ค้นหาเจ้าหนี้..." value={filters.keyword}
            onChange={e => setFilters(f => ({ ...f, keyword: e.target.value }))}
            className="outline-none text-sm bg-transparent w-32" />
        </div>
        <div className="ml-auto text-sm text-muted-foreground">
          ยอดค้างทั้งหมด: <span className="font-bold text-rose-600">{formatCurrency(totalOutstanding)}</span>
        </div>
      </div>

      {(showForm || editing) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">{editing ? "แก้ไขเจ้าหนี้" : "เพิ่มเจ้าหนี้"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }}>✕</button>
            </div>
            <div className="px-6 py-4">
              <PayableForm
                initial={editing ?? undefined}
                onSave={async (data) => {
                  if (editing) {
                    await payablesApi.update(editing.id, data);
                    setEditing(null);
                  } else {
                    await payablesApi.create(data);
                    setShowForm(false);
                  }
                  load();
                }}
                onCancel={() => { setShowForm(false); setEditing(null); }}
              />
            </div>
          </div>
        </div>
      )}

      {paying && (
        <PayModal
          payable={paying} accounts={accounts} holders={holders}
          onPay={async (data) => { await payablesApi.pay(paying.id, data); setPaying(null); load(); }}
          onClose={() => setPaying(null)}
        />
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
                    {["เจ้าหนี้", "รายละเอียด", "วันครบกำหนด", "ยอดรวม", "จ่ายแล้ว", "ค้างจ่าย", "สถานะ", ""].map(h => (
                      <th key={h} className={`px-4 py-3 text-xs font-medium text-muted-foreground ${["ยอดรวม", "จ่ายแล้ว", "ค้างจ่าย"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(item => (
                    <tr key={item.id} className={`hover:bg-muted/20 ${isOverdue(item.due_date) && item.status !== "paid" ? "bg-rose-50/50" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.creditor_name}</p>
                        {item.creditor_type && <p className="text-[11px] text-muted-foreground">{item.creditor_type}</p>}
                      </td>
                      <td className="px-4 py-3 max-w-[150px] truncate text-muted-foreground">{item.description || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={isOverdue(item.due_date) && item.status !== "paid" ? "text-rose-600 font-medium" : ""}>
                          {item.due_date ? formatDate(item.due_date) : "-"}
                        </span>
                        {isOverdue(item.due_date) && item.status !== "paid" && (
                          <AlertTriangle className="inline h-3 w-3 ml-1 text-rose-500" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(item.total_amount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(item.paid_amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-rose-600">{formatCurrency(item.remaining_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status] || ""}`}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {!["paid", "cancelled"].includes(item.status) && (
                            <button onClick={() => setPaying(item)}
                              className="flex items-center gap-1 text-xs rounded-md bg-primary/10 text-primary px-2 py-1 hover:bg-primary/20">
                              <CreditCard className="h-3 w-3" /> จ่าย
                            </button>
                          )}
                          {!["paid", "cancelled"].includes(item.status) && (
                            <button onClick={() => setEditing(item)}
                              className="flex items-center gap-1 text-xs rounded-md bg-muted px-2 py-1 hover:bg-muted/70 text-muted-foreground">
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          <button onClick={async () => {
                            if (!confirm(`ต้องการลบ "${item.creditor_name}"?`)) return;
                            await payablesApi.delete(item.id); load();
                          }} className="text-xs text-rose-500 hover:text-rose-700 px-1">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CreditCard className="h-8 w-8 mb-2" />
                  <p className="text-sm">ยังไม่มีรายการเจ้าหนี้</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
