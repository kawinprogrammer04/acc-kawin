import { useEffect, useState, useCallback } from "react";
import { Loader2, PiggyBank, Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api, getApiErrorMessage } from "@/api/client";
import { formatCurrency, today, monthStart } from "@/lib/format";

interface Budget {
  id: number;
  name: string;
  budget_type: string;
  category_id?: number;
  period_type: string;
  start_date: string;
  end_date: string;
  amount: number;
  notes?: string;
  is_active: boolean;
  spent_amount: number;
  remaining: number;
  usage_pct: number;
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: "รายเดือน", quarterly: "รายไตรมาส", yearly: "รายปี", custom: "กำหนดเอง",
};

const emptyForm = {
  name: "", budget_type: "expense", category_id: "",
  period_type: "monthly", start_date: monthStart(), end_date: today(),
  amount: "", notes: "",
};

export function BudgetPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [form, setForm] = useState<{
    name: string; budget_type: string; category_id: string;
    period_type: string; start_date: string; end_date: string;
    amount: string; notes: string;
  }>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/budgets");
      setBudgets(res.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEdit(b: Budget) {
    setEditing(b);
    setForm({
      name: b.name, budget_type: b.budget_type,
      category_id: b.category_id ? String(b.category_id) : "",
      period_type: b.period_type, start_date: b.start_date.slice(0, 10),
      end_date: b.end_date.slice(0, 10), amount: String(b.amount), notes: b.notes ?? "",
    });
    setError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name || !form.amount || !form.start_date || !form.end_date) {
      setError("กรุณากรอกข้อมูลให้ครบ"); return;
    }
    setSaving(true); setError("");
    try {
      const payload = {
        name: form.name, budget_type: form.budget_type,
        category_id: form.category_id ? Number(form.category_id) : null,
        period_type: form.period_type, start_date: form.start_date, end_date: form.end_date,
        amount: Number(form.amount), notes: form.notes || null,
      };
      if (editing) {
        await api.patch(`/budgets/${editing.id}`, payload);
      } else {
        await api.post("/budgets", payload);
      }
      setShowForm(false);
      load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm("ยืนยันลบงบประมาณนี้?")) return;
    try { await api.delete(`/budgets/${id}`); load(); } catch {}
  }

  function barColor(pct: number) {
    if (pct >= 100) return "bg-rose-500";
    if (pct >= 80) return "bg-amber-400";
    return "bg-emerald-500";
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="งบประมาณ" subtitle="กำหนดและติดตามงบประมาณรายหมวดหมู่">
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> เพิ่มงบประมาณ
        </button>
      </PageHeader>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold mb-4">{editing ? "แก้ไขงบประมาณ" : "เพิ่มงบประมาณ"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">ชื่องบประมาณ</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น งบค่าใช้จ่ายการตลาด"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">รอบ</label>
                  <select
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={form.period_type}
                    onChange={e => setForm(f => ({ ...f, period_type: e.target.value }))}
                  >
                    {Object.entries(PERIOD_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">ประเภท</label>
                  <select
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={form.budget_type}
                    onChange={e => setForm(f => ({ ...f, budget_type: e.target.value }))}
                  >
                    <option value="expense">รายจ่าย</option>
                    <option value="income">รายรับ</option>
                    <option value="overall">ภาพรวม</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">วันเริ่มต้น</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">วันสิ้นสุด</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">วงเงินงบประมาณ (บาท)</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">หมายเหตุ</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="ไม่บังคับ"
                />
              </div>
              {error && <p className="text-xs text-rose-600">{error}</p>}
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : budgets.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground">
            <PiggyBank className="h-10 w-10 mb-2" />
            <p>ยังไม่มีงบประมาณ</p>
          </div>
        ) : (
          budgets.map(b => (
            <Card key={b.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{b.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {PERIOD_LABELS[b.period_type] ?? b.period_type}
                      {" · "}
                      {b.start_date?.slice(0, 10)} – {b.end_date?.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(b)} className="rounded p-1 hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(b.id)} className="rounded p-1 hover:bg-muted">
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">ใช้ไปแล้ว {b.usage_pct.toFixed(1)}%</span>
                    {b.usage_pct >= 80 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        {b.usage_pct >= 100 ? "เต็มแล้ว" : "ใกล้เต็ม"}
                      </span>
                    )}
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(b.usage_pct)}`}
                      style={{ width: `${Math.min(b.usage_pct, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">งบ</p>
                    <p className="text-xs font-medium">{formatCurrency(b.amount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">ใช้แล้ว</p>
                    <p className="text-xs font-medium text-rose-600">{formatCurrency(b.spent_amount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">คงเหลือ</p>
                    <p className={`text-xs font-medium ${b.remaining < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {formatCurrency(b.remaining)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
