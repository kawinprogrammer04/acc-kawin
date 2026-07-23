import { useEffect, useState, useCallback } from "react";
import { Plus, Search, CheckCircle, XCircle, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { journalsApi, accountsApi } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterChips } from "@/components/layout/FilterChips";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useFilter, parseDesc } from "@/context/FilterContext";
import type { Journal, Account, JournalLine } from "@/types";

// ── Status badge ──────────────────────────────────────────────────────────────
const statusMap: Record<string, { label: string; variant: "success" | "info" | "destructive" | "secondary" }> = {
  draft:  { label: "ร่าง",    variant: "secondary" },
  posted: { label: "บันทึกแล้ว", variant: "success" },
  voided: { label: "ยกเลิก",  variant: "destructive" },
};

// ── Empty line factory ────────────────────────────────────────────────────────
const emptyLine = (n: number): JournalLine => ({
  line_number: n, account_id: 0, description: "", debit: 0, credit: 0,
});

// ── Account picker ────────────────────────────────────────────────────────────
function AccountPicker({ value, accounts, onChange }: {
  value: number;
  accounts: Account[];
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = accounts.filter(
    (a) =>
      !a.is_header &&
      a.is_active &&
      (a.code.includes(query) || a.name_th.includes(query))
  ).slice(0, 50);
  const selected = accounts.find((a) => a.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm hover:bg-accent truncate"
      >
        {selected ? `${selected.code} ${selected.name_th}` : <span className="text-muted-foreground">เลือกบัญชี...</span>}
        <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border bg-white shadow-lg">
          <div className="p-2">
            <Input
              autoFocus
              placeholder="ค้นหารหัสหรือชื่อบัญชี..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">ไม่พบบัญชี</p>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { onChange(a.id); setOpen(false); setQuery(""); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              >
                <span className="font-mono text-muted-foreground w-12">{a.code}</span>
                <span className="truncate">{a.name_th}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

// ── Journal form ──────────────────────────────────────────────────────────────
function JournalForm({
  open, onClose, onSaved, accounts,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: Account[];
}) {
  const today = new Date().toISOString().split("T")[0];
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [periodId, setPeriodId] = useState("1");
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(1), emptyLine(2)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalDebit  = lines.reduce((s, l) => s + Number(l.debit),  0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  const isBalanced = diff < 0.001 && totalDebit > 0;

  const updateLine = (i: number, field: keyof JournalLine, val: unknown) => {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine(prev.length + 1)]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, line_number: idx + 1 })));

  const reset = () => {
    setEntryDate(today); setDescription(""); setReference("");
    setLines([emptyLine(1), emptyLine(2)]); setError("");
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSave = async (status: "draft" | "post") => {
    if (!description) { setError("กรุณาระบุคำอธิบาย"); return; }
    const validLines = lines.filter((l) => l.account_id > 0 && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (validLines.length < 2) { setError("ต้องมีรายการอย่างน้อย 2 บรรทัด"); return; }
    if (!isBalanced) { setError(`Debit (${totalDebit.toFixed(2)}) ≠ Credit (${totalCredit.toFixed(2)})`); return; }

    setSaving(true); setError("");
    try {
      const journal = await journalsApi.create({
        entry_date: entryDate,
        period_id: Number(periodId),
        description,
        reference: reference || null,
        lines: validLines.map((l, i) => ({ ...l, line_number: i + 1, debit: Number(l.debit), credit: Number(l.credit) })),
      });
      if (status === "post") await journalsApi.post(journal.id);
      reset();
      onSaved();
      onClose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>บันทึกรายการ Journal Entry</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 px-6 pt-4">
          <div className="space-y-1.5">
            <Label>วันที่</Label>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>งวดบัญชี</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    งวดที่ {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>เลขอ้างอิง</Label>
            <Input placeholder="อ้างอิง..." value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="col-span-3 space-y-1.5">
            <Label>คำอธิบาย <span className="text-destructive">*</span></Label>
            <Input placeholder="รายละเอียดรายการ..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        {/* Lines */}
        <div className="px-6 pt-4">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground w-8">#</th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground w-64">บัญชี</th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">คำอธิบาย</th>
                  <th className="px-3 py-2 text-right font-medium text-xs text-muted-foreground w-32">เดบิต (Dr)</th>
                  <th className="px-3 py-2 text-right font-medium text-xs text-muted-foreground w-32">เครดิต (Cr)</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5">
                      <AccountPicker
                        value={line.account_id}
                        accounts={accounts}
                        onChange={(id) => updateLine(i, "account_id", id)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-9"
                        placeholder="คำอธิบาย..."
                        value={line.description}
                        onChange={(e) => updateLine(i, "description", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-9 text-right"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={line.debit || ""}
                        onChange={(e) => {
                          updateLine(i, "debit", e.target.value);
                          if (Number(e.target.value) > 0) updateLine(i, "credit", 0);
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-9 text-right"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={line.credit || ""}
                        onChange={(e) => {
                          updateLine(i, "credit", e.target.value);
                          if (Number(e.target.value) > 0) updateLine(i, "debit", 0);
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      {lines.length > 2 && (
                        <button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals */}
              <tfoot className="border-t bg-muted/50">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-sm font-semibold">รวม</td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-semibold">{formatCurrency(totalDebit)}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-semibold">{formatCurrency(totalCredit)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={6} className="px-3 pb-2">
                    {isBalanced ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <CheckCircle className="h-3.5 w-3.5" /> สมดุลแล้ว (Balanced)
                      </span>
                    ) : totalDebit > 0 || totalCredit > 0 ? (
                      <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                        <XCircle className="h-3.5 w-3.5" />
                        ยังไม่สมดุล — ต่างกัน {formatCurrency(diff)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button type="button" onClick={addLine} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> เพิ่มบรรทัด
          </button>
        </div>

        {error && <p className="px-6 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>ยกเลิก</Button>
          <Button variant="secondary" onClick={() => handleSave("draft")} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} บันทึกร่าง
          </Button>
          <Button onClick={() => handleSave("post")} disabled={saving || !isBalanced}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} บันทึกและ Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function JournalPage() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { matchDesc } = useFilter();

  const load = useCallback(async () => {
    setLoading(true);
    const [j, a] = await Promise.all([
      journalsApi.list({ limit: 500 }),
      accountsApi.list({ is_active: true }),
    ]);
    setJournals(j); setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = journals.filter((j) => {
    const matchStatus = statusFilter === "all" || j.status === statusFilter;
    const matchSearch = !search || j.entry_number.includes(search) || j.description.includes(search);
    return matchStatus && matchSearch && matchDesc(j.description);
  });

  const handlePost = async (id: string) => {
    await journalsApi.post(id); load();
  };
  const handleVoid = async (id: string) => {
    const reason = prompt("ระบุเหตุผลการยกเลิก:");
    if (!reason) return;
    await journalsApi.void(id, reason); load();
  };
  const handleDelete = async (id: string) => {
    if (!confirm("ยืนยันลบ Journal Entry นี้?")) return;
    await journalsApi.delete(id); load();
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="สมุดรายวัน"
        description="บันทึกรายการบัญชีแบบ Double-Entry"
        actions={
          <Button onClick={() => setFormOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> สร้างรายการ
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Filters */}
        <div className="space-y-2">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8" placeholder="ค้นหา..." value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกสถานะ</SelectItem>
                <SelectItem value="draft">ร่าง</SelectItem>
                <SelectItem value="posted">บันทึกแล้ว</SelectItem>
                <SelectItem value="voided">ยกเลิก</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FilterChips />
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
                    <th className="w-8" />
                    <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">เลขที่</th>
                    <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">วันที่</th>
                    <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">คำอธิบาย</th>
                    <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">แผนก</th>
                    <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">หมวด</th>
                    <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">เดบิต</th>
                    <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">เครดิต</th>
                    <th className="px-4 py-3 text-center font-medium text-xs text-muted-foreground">สถานะ</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">ไม่พบรายการ</td></tr>
                  )}
                  {filtered.map((j) => {
                    const parsed = parseDesc(j.description);
                    return (
                      <>
                        <tr
                          key={j.id}
                          className="border-b hover:bg-muted/30 cursor-pointer"
                          onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                        >
                          <td className="pl-4">
                            {expanded === j.id
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            }
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-medium">{j.entry_number}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(j.entry_date)}</td>
                          <td className="px-4 py-3 max-w-[220px] truncate">{parsed.clean || j.description}</td>
                          <td className="px-4 py-3">
                            {parsed.dept && (
                              <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium whitespace-nowrap">{parsed.dept}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {parsed.category && (
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${parsed.category === "Fixed Cost" ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"}`}>
                                {parsed.category === "Fixed Cost" ? "Fixed" : "Variable"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(j.total_debit))}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(j.total_credit))}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={statusMap[j.status]?.variant}>{statusMap[j.status]?.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              {j.status === "draft" && (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handlePost(j.id)}>Post</Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => handleDelete(j.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                              {j.status === "posted" && (
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => handleVoid(j.id)}>Void</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded === j.id && (
                          <tr key={`${j.id}-detail`} className="bg-muted/20 border-b">
                            <td colSpan={10} className="px-8 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="py-1 text-left w-20">รหัสบัญชี</th>
                                    <th className="py-1 text-left">ชื่อบัญชี</th>
                                    <th className="py-1 text-left">คำอธิบาย</th>
                                    <th className="py-1 text-right w-32">เดบิต</th>
                                    <th className="py-1 text-right w-32">เครดิต</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {j.lines.map((l) => {
                                    const lp = parseDesc(l.description ?? "");
                                    return (
                                      <tr key={l.id} className="border-t border-border/50">
                                        <td className="py-1 font-mono">{l.account_code}</td>
                                        <td className="py-1">{l.account_name}</td>
                                        <td className="py-1 text-muted-foreground">{lp.clean || l.description}</td>
                                        <td className="py-1 text-right font-mono">{Number(l.debit) > 0 ? formatCurrency(Number(l.debit)) : ""}</td>
                                        <td className="py-1 text-right font-mono">{Number(l.credit) > 0 ? formatCurrency(Number(l.credit)) : ""}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <JournalForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} accounts={accounts} />
    </div>
  );
}
