import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, FileImage, Loader2, Plus, Search, Trash2, UploadCloud } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { referenceItemsApi, type ReferenceItem, type ReferenceSource } from "@/api/statement";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterPanel, FriendlyEmpty, ListPagination } from "./StatementUx";

const STATUS_LABEL: Record<string, string> = { matched: "ตรวจเรียบร้อย", unmatched: "ต้องตรวจ", ignored: "ไม่นับ" };
const STATUS_CLASS: Record<string, string> = { matched: "bg-emerald-50 text-emerald-700", unmatched: "bg-amber-50 text-amber-700", ignored: "bg-slate-100 text-slate-600" };

export function ReferencesTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<ReferenceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [sourceFilter, setSourceFilter] = useState(searchParams.get("source") ?? "");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await referenceItemsApi.list();
      setItems(data.items);
      setStats(data.stats);
      setSources(data.sources);
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดข้อมูลไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [sourceFilter, query]);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("th");
    return items.filter((item) => {
      if (sourceFilter && item.source_filename !== sourceFilter) return false;
      if (!keyword) return true;
      return [item.reference, item.party_name, item.source_filename, item.notes]
        .some((value) => String(value ?? "").toLocaleLowerCase("th").includes(keyword));
    });
  }, [items, query, sourceFilter]);
  const pageItems = pageSize === 0 ? filteredItems : filteredItems.slice((page - 1) * pageSize, page * pageSize);

  const changeSource = (source: string) => {
    setSourceFilter(source);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "references");
    if (source) next.set("source", source); else next.delete("source");
    setSearchParams(next, { replace: true });
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const result = await referenceItemsApi.upload(file);
      showToast(`นำเข้าสำเร็จ ${result.inserted} รายการ`);
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "นำเข้าไฟล์ไม่สำเร็จ"));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteSource = async (sourceFilename: string) => {
    if (!confirm(`ลบข้อมูลจากไฟล์ "${sourceFilename}" ทั้งหมด?`)) return;
    try {
      await referenceItemsApi.deleteSource(sourceFilename);
      showToast("ลบข้อมูลแล้ว");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "ลบไม่สำเร็จ"));
    }
  };

  const handleCreate = async (payload: Parameters<typeof referenceItemsApi.create>[0]) => {
    await referenceItemsApi.create(payload);
    setShowCreate(false);
    showToast("เพิ่มรายการแล้ว");
    load();
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="หลักฐานค่าโฆษณา"
        subtitle="ดูยอดที่ระบบอ่านจากรูปภาพหรือเอกสาร และเลือกดูแยกตามไฟล์ได้"
        actions={
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
            <button disabled={uploading} onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />} เพิ่มไฟล์หลักฐาน
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              <Plus className="h-3.5 w-3.5" /> เพิ่มรายการเอง
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><p className="text-xs text-rose-700">{error}</p></div>
          <button onClick={() => setError(null)}><span className="text-rose-400">✕</span></button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="รายการทั้งหมด" value={String(stats.total ?? 0)} />
        <Metric label="ตรวจเรียบร้อย" value={String(stats.matched ?? 0)} tone="text-emerald-600" />
        <Metric label="ต้องตรวจ" value={String(stats.unmatched ?? 0)} tone="text-amber-600" />
        <Metric label="ยังไม่มีเอกสาร" value={String(stats.missing_attachments ?? 0)} tone="text-rose-600" />
      </div>

      {sources.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3"><div><p className="text-sm font-semibold">ไฟล์หลักฐานที่อัปโหลดแล้ว</p><p className="mt-0.5 text-xs text-muted-foreground">กดชื่อไฟล์เพื่อดูเฉพาะรายการในไฟล์นั้น</p></div>{sourceFilter && <button type="button" onClick={() => changeSource("")} className="text-xs font-medium text-sky-700">ดูทุกไฟล์</button>}</div>
            <div className="divide-y">
              {sources.map((s) => (
                <div key={s.source_filename} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", sourceFilter === s.source_filename && "bg-sky-50")}>
                  <button type="button" onClick={() => changeSource(s.source_filename)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><FileImage className="h-4 w-4" /></span>
                    <span className="min-w-0"><span className="block truncate font-medium">{s.source_filename}</span><span className="text-xs text-muted-foreground">{s.total} รายการ · ตรวจแล้ว {s.matched} · {s.imported_at ? formatDate(s.imported_at) : ""}</span></span>
                  </button>
                  <button type="button" aria-label={`ลบ ${s.source_filename}`} onClick={() => handleDeleteSource(s.source_filename)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <FilterPanel resultText={`พบ ${filteredItems.length} รายการ${pageSize === 0 ? " · แสดงทั้งหมด" : ` · แสดงครั้งละ ${pageSize} รายการ`}`}>
        <label className="min-w-[220px] flex-1 text-[11px] font-medium text-muted-foreground">ไฟล์หลักฐาน
          <select value={sourceFilter} onChange={(event) => changeSource(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">ทุกไฟล์</option>{sources.map((source) => <option key={source.source_filename} value={source.source_filename}>{source.source_filename}</option>)}
          </select>
        </label>
        <label className="min-w-[240px] flex-1 text-[11px] font-medium text-muted-foreground">ค้นหา
          <span className="mt-1.5 flex h-9 items-center gap-2 rounded-md border bg-background px-3"><Search className="h-3.5 w-3.5 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เลขอ้างอิง ชื่อ หรือชื่อไฟล์" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" /></span>
        </label>
        {(sourceFilter || query) && <button type="button" onClick={() => { changeSource(""); setQuery(""); }} className="h-9 rounded-md px-3 text-xs font-medium text-sky-700 hover:bg-sky-50">ล้างตัวกรอง</button>}
      </FilterPanel>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : pageItems.length === 0 ? (
            <FriendlyEmpty title="ไม่พบรายการหลักฐาน" description={items.length ? "ลองเปลี่ยนไฟล์หรือคำค้นหา" : "เพิ่มไฟล์หลักฐานจากหน้าอัปโหลด แล้วรายการที่อ่านได้จะแสดงตรงนี้"} icon={<FileImage className="h-5 w-5" />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["วันที่", "เลขอ้างอิง", "ช่องทาง/ชื่อ", "ยอดเงิน", "ไฟล์ต้นทาง", "สถานะ"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageItems.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground">{item.transaction_date ? formatDate(item.transaction_date) : "-"}</td>
                      <td className="px-4 py-3">{item.reference}</td>
                      <td className="px-4 py-3">{item.party_name || "-"}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.amount)}</td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">{item.source_filename || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_CLASS[item.match_status] ?? "bg-slate-100 text-slate-700")}>{STATUS_LABEL[item.match_status] ?? item.match_status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ListPagination page={page} pageSize={pageSize} total={filteredItems.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <CreateReferenceForm onCancel={() => setShowCreate(false)} onSave={handleCreate} />
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function CreateReferenceForm({
  onCancel, onSave,
}: { onCancel: () => void; onSave: (payload: { reference: string; amount: number; transaction_date?: string; transaction_time?: string; party_name?: string; has_attachment?: boolean; notes?: string }) => Promise<void> }) {
  const [form, setForm] = useState({ reference: "", amount: "", transaction_date: "", party_name: "", has_attachment: false, notes: "" });
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-md border px-3 py-1.5 text-sm";
  const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, amount: Number(form.amount) });
    } finally { setSaving(false); }
  };

  return (
    <div>
      <DialogHeader><DialogTitle>เพิ่มหลักฐานด้วยตนเอง</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3 p-6 pt-4">
        <div><label className={labelCls}>เลขอ้างอิง *</label><input className={inputCls} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></div>
        <div><label className={labelCls}>ยอดเงิน *</label><input type="number" step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        <div><label className={labelCls}>วันที่</label><input type="date" className={inputCls} value={form.transaction_date} onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))} /></div>
        <div><label className={labelCls}>ช่องทางหรือชื่อผู้รับเงิน</label><input className={inputCls} value={form.party_name} onChange={(e) => setForm((f) => ({ ...f, party_name: e.target.value }))} /></div>
        <div className="col-span-2"><label className={labelCls}>หมายเหตุ</label><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
      </div>
      <DialogFooter>
        <button onClick={onCancel} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</button>
        <button onClick={submit} disabled={saving || !form.reference || !form.amount}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />} บันทึกรายการ
        </button>
      </DialogFooter>
    </div>
  );
}
