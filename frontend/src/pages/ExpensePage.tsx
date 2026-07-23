import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Loader2, Trash2, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { expensesApi, walletAccountsApi, holdersApi, categoriesApi } from "@/api/cashflow";
import type { ExpenseEntry, WalletAccount, Holder, CashflowCategory } from "@/api/cashflow";
import { formatCurrency, formatDate, STATUS_COLORS, STATUS_LABELS, today, monthStart } from "@/lib/format";

const VAT_RATE = 0.07;

function ExpenseForm({
  initial, accounts, holders, categories, onSave, onCancel
}: {
  initial?: Partial<ExpenseEntry>;
  accounts: WalletAccount[]; holders: Holder[]; categories: CashflowCategory[];
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<{
    expense_date: string; document_no: string; vendor_name: string; description: string;
    category_id: string; amount: string; vat_amount: string; withholding_tax: string;
    payment_channel: string; wallet_account_id: string; holder_id: string;
    is_company_expense: boolean; status: string; paid_date: string; owner_type: string; notes: string;
  }>({
    expense_date: initial?.expense_date ?? today(),
    document_no: initial?.document_no ?? "",
    vendor_name: initial?.vendor_name ?? "",
    description: initial?.description ?? "",
    category_id: initial?.category_id?.toString() ?? "",
    amount: initial?.amount?.toString() ?? "",
    vat_amount: initial?.vat_amount?.toString() ?? "0",
    withholding_tax: initial?.withholding_tax?.toString() ?? "0",
    payment_channel: initial?.payment_channel ?? "",
    wallet_account_id: initial?.wallet_account_id?.toString() ?? "",
    holder_id: initial?.holder_id?.toString() ?? "",
    is_company_expense: initial?.is_company_expense ?? true,
    status: initial?.status ?? "pending",
    paid_date: initial?.paid_date ?? "",
    owner_type: initial?.owner_type ?? "company",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const net = Number(form.amount || 0) + Number(form.vat_amount || 0) - Number(form.withholding_tax || 0);
  const calcVat = () => setForm(f => ({ ...f, vat_amount: (Number(f.amount || 0) * VAT_RATE).toFixed(2) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        amount: Number(form.amount),
        vat_amount: Number(form.vat_amount),
        withholding_tax: Number(form.withholding_tax),
        net_amount: net,
        category_id: form.category_id ? Number(form.category_id) : null,
        wallet_account_id: form.wallet_account_id ? Number(form.wallet_account_id) : null,
        holder_id: form.holder_id ? Number(form.holder_id) : null,
        paid_date: form.paid_date || null,
      });
    } finally { setSaving(false); }
  };

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>วันที่จ่าย *</label>
          <input type="date" className={inputCls} required value={form.expense_date}
            onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>เลขที่เอกสาร</label>
          <input className={inputCls} value={form.document_no}
            onChange={e => setForm(f => ({ ...f, document_no: e.target.value }))} placeholder="INV-001" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>ผู้รับเงิน / Vendor</label>
          <input className={inputCls} value={form.vendor_name}
            onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>หมวดหมู่</label>
          <select className={inputCls} value={form.category_id}
            onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">-- เลือกหมวดหมู่ --</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>รายละเอียด *</label>
        <input className={inputCls} required value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="อธิบายรายจ่าย..." />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>จำนวนเงิน *</label>
          <input type="number" className={inputCls} required min="0" step="0.01" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>VAT <button type="button" onClick={calcVat}
            className="ml-2 text-[10px] text-primary underline">7%</button></label>
          <input type="number" className={inputCls} min="0" step="0.01" value={form.vat_amount}
            onChange={e => setForm(f => ({ ...f, vat_amount: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>หัก ณ ที่จ่าย</label>
          <input type="number" className={inputCls} min="0" step="0.01" value={form.withholding_tax}
            onChange={e => setForm(f => ({ ...f, withholding_tax: e.target.value }))} />
        </div>
      </div>
      <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">ยอดจ่ายสุทธิ: </span>
        <span className="font-bold text-rose-700 text-base">{formatCurrency(net)}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>ช่องทางจ่ายเงิน</label>
          <input className={inputCls} value={form.payment_channel}
            onChange={e => setForm(f => ({ ...f, payment_channel: e.target.value }))} placeholder="โอนธนาคาร, เงินสด..." />
        </div>
        <div>
          <label className={labelCls}>บัญชีที่เงินออก</label>
          <select className={inputCls} value={form.wallet_account_id}
            onChange={e => setForm(f => ({ ...f, wallet_account_id: e.target.value }))}>
            <option value="">-- เลือกบัญชี --</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.current_balance)})</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Holder</label>
          <select className={inputCls} value={form.holder_id}
            onChange={e => setForm(f => ({ ...f, holder_id: e.target.value }))}>
            <option value="">-- ไม่ระบุ --</option>
            {holders.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>ประเภท</label>
          <div className="flex items-center gap-4 mt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="expense_type" checked={form.is_company_expense}
                onChange={() => setForm(f => ({ ...f, is_company_expense: true }))} />
              ค่าใช้จ่ายบริษัท
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="expense_type" checked={!form.is_company_expense}
                onChange={() => setForm(f => ({ ...f, is_company_expense: false }))} />
              ส่วนตัว
            </label>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>สถานะ</label>
          <select className={inputCls} value={form.status}
            onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="pending">รอจ่าย</option>
            <option value="completed">จ่ายแล้ว</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
        </div>
        {form.status === "completed" && (
          <div>
            <label className={labelCls}>วันที่จ่ายจริง</label>
            <input type="date" className={inputCls} value={form.paid_date}
              onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} />
          </div>
        )}
      </div>
      <div>
        <label className={labelCls}>หมายเหตุ</label>
        <textarea className={inputCls} rows={2} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {initial ? "บันทึกการแก้ไข" : "เพิ่มรายจ่าย"}
        </button>
      </div>
    </form>
  );
}

export function ExpensePage() {
  const [items, setItems] = useState<ExpenseEntry[]>([]);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [categories, setCategories] = useState<CashflowCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseEntry | null>(null);
  const [filters, setFilters] = useState({ start_date: monthStart(), end_date: today(), status: "", keyword: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [exp, accs, hols, cats] = await Promise.all([
        expensesApi.list({ ...filters, limit: 200 }),
        walletAccountsApi.list(),
        holdersApi.list(),
        categoriesApi.list("expense"),
      ]);
      setItems(exp); setAccounts(accs); setHolders(hols); setCategories(cats);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: any) => {
    await expensesApi.create(data);
    setShowForm(false);
    load();
  };

  const handleUpdate = async (data: any) => {
    if (!editing) return;
    await expensesApi.update(editing.id, data);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("ต้องการยกเลิกรายการนี้?")) return;
    await expensesApi.delete(id);
    load();
  };

  const total = items.reduce((s, i) => s + i.net_amount, 0);
  const paid = items.filter(i => i.status === "completed").reduce((s, i) => s + i.net_amount, 0);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="รายจ่าย" subtitle="บันทึกและติดตามรายจ่ายทั้งหมด">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> เพิ่มรายจ่าย
        </button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">รายจ่ายทั้งหมด ({items.length} รายการ)</p>
          <p className="text-xl font-bold text-rose-600">{formatCurrency(total)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">จ่ายแล้ว</p>
          <p className="text-xl font-bold text-rose-700">{formatCurrency(paid)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">รอจ่าย</p>
          <p className="text-xl font-bold text-amber-600">{formatCurrency(total - paid)}</p>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <input type="date" value={filters.start_date}
          onChange={e => setFilters(f => ({ ...f, start_date: e.target.value }))}
          className="rounded-md border px-3 py-1.5 text-sm" />
        <input type="date" value={filters.end_date}
          onChange={e => setFilters(f => ({ ...f, end_date: e.target.value }))}
          className="rounded-md border px-3 py-1.5 text-sm" />
        <select value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="rounded-md border px-3 py-1.5 text-sm">
          <option value="">ทุกสถานะ</option>
          <option value="pending">รอจ่าย</option>
          <option value="completed">จ่ายแล้ว</option>
          <option value="cancelled">ยกเลิก</option>
        </select>
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input placeholder="ค้นหา..." value={filters.keyword}
            onChange={e => setFilters(f => ({ ...f, keyword: e.target.value }))}
            className="outline-none text-sm bg-transparent w-32" />
        </div>
      </div>

      {(showForm || editing) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">{editing ? "แก้ไขรายจ่าย" : "เพิ่มรายจ่าย"}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null); }}>✕</button>
            </div>
            <div className="px-6 py-4">
              <ExpenseForm
                initial={editing || undefined}
                accounts={accounts} holders={holders} categories={categories}
                onSave={editing ? handleUpdate : handleCreate}
                onCancel={() => { setShowForm(false); setEditing(null); }}
              />
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["วันที่", "เลขที่", "ผู้รับเงิน", "รายละเอียด", "จำนวนเงิน", "สุทธิ", "ประเภท", "สถานะ", ""].map(h => (
                      <th key={h} className={`px-4 py-3 text-xs font-medium text-muted-foreground ${["จำนวนเงิน", "สุทธิ"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setEditing(item)}>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(item.expense_date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.document_no || "-"}</td>
                      <td className="px-4 py-3">{item.vendor_name || "-"}</td>
                      <td className="px-4 py-3 max-w-[180px] truncate">{item.description}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(item.amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-rose-600">{formatCurrency(item.net_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${item.is_company_expense ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
                          {item.is_company_expense ? "บริษัท" : "ส่วนตัว"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status] || ""}`}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleDelete(item.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="h-8 w-8 mb-2" />
                  <p className="text-sm">ยังไม่มีรายการรายจ่าย</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
