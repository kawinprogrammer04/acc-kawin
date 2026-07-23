import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2, Wallet, Building2, User, CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { walletAccountsApi } from "@/api/cashflow";
import type { WalletAccount } from "@/api/cashflow";
import { formatCurrency, ACCOUNT_TYPE_LABELS, OWNER_TYPE_LABELS } from "@/lib/format";

const ICONS: Record<string, React.ReactNode> = {
  bank: <Building2 className="h-5 w-5" />,
  cash: <Wallet className="h-5 w-5" />,
  ewallet: <CreditCard className="h-5 w-5" />,
  credit_card: <CreditCard className="h-5 w-5" />,
  other: <Wallet className="h-5 w-5" />,
};

function AccountForm({ initial, onSave, onCancel }: {
  initial?: Partial<WalletAccount>; onSave: (d: any) => Promise<void>; onCancel: () => void;
}) {
  const [form, setForm] = useState<{
    name: string; account_type: string; owner_type: string; bank_name: string;
    account_number: string; account_holder: string; currency: string;
    opening_balance: string; notes: string;
  }>({
    name: initial?.name ?? "",
    account_type: initial?.account_type ?? "bank",
    owner_type: initial?.owner_type ?? "company",
    bank_name: initial?.bank_name ?? "",
    account_number: initial?.account_number ?? "",
    account_holder: initial?.account_holder ?? "",
    currency: initial?.currency ?? "THB",
    opening_balance: initial?.opening_balance?.toString() ?? "0",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { await onSave({ ...form, opening_balance: Number(form.opening_balance) }); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className={labelCls}>ชื่อบัญชี *</label>
        <input className={inputCls} required value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="เช่น กสิกรไทย ออมทรัพย์" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>ประเภทบัญชี</label>
          <select className={inputCls} value={form.account_type}
            onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}>
            <option value="bank">ธนาคาร</option>
            <option value="cash">เงินสด</option>
            <option value="ewallet">e-Wallet</option>
            <option value="credit_card">บัตรเครดิต</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>เจ้าของ</label>
          <select className={inputCls} value={form.owner_type}
            onChange={e => setForm(f => ({ ...f, owner_type: e.target.value }))}>
            <option value="company">บริษัท</option>
            <option value="personal">ส่วนตัว</option>
            <option value="mixed">ผสม</option>
          </select>
        </div>
      </div>
      {form.account_type === "bank" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ธนาคาร</label>
            <input className={inputCls} value={form.bank_name}
              onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="กสิกรไทย, SCB, BBL..." />
          </div>
          <div>
            <label className={labelCls}>เลขบัญชี</label>
            <input className={inputCls} value={form.account_number}
              onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} placeholder="xxx-x-xxxxx-x" />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>ชื่อเจ้าของบัญชี</label>
          <input className={inputCls} value={form.account_holder}
            onChange={e => setForm(f => ({ ...f, account_holder: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>ยอดเงินเริ่มต้น</label>
          <input type="number" className={inputCls} value={form.opening_balance} min="0" step="0.01"
            onChange={e => setForm(f => ({ ...f, opening_balance: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className={labelCls}>หมายเหตุ</label>
        <input className={inputCls} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {initial ? "บันทึก" : "สร้างบัญชี"}
        </button>
      </div>
    </form>
  );
}

export function WalletAccountPage() {
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WalletAccount | null>(null);
  const [filter, setFilter] = useState<"" | "company" | "personal">("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const accs = await walletAccountsApi.list({ is_active: true });
      setAccounts(accs);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter ? accounts.filter(a => a.owner_type === filter) : accounts;
  const companyTotal = accounts.filter(a => a.owner_type === "company").reduce((s, a) => s + a.current_balance, 0);
  const personalTotal = accounts.filter(a => a.owner_type === "personal").reduce((s, a) => s + a.current_balance, 0);
  const total = companyTotal + personalTotal;

  const handleCreate = async (data: any) => {
    await walletAccountsApi.create(data);
    setShowForm(false);
    load();
  };

  const handleUpdate = async (data: any) => {
    if (!editing) return;
    await walletAccountsApi.update(editing.id, data);
    setEditing(null);
    load();
  };

  const handleDeactivate = async (id: number) => {
    if (!confirm("ต้องการปิดการใช้งานบัญชีนี้?")) return;
    await walletAccountsApi.delete(id);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="บัญชีเงิน / Wallet" subtitle="จัดการบัญชีธนาคาร เงินสด และ e-Wallet">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> เพิ่มบัญชี
        </button>
      </PageHeader>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">ยอดเงินรวม</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(total)}</p>
        </CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setFilter(filter === "company" ? "" : "company")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              <p className="text-xs text-muted-foreground">เงินบริษัท</p>
            </div>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(companyTotal)}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter(filter === "personal" ? "" : "personal")}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-purple-600" />
              <p className="text-xs text-muted-foreground">เงินส่วนตัว</p>
            </div>
            <p className="text-xl font-bold text-purple-600">{formatCurrency(personalTotal)}</p>
          </CardContent>
        </Card>
      </div>

      {(showForm || editing) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">{editing ? "แก้ไขบัญชี" : "เพิ่มบัญชีเงิน"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }}>✕</button>
            </div>
            <div className="px-6 py-4">
              <AccountForm
                initial={editing || undefined}
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
          {filtered.map(account => (
            <Card key={account.id} className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setEditing(account)}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2 ${account.owner_type === "company" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                      {ICONS[account.account_type] || <Wallet className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="font-semibold">{account.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[account.account_type]} · {OWNER_TYPE_LABELS[account.owner_type]}
                      </p>
                      {account.bank_name && <p className="text-[11px] text-muted-foreground">{account.bank_name}</p>}
                      {account.account_number && <p className="text-[11px] text-muted-foreground font-mono">{account.account_number}</p>}
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeactivate(account.id); }}
                    className="text-[11px] text-muted-foreground hover:text-destructive px-2 py-1 rounded-md hover:bg-destructive/10">
                    ปิด
                  </button>
                </div>
                <div className="mt-4 pt-3 border-t">
                  <p className="text-xs text-muted-foreground">ยอดเงินปัจจุบัน</p>
                  <p className={`text-2xl font-bold ${account.current_balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatCurrency(account.current_balance)}
                  </p>
                  {account.current_balance !== account.opening_balance && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      ยอดเริ่มต้น: {formatCurrency(account.opening_balance)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Wallet className="h-10 w-10 mb-3" />
              <p>ยังไม่มีบัญชีเงิน</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
