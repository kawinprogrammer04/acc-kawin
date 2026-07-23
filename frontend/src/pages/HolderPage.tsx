import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { holdersApi, walletAccountsApi } from "@/api/cashflow";
import type { Holder, WalletAccount } from "@/api/cashflow";
import { formatCurrency, HOLDER_TYPE_LABELS } from "@/lib/format";

function HolderForm({ initial, accounts, onSave, onCancel }: {
  initial?: Partial<Holder>; accounts: WalletAccount[];
  onSave: (d: any) => Promise<void>; onCancel: () => void;
}) {
  const [form, setForm] = useState<{
    name: string; holder_type: string; owner_type: string; wallet_account_id: string;
    purpose: string; opening_balance: string; notes: string;
  }>({
    name: initial?.name ?? "",
    holder_type: initial?.holder_type ?? "company",
    owner_type: initial?.owner_type ?? "company",
    wallet_account_id: initial?.wallet_account_id?.toString() ?? "",
    purpose: initial?.purpose ?? "",
    opening_balance: initial?.opening_balance?.toString() ?? "0",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await onSave({
        ...form,
        opening_balance: Number(form.opening_balance),
        wallet_account_id: form.wallet_account_id ? Number(form.wallet_account_id) : null,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className={labelCls}>ชื่อ Holder *</label>
        <input className={inputCls} required value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="เช่น เงินสำรองภาษี, เงินโปรเจกต์ A" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>ประเภท Holder</label>
          <select className={inputCls} value={form.holder_type}
            onChange={e => setForm(f => ({ ...f, holder_type: e.target.value }))}>
            {Object.entries(HOLDER_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>เจ้าของเงิน</label>
          <select className={inputCls} value={form.owner_type}
            onChange={e => setForm(f => ({ ...f, owner_type: e.target.value }))}>
            <option value="company">บริษัท</option>
            <option value="personal">ส่วนตัว</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>บัญชีหลักที่ผูกอยู่</label>
          <select className={inputCls} value={form.wallet_account_id}
            onChange={e => setForm(f => ({ ...f, wallet_account_id: e.target.value }))}>
            <option value="">-- ไม่ระบุ --</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>ยอดเริ่มต้น</label>
          <input type="number" className={inputCls} value={form.opening_balance} min="0" step="0.01"
            onChange={e => setForm(f => ({ ...f, opening_balance: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className={labelCls}>วัตถุประสงค์</label>
        <textarea className={inputCls} rows={2} value={form.purpose}
          onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="อธิบายวัตถุประสงค์ของ Holder..." />
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {initial ? "บันทึก" : "สร้าง Holder"}
        </button>
      </div>
    </form>
  );
}

const TYPE_COLORS: Record<string, string> = {
  company: "bg-blue-50 text-blue-700",
  personal: "bg-purple-50 text-purple-700",
  tax: "bg-amber-50 text-amber-700",
  salary: "bg-emerald-50 text-emerald-700",
  project: "bg-indigo-50 text-indigo-700",
  reserve: "bg-orange-50 text-orange-700",
  stock: "bg-cyan-50 text-cyan-700",
  other: "bg-gray-50 text-gray-700",
};

export function HolderPage() {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Holder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, a] = await Promise.all([holdersApi.list({ is_active: true }), walletAccountsApi.list()]);
      setHolders(h); setAccounts(a);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalBalance = holders.reduce((s, h) => s + h.current_balance, 0);
  const companyBalance = holders.filter(h => h.owner_type === "company").reduce((s, h) => s + h.current_balance, 0);
  const personalBalance = holders.filter(h => h.owner_type === "personal").reduce((s, h) => s + h.current_balance, 0);

  const handleCreate = async (data: any) => { await holdersApi.create(data); setShowForm(false); load(); };
  const handleUpdate = async (data: any) => {
    if (!editing) return;
    await holdersApi.update(editing.id, data); setEditing(null); load();
  };
  const handleDeactivate = async (id: number) => {
    if (!confirm("ต้องการปิดการใช้งาน Holder นี้?")) return;
    await holdersApi.delete(id); load();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Holder / กระเป๋าย่อย" subtitle="แบ่งเงินตามวัตถุประสงค์">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> สร้าง Holder
        </button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">ยอดรวมทุก Holder ({holders.length} กระเป๋า)</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(totalBalance)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Holder บริษัท</p>
          <p className="text-xl font-bold text-blue-600">{formatCurrency(companyBalance)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Holder ส่วนตัว</p>
          <p className="text-xl font-bold text-purple-600">{formatCurrency(personalBalance)}</p>
        </CardContent></Card>
      </div>

      {(showForm || editing) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">{editing ? "แก้ไข Holder" : "สร้าง Holder ใหม่"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }}>✕</button>
            </div>
            <div className="px-6 py-4">
              <HolderForm initial={editing || undefined} accounts={accounts}
                onSave={editing ? handleUpdate : handleCreate}
                onCancel={() => { setShowForm(false); setEditing(null); }} />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {holders.map(h => {
            const linkedAccount = accounts.find(a => a.id === h.wallet_account_id);
            return (
              <Card key={h.id} className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setEditing(h)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{h.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[h.holder_type] || ""}`}>
                          {HOLDER_TYPE_LABELS[h.holder_type]}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {h.owner_type === "company" ? "บริษัท" : "ส่วนตัว"}
                        </span>
                      </div>
                      {linkedAccount && (
                        <p className="text-[11px] text-muted-foreground mt-1">📎 {linkedAccount.name}</p>
                      )}
                      {h.purpose && (
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{h.purpose}</p>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeactivate(h.id); }}
                      className="text-[11px] text-muted-foreground hover:text-destructive px-2 py-1 rounded-md hover:bg-destructive/10">
                      ปิด
                    </button>
                  </div>
                  <div className="mt-4 pt-3 border-t">
                    <p className="text-xs text-muted-foreground">ยอดเงินปัจจุบัน</p>
                    <p className={`text-2xl font-bold ${h.current_balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {formatCurrency(h.current_balance)}
                    </p>
                    <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${Math.min(100, h.opening_balance > 0 ? (h.current_balance / h.opening_balance) * 100 : 0)}%` }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {holders.length === 0 && (
            <div className="col-span-3 flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="h-10 w-10 mb-3" />
              <p>ยังไม่มี Holder</p>
              <p className="text-sm mt-1">สร้าง Holder เพื่อแบ่งเงินตามวัตถุประสงค์</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
