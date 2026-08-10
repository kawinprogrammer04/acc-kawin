import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Search, FileText, Loader2, Send, XCircle, Eye, Trash2 } from "lucide-react";
import { invoicesApi, accountsApi, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import { today as localToday, localDateInput } from "@/lib/format";
import type { Invoice, Account } from "@/types";

// ── Status config ─────────────────────────────────────────────────────────────
const statusConfig: Record<string, { label: string; variant: "success" | "info" | "destructive" | "secondary" | "warning" | "outline" }> = {
  draft:   { label: "ร่าง",       variant: "secondary" },
  sent:    { label: "ส่งแล้ว",    variant: "info" },
  partial: { label: "ชำระบางส่วน", variant: "warning" },
  paid:    { label: "ชำระแล้ว",   variant: "success" },
  overdue: { label: "เกินกำหนด",  variant: "destructive" },
  voided:  { label: "ยกเลิก",     variant: "outline" },
};

// ── Invoice Detail Dialog ─────────────────────────────────────────────────────
function InvoiceDetailDialog({ invoice, open, onClose }: { invoice: Invoice | null; open: boolean; onClose: () => void }) {
  if (!invoice) return null;
  const cfg = statusConfig[invoice.status];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>{invoice.invoice_number}</DialogTitle>
            <Badge variant={cfg.variant}>{cfg.label}</Badge>
          </div>
          <DialogDescription>{invoice.party_name}</DialogDescription>
        </DialogHeader>
        <div className="px-6 space-y-4">
          {/* Header info */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-muted-foreground">วันที่: </span>{formatDate(invoice.invoice_date)}</div>
            <div><span className="text-muted-foreground">ครบกำหนด: </span>{formatDate(invoice.due_date)}</div>
            <div><span className="text-muted-foreground">อ้างอิง: </span>{invoice.reference ?? "-"}</div>
          </div>
          <Separator />
          {/* Lines */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 text-left">รายการ</th>
                <th className="pb-2 text-right w-16">จำนวน</th>
                <th className="pb-2 text-right w-32">ราคา/หน่วย</th>
                <th className="pb-2 text-right w-16">ส่วนลด %</th>
                <th className="pb-2 text-right w-32">รวม</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right">{l.quantity} {l.unit}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(Number(l.unit_price))}</td>
                  <td className="py-2 text-right">{Number(l.discount_pct) > 0 ? `${l.discount_pct}%` : "-"}</td>
                  <td className="py-2 text-right font-mono">{formatCurrency(Number(l.line_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Separator />
          {/* Totals */}
          <div className="ml-auto w-64 space-y-1.5 text-sm">
            {[
              { label: "ยอดก่อนภาษี", val: invoice.subtotal },
              { label: "ส่วนลด", val: -invoice.discount_amount },
              { label: `VAT ${invoice.is_vat_included ? "(รวมแล้ว)" : "7%"}`, val: invoice.vat_amount },
              { label: "หัก ณ ที่จ่าย", val: -invoice.wht_amount },
            ].map((r) => (
              <div key={r.label} className="flex justify-between text-muted-foreground">
                <span>{r.label}</span>
                <span className="font-mono">{formatCurrency(Number(r.val))}</span>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between font-bold text-base">
              <span>ยอดสุทธิ</span>
              <span className="font-mono">{formatCurrency(Number(invoice.total_amount))}</span>
            </div>
            {Number(invoice.paid_amount) > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>ชำระแล้ว</span>
                <span className="font-mono">{formatCurrency(Number(invoice.paid_amount))}</span>
              </div>
            )}
            {Number(invoice.balance_due) > 0 && (
              <div className="flex justify-between font-semibold text-amber-700">
                <span>ยอดค้างชำระ</span>
                <span className="font-mono">{formatCurrency(Number(invoice.balance_due))}</span>
              </div>
            )}
          </div>
          {invoice.notes && <p className="text-sm text-muted-foreground">หมายเหตุ: {invoice.notes}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Invoice Dialog ─────────────────────────────────────────────────────
interface LineInput {
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_pct: string;
  wht_type: string;
}

const emptyLineInput = (): LineInput => ({
  description: "", quantity: "1", unit: "", unit_price: "", discount_pct: "0", wht_type: "",
});

function CreateInvoiceDialog({
  open, onClose, onSaved, accounts, invoiceType,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: Account[];
  invoiceType: "ar" | "ap";
}) {
  const today = localToday();
  const [form, setForm] = useState({
    invoice_number: "", reference: "", invoice_date: today,
    due_date: localDateInput(new Date(Date.now() + 30 * 86400000)),
    party_id: "", period_id: "1", ar_ap_account_id: "",
    revenue_expense_account_id: "", apply_vat: true, notes: "",
  });
  const [lines, setLines] = useState<LineInput[]>([emptyLineInput()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [vatPreview, setVatPreview] = useState<{ vat_amount: number; total_amount: number } | null>(null);

  // VAT preview
  useEffect(() => {
    const subtotal = lines.reduce((s, l) => {
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unit_price) || 0;
      const disc = Number(l.discount_pct) || 0;
      return s + qty * price * (1 - disc / 100);
    }, 0);
    if (subtotal > 0 && form.apply_vat) {
      invoicesApi.calculateVat(subtotal, false)
        .then(setVatPreview).catch(() => {});
    } else {
      setVatPreview(null);
    }
  }, [lines, form.apply_vat]);

  const updateLine = (i: number, field: keyof LineInput, val: string) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const handleSave = async () => {
    if (!form.party_id || !form.ar_ap_account_id) { setError("กรุณากรอกข้อมูลให้ครบ"); return; }
    setSaving(true); setError("");
    try {
      await invoicesApi.create({
        ...form,
        invoice_type: invoiceType,
        period_id: Number(form.period_id),
        ar_ap_account_id: Number(form.ar_ap_account_id),
        revenue_expense_account_id: form.revenue_expense_account_id ? Number(form.revenue_expense_account_id) : null,
        is_vat_included: false,
        lines: lines.filter((l) => l.description && l.unit_price).map((l, i) => ({
          line_number: i + 1,
          description: l.description,
          quantity: Number(l.quantity),
          unit: l.unit || null,
          unit_price: Number(l.unit_price),
          discount_pct: Number(l.discount_pct),
          wht_type: l.wht_type || null,
        })),
      });
      onSaved(); onClose();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const arApAccounts = accounts.filter((a) =>
    !a.is_header && a.is_active &&
    (invoiceType === "ar" ? a.account_type === "asset" : a.account_type === "liability")
  );
  const revenueExpenseAccounts = accounts.filter((a) =>
    !a.is_header && a.is_active &&
    (invoiceType === "ar" ? a.account_type === "revenue" : a.account_type === "expense")
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สร้าง{invoiceType === "ar" ? "ใบแจ้งหนี้ลูกค้า (AR)" : "ใบวางบิลเจ้าหนี้ (AP)"}</DialogTitle>
        </DialogHeader>
        <div className="px-6 pt-4 grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>เลขที่ใบแจ้งหนี้</Label>
            <Input placeholder="อัตโนมัติถ้าเว้นว่าง" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>วันที่ออก</Label>
            <Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>วันครบกำหนด</Label>
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>งวดบัญชี</Label>
            <Select value={form.period_id} onValueChange={(v) => setForm({ ...form, period_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>งวดที่ {i + 1}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>รหัสลูกค้า/ผู้ขาย (UUID)</Label>
            <Input placeholder="party-uuid..." value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>เลขอ้างอิง (ใบกำกับผู้ขาย)</Label>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>บัญชี{invoiceType === "ar" ? "ลูกหนี้" : "เจ้าหนี้"} <span className="text-destructive">*</span></Label>
            <Select value={form.ar_ap_account_id} onValueChange={(v) => setForm({ ...form, ar_ap_account_id: v })}>
              <SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger>
              <SelectContent>
                {arApAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name_th}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>บัญชี{invoiceType === "ar" ? "รายได้" : "ค่าใช้จ่าย"}</Label>
            <Select value={form.revenue_expense_account_id} onValueChange={(v) => setForm({ ...form, revenue_expense_account_id: v })}>
              <SelectTrigger><SelectValue placeholder="เลือกบัญชี..." /></SelectTrigger>
              <SelectContent>
                {revenueExpenseAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name_th}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.apply_vat} onChange={(e) => setForm({ ...form, apply_vat: e.target.checked })} className="rounded" />
              <span className="text-sm">คิด VAT 7%</span>
            </label>
          </div>
        </div>

        {/* Lines */}
        <div className="px-6 pt-4">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">รายการ</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground w-16">จำนวน</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground w-20">หน่วย</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground w-32">ราคา/หน่วย</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground w-20">ส่วนลด %</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground w-24">WHT</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground w-32">รวม</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const total = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100);
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">
                        <Input className="h-8 text-xs" placeholder="รายละเอียด..." value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input className="h-8 text-xs text-right" type="number" min="0" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input className="h-8 text-xs" placeholder="ชิ้น" value={l.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input className="h-8 text-xs text-right" type="number" min="0" step="0.01" placeholder="0.00" value={l.unit_price} onChange={(e) => updateLine(i, "unit_price", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input className="h-8 text-xs text-right" type="number" min="0" max="100" step="0.01" value={l.discount_pct} onChange={(e) => updateLine(i, "discount_pct", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Select value={l.wht_type} onValueChange={(v) => updateLine(i, "wht_type", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">ไม่หัก</SelectItem>
                            <SelectItem value="1">1%</SelectItem>
                            <SelectItem value="2">2%</SelectItem>
                            <SelectItem value="3">3%</SelectItem>
                            <SelectItem value="5">5%</SelectItem>
                            <SelectItem value="15">15%</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatCurrency(total)}</td>
                      <td className="px-3 py-1.5">
                        {lines.length > 1 && (
                          <button onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLineInput()])}
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
          </button>

          {/* VAT Preview */}
          {vatPreview && (
            <Card className="mt-3 ml-auto w-60">
              <CardContent className="p-3 text-sm space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>ก่อน VAT</span>
                  <span>{formatCurrency(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100), 0))}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>VAT 7%</span>
                  <span>{formatCurrency(Number(vatPreview.vat_amount))}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>ยอดรวม</span>
                  <span>{formatCurrency(Number(vatPreview.total_amount))}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {error && <p className="px-6 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} สร้างใบแจ้งหนี้
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function InvoicePage() {
  const { type } = useParams<{ type: string }>();
  const invoiceType = type === "ap" ? "ap" : "ar";
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailInv, setDetailInv] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [inv, acc] = await Promise.all([
      invoicesApi.list({ invoice_type: invoiceType, limit: 200 }),
      accountsApi.list({ is_active: true }),
    ]);
    setInvoices(inv); setAccounts(acc); setLoading(false);
  }, [invoiceType]);

  useEffect(() => { load(); }, [load]);

  const filtered = invoices.filter((inv) => {
    const matchStatus = statusFilter === "all" || inv.status === statusFilter;
    const matchSearch = !search || inv.invoice_number.includes(search) || (inv.party_name ?? "").includes(search);
    return matchStatus && matchSearch;
  });

  const handlePost = async (id: string) => { await invoicesApi.post(id); load(); };
  const handleVoid = async (id: string) => {
    if (!confirm("ยืนยันการยกเลิก Invoice?")) return;
    await invoicesApi.void(id); load();
  };

  // Summary stats
  const totalOutstanding = filtered.filter((i) => !["paid", "voided"].includes(i.status)).reduce((s, i) => s + Number(i.balance_due), 0);
  const overdueCount = filtered.filter((i) => i.status === "overdue").length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={invoiceType === "ar" ? "ใบแจ้งหนี้ลูกค้า (AR)" : "ใบวางบิลเจ้าหนี้ (AP)"}
        description={invoiceType === "ar" ? "จัดการการรับชำระเงินจากลูกค้า" : "จัดการการจ่ายชำระให้ผู้ขาย"}
        actions={
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> สร้างใบแจ้งหนี้
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">รายการทั้งหมด</p>
            <p className="text-2xl font-bold">{filtered.length}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ยอดค้างชำระรวม</p>
            <p className="text-2xl font-bold">{formatCurrency(totalOutstanding)}</p>
          </CardContent></Card>
          <Card className={overdueCount > 0 ? "border-red-200 bg-red-50" : ""}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">เกินกำหนด</p>
            <p className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-600" : ""}`}>{overdueCount} รายการ</p>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="ค้นหา..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกสถานะ</SelectItem>
              {Object.entries(statusConfig).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["เลขที่", "วันที่", "ครบกำหนด", invoiceType === "ar" ? "ลูกค้า" : "ผู้ขาย", "ยอดรวม", "ชำระแล้ว", "ค้างชำระ", "สถานะ", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-xs text-muted-foreground first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="py-12 text-center text-muted-foreground">ไม่พบรายการ</td></tr>
                  )}
                  {filtered.map((inv) => {
                    const cfg = statusConfig[inv.status];
                    return (
                      <tr key={inv.id} className="border-b hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs font-medium">{inv.invoice_number}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(inv.invoice_date)}</td>
                        <td className={`px-4 py-3 text-xs ${inv.status === "overdue" ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {formatDate(inv.due_date)}
                        </td>
                        <td className="px-4 py-3 max-w-[160px] truncate">{inv.party_name}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{formatCurrency(Number(inv.total_amount))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-emerald-600">{formatCurrency(Number(inv.paid_amount))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold">
                          {Number(inv.balance_due) > 0 ? formatCurrency(Number(inv.balance_due)) : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDetailInv(inv)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {inv.status === "draft" && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handlePost(inv.id)}>
                                <Send className="h-3.5 w-3.5 mr-1" /> Post
                              </Button>
                            )}
                            {["draft", "sent"].includes(inv.status) && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => handleVoid(inv.id)}>
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <CreateInvoiceDialog
        open={createOpen} onClose={() => setCreateOpen(false)}
        onSaved={load} accounts={accounts} invoiceType={invoiceType}
      />
      <InvoiceDetailDialog invoice={detailInv} open={!!detailInv} onClose={() => setDetailInv(null)} />
    </div>
  );
}
