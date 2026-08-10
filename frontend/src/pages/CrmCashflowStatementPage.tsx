import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, Download, FileSpreadsheet, FileText, Import, Pencil, Plus, RefreshCw,
  Save, Settings2, Trash2,
} from "lucide-react";

import {
  crmCashflowApi,
  type CheckDuplicatesResult,
  type CrmCashflowAttachment,
  type CrmCashflowCategory,
  type CrmCashflowDepartment,
  type CrmCashflowSource,
  type CrmCashflowStatement,
  type CrmStatementInput,
  type DuplicateAction,
  type ImportPreview,
} from "@/api/crmCashflow";
import { Can } from "@/components/auth/RequirePermission";
import { PageHeader } from "@/components/layout/PageHeader";
import { InvoiceStatusBadge } from "@/components/ui/invoice-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDate } from "@/lib/format";

const MENU_KEY = "crm_cashflow_statement";
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

function errorMessage(error: any) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).join(", ");
  return error?.message || "เกิดข้อผิดพลาด";
}

const emptyForm = (): CrmStatementInput => ({
  cfstate_date: today(),
  cfcat_id: 0,
  cflist_id: 0,
  cfstate_dep_id: null,
  cfstate_invoice: null,
  cfstate_refrain: 1,
  cfstate_detail: "",
  cfstate_amount: 0,
  cfstate_ref: "",
});

export function CrmCashflowStatementPage() {
  const [categories, setCategories] = useState<CrmCashflowCategory[]>([]);
  const [sources, setSources] = useState<CrmCashflowSource[]>([]);
  const [departments, setDepartments] = useState<CrmCashflowDepartment[]>([]);
  const [rows, setRows] = useState<CrmCashflowStatement[]>([]);
  const [sumRevenue, setSumRevenue] = useState(0);
  const [sumExpenses, setSumExpenses] = useState(0);
  const [dateStart, setDateStart] = useState(today());
  const [dateEnd, setDateEnd] = useState(today());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [toastKey, setToastKey] = useState(0);

  // Route every alert through these instead of calling setError/setNotice
  // directly, so the toast re-plays even when the message text repeats.
  const showError = (message: string) => {
    setError(message);
    setNotice("");
    setToastKey((key) => key + 1);
  };

  const showNotice = (message: string) => {
    setNotice(message);
    setError("");
    setToastKey((key) => key + 1);
  };

  useEffect(() => {
    if (!notice && !error) return;
    const timer = setTimeout(() => {
      setNotice("");
      setError("");
    }, 4000);
    return () => clearTimeout(timer);
  }, [toastKey]);

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState<CrmStatementInput>(emptyForm());
  const [entryAmount, setEntryAmount] = useState("");
  const [drafts, setDrafts] = useState<CrmStatementInput[]>([]);
  const [duplicateCheck, setDuplicateCheck] = useState<CheckDuplicatesResult | null>(null);
  const [duplicateReviewOpen, setDuplicateReviewOpen] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const [masterOpen, setMasterOpen] = useState(false);
  const [masterTab, setMasterTab] = useState<"category" | "source" | "department">("category");
  const [masterName, setMasterName] = useState("");
  const [masterCategoryId, setMasterCategoryId] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [headerRow, setHeaderRow] = useState(true);
  const [useExistingData, setUseExistingData] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importDuplicateAction, setImportDuplicateAction] = useState<DuplicateAction>("skip");
  const [importSkipRows, setImportSkipRows] = useState<number[]>([]);

  // Details dialog (read-only view of attachments uploaded from
  // /crm-cashflow/invoices — attaching/removing files stays on that page).
  const [detailStatement, setDetailStatement] = useState<CrmCashflowStatement | null>(null);
  const [detailAttachments, setDetailAttachments] = useState<(CrmCashflowAttachment & { previewUrl?: string })[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const activeCategories = categories.filter((item) => item.cfcat_status === 1);
  const activeDepartments = departments.filter((item) => item.cfstate_dep_status === 1);
  const formSources = sources.filter(
    (item) => item.cflist_status === 1 && item.cfcat_id === entryForm.cfcat_id && item.cflist_hide == null,
  );

  const loadMasters = useCallback(async (includeInactive = true) => {
    const [categoryData, sourceData, departmentData] = await Promise.all([
      crmCashflowApi.categories(includeInactive),
      crmCashflowApi.sources(undefined, includeInactive),
      crmCashflowApi.departments(includeInactive),
    ]);
    setCategories(categoryData);
    setSources(sourceData);
    setDepartments(departmentData);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await crmCashflowApi.statements({
        start_date: dateStart || undefined,
        end_date: dateEnd || undefined,
        cfcat_id: categoryFilter ? Number(categoryFilter) : undefined,
      });
      setRows(result.items);
      setSumRevenue(result.sum_revenue);
      setSumExpenses(result.sum_expenses);
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [dateStart, dateEnd, categoryFilter]);

  useEffect(() => {
    loadMasters().catch((requestError) => showError(errorMessage(requestError)));
  }, [loadMasters]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const openEntry = () => {
    const categoryId = activeCategories[0]?.cfcat_id ?? 0;
    const sourceId = sources.find(
      (item) => item.cfcat_id === categoryId && item.cflist_status === 1 && item.cflist_hide == null,
    )?.cflist_id ?? 0;
    setEntryForm({ ...emptyForm(), cfcat_id: categoryId, cflist_id: sourceId });
    setEntryAmount("");
    setDrafts([]);
    setEntryOpen(true);
  };

  const changeEntryCategory = (categoryId: number) => {
    const sourceId = sources.find(
      (item) => item.cfcat_id === categoryId && item.cflist_status === 1 && item.cflist_hide == null,
    )?.cflist_id ?? 0;
    setEntryForm((current) => ({ ...current, cfcat_id: categoryId, cflist_id: sourceId }));
  };

  const addDraft = () => {
    const amount = Number(entryAmount.replace(/,/g, ""));
    if (!entryForm.cfcat_id || !entryForm.cflist_id || !entryAmount || Number.isNaN(amount)) {
      showError("กรุณาเลือกหัวข้อ แหล่งที่มา และระบุจำนวนเงินให้ถูกต้อง");
      return;
    }
    setDrafts((items) => [...items, { ...entryForm, cfstate_amount: amount }]);
    setEntryAmount("");
    setEntryForm((current) => ({ ...current, cfstate_detail: "", cfstate_ref: "" }));
  };

  const saveDrafts = async (duplicateAction: DuplicateAction = "skip") => {
    if (!drafts.length) return;
    try {
      const result = await crmCashflowApi.createStatements(drafts, duplicateAction);
      setEntryOpen(false);
      setDuplicateReviewOpen(false);
      setDuplicateCheck(null);
      setDrafts([]);
      showNotice(
        `บันทึกสำเร็จ ${result.created} รายการ`
        + (result.updated ? `, อัปเดตรายการเดิม ${result.updated} รายการ` : "")
        + (result.skipped ? `, ข้ามรายการซ้ำ ${result.skipped} รายการ` : ""),
      );
      await loadRows();
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  const confirmSaveDrafts = async () => {
    if (!drafts.length) return;
    setCheckingDuplicates(true);
    try {
      const result = await crmCashflowApi.checkDuplicates(drafts);
      if (result.duplicates.length) {
        setDuplicateCheck(result);
        setDuplicateReviewOpen(true);
      } else {
        await saveDrafts("skip");
      }
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const updateFlag = async (id: number, data: { cfstate_invoice?: 0 | 1; cfstate_refrain?: 0 | 1 }) => {
    try {
      await crmCashflowApi.updateStatement(id, data);
      await loadRows();
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  const removeStatement = async (id: number) => {
    if (!window.confirm("ยืนยันการลบรายการนี้?")) return;
    try {
      await crmCashflowApi.deleteStatement(id);
      await loadRows();
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  const openDetails = async (statement: CrmCashflowStatement) => {
    setDetailStatement(statement);
    setDetailAttachments([]);
    setDetailLoading(true);
    try {
      const attachments = await crmCashflowApi.attachments(statement.cfstate_id);
      // Load every file's preview immediately — no extra "ดูไฟล์" click needed.
      const withPreviews = await Promise.all(attachments.map(async (attachment) => {
        try {
          const blob = await crmCashflowApi.openAttachment(statement.cfstate_id, attachment.id);
          return { ...attachment, previewUrl: URL.createObjectURL(blob) };
        } catch {
          return attachment;
        }
      }));
      setDetailAttachments(withPreviews);
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetails = () => {
    detailAttachments.forEach((attachment) => { if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl); });
    setDetailStatement(null);
    setDetailAttachments([]);
  };

  const addMaster = async () => {
    if (!masterName.trim()) return;
    try {
      if (masterTab === "category") await crmCashflowApi.createCategory(masterName);
      if (masterTab === "department") await crmCashflowApi.createDepartment(masterName);
      if (masterTab === "source") {
        if (!masterCategoryId) throw new Error("กรุณาเลือกหัวข้อ");
        await crmCashflowApi.createSource({ cflist_name: masterName, cfcat_id: Number(masterCategoryId) });
      }
      setMasterName("");
      await loadMasters();
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  const editMaster = async (kind: "category" | "source" | "department", id: number, currentName: string) => {
    const name = window.prompt("ชื่อใหม่", currentName)?.trim();
    if (!name || name === currentName) return;
    try {
      if (kind === "category") await crmCashflowApi.updateCategory(id, { cfcat_name: name });
      if (kind === "source") await crmCashflowApi.updateSource(id, { cflist_name: name });
      if (kind === "department") await crmCashflowApi.updateDepartment(id, { cfstate_dep_name: name });
      await loadMasters();
    } catch (requestError) { showError(errorMessage(requestError)); }
  };

  const moveSource = async (source: CrmCashflowSource) => {
    const targetCategory = window.prompt("รหัสหัวข้อปลายทาง", String(source.cfcat_id));
    if (!targetCategory) return;
    const targetSource = window.prompt("รหัสแหล่งที่มาปลายทาง (เว้นว่างเพื่อสร้างใหม่)", "");
    let payload: { new_cfcat_id: number; new_cflist_id?: number; new_list_name?: string } = {
      new_cfcat_id: Number(targetCategory),
    };
    if (targetSource) payload.new_cflist_id = Number(targetSource);
    else {
      const newName = window.prompt("ชื่อแหล่งที่มาใหม่", source.cflist_name)?.trim();
      if (!newName) return;
      payload.new_list_name = newName;
    }
    try {
      await crmCashflowApi.moveSource(source.cflist_id, payload);
      await loadMasters();
      await loadRows();
    } catch (requestError) { showError(errorMessage(requestError)); }
  };

  const toggleMaster = async (kind: "category" | "source" | "department", id: number, active: number) => {
    try {
      if (kind === "category") await crmCashflowApi.updateCategory(id, { cfcat_status: active ? 0 : 1 });
      if (kind === "source") await crmCashflowApi.updateSource(id, { cflist_status: active ? 0 : 1 });
      if (kind === "department") await crmCashflowApi.updateDepartment(id, { cfstate_dep_status: active ? 0 : 1 });
      await loadMasters();
    } catch (requestError) { showError(errorMessage(requestError)); }
  };

  const openMasterTab = (tab: "category" | "source" | "department") => {
    setMasterTab(tab);
    setMasterOpen(true);
  };

  const deleteMaster = async (kind: "category" | "source" | "department", id: number, label: string) => {
    if (!window.confirm(`ยืนยันลบ${label}นี้? (ลบถาวร ใช้ได้เฉพาะรายการที่ไม่มีการใช้งานเท่านั้น)`)) return;
    try {
      if (kind === "category") await crmCashflowApi.deleteCategory(id);
      if (kind === "source") await crmCashflowApi.deleteSource(id);
      if (kind === "department") await crmCashflowApi.deleteDepartment(id);
      await loadMasters();
    } catch (requestError) { showError(errorMessage(requestError)); }
  };

  const previewFile = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportDuplicateAction("skip");
    try {
      const result = await crmCashflowApi.previewImport(importFile, headerRow, useExistingData);
      setImportPreview(result);
      // Default action is "skip", so tick every duplicate row upfront to match.
      setImportSkipRows(result.preview.filter((item) => item.duplicate_id).map((item) => item.row_number));
    } catch (requestError) { showError(errorMessage(requestError)); }
    finally { setImporting(false); }
  };

  const toggleImportSkipRow = (rowNumber: number, skip: boolean) => {
    setImportSkipRows((current) => skip
      ? [...current, rowNumber]
      : current.filter((number) => number !== rowNumber));
  };

  const changeImportDuplicateAction = (action: DuplicateAction) => {
    setImportDuplicateAction(action);
    // "ข้ามทั้งหมด" applies to every duplicate row anyway, so tick every
    // duplicate checkbox to match; switching away clears the auto-ticks
    // since update/create should act on the un-ticked rows.
    setImportSkipRows(
      action === "skip"
        ? (importPreview?.preview.filter((item) => item.duplicate_id).map((item) => item.row_number) ?? [])
        : []
    );
  };

  const importData = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const result = await crmCashflowApi.importFile(
        importFile, headerRow, useExistingData, importDuplicateAction, importSkipRows,
      );
      showNotice(
        `นำเข้าสำเร็จ ${result.imported} รายการ`
        + (result.updated ? `, อัปเดตรายการเดิม ${result.updated} รายการ` : "")
        + (result.skipped ? `, ข้าม ${result.skipped} รายการ` : "")
        + (result.errors ? `, ผิดพลาด ${result.errors} รายการ` : ""),
      );
      if (result.errors) {
        setImportPreview((current) => current ? {
          ...current, error_count: result.errors,
          error_rows: result.error_rows, error_details: result.error_details,
        } : current);
      } else {
        setImportOpen(false);
      }
      await Promise.all([loadMasters(), loadRows()]);
    } catch (requestError) { showError(errorMessage(requestError)); }
    finally { setImporting(false); }
  };

  // ── Attachment handlers ──────────────────────────────────────────────────
  const categoryName = useMemo(
    () => new Map(categories.map((item) => [item.cfcat_id, item.cfcat_name])), [categories],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="รายรับ-รายจ่าย (CRM)" description="รูปแบบการทำงานเดียวกับ crm-kawin พร้อมใช้ผู้ใช้งานและบริษัทของ acc-kawin">
        <Can menuKey={MENU_KEY} action="export">
          <Button variant="outline" onClick={() => crmCashflowApi.exportStatements({
            start_date: dateStart, end_date: dateEnd,
            cfcat_id: categoryFilter ? Number(categoryFilter) : undefined,
          })}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
        </Can>
        <Can menuKey={MENU_KEY} action="create">
          <Button variant="outline" onClick={() => { setImportPreview(null); setImportOpen(true); }}>
            <Import className="h-4 w-4" />Import
          </Button>
          <Button onClick={openEntry}><Plus className="h-4 w-4" />เพิ่มรายการ</Button>
        </Can>
      </PageHeader>

      {(notice || error) && (
        <div key={toastKey} className="fixed right-6 top-6 z-[100] animate-[toast-fade_4s_ease-in-out_forwards]">
          <div
            className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || notice}
          </div>
          <style>{`
            @keyframes toast-fade {
              0%   { opacity: 0; transform: translateY(-8px); }
              10%  { opacity: 1; transform: translateY(0); }
              85%  { opacity: 1; transform: translateY(0); }
              100% { opacity: 0; transform: translateY(-8px); }
            }
          `}</style>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-auto p-6">
        <Card><CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1 text-xs">วันที่เริ่มต้น<DatePicker value={dateStart} onChange={setDateStart} /></div>
          <div className="space-y-1 text-xs">วันที่สิ้นสุด<DatePicker value={dateEnd} onChange={setDateEnd} /></div>
          <div className="min-w-56 space-y-1 text-xs">หัวข้อ
            <Combobox
              className="h-9 bg-white text-sm"
              value={categoryFilter}
              onChange={setCategoryFilter}
              placeholder="ทั้งหมด"
              options={[{ value: "", label: "ทั้งหมด" }, ...activeCategories.map((item) => ({ value: String(item.cfcat_id), label: item.cfcat_name }))]}
            />
          </div>
          <Button variant="outline" onClick={loadRows}><RefreshCw className="h-4 w-4" />ดูรายงาน</Button>
          <Can menuKey={MENU_KEY} action="update">
            <Button variant="outline" onClick={() => setMasterOpen(true)}><Settings2 className="h-4 w-4" />จัดการข้อมูลตั้งต้น</Button>
          </Can>
        </CardContent></Card>

        <Card><CardContent className="overflow-x-auto pt-6">
          <table className="w-full min-w-[1180px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-xs">
              {['#','วันที่','หัวข้อ','แหล่งที่มา','รายละเอียด','ใบกำกับภาษี','ตรวจสอบแล้ว','คำนวณต้นทุน','ยอดรับ','ยอดจ่าย','แผนก','ผู้บันทึก','จัดการ'].map((head) => <th key={head} className="px-3 py-2">{head}</th>)}
            </tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.cfstate_id} className="border-b align-top">
              <td className="px-3 py-2">{index + 1}</td><td className="px-3 py-2">{formatDate(row.cfstate_date)}</td>
              <td className="px-3 py-2">{row.cfcat_name}</td><td className="px-3 py-2">{row.cflist_name}</td>
              <td className="max-w-56 whitespace-normal px-3 py-2">{row.cfstate_detail || "-"}</td>
              <td className="px-3 py-2"><InvoiceStatusBadge invoice={row.cfstate_invoice} /></td>
              <td className="px-3 py-2 text-center">{row.cfstate_verified === 1 && <Check className="mx-auto h-4 w-4 text-emerald-600" />}</td>
              <td className="px-3 py-2"><Switch checked={row.cfstate_refrain === 1} onCheckedChange={(checked) => updateFlag(row.cfstate_id, { cfstate_refrain: checked ? 1 : 0 })} /></td>
              <td className="px-3 py-2 text-right text-emerald-700">{row.cfstate_amount > 0 ? money(row.cfstate_amount) : "0.00"}</td>
              <td className="px-3 py-2 text-right text-red-700">{row.cfstate_amount < 0 ? money(row.cfstate_amount) : "0.00"}</td>
              <td className="px-3 py-2">{row.cfstate_dep_name || "-"}</td><td className="px-3 py-2">{row.user_name}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" title="รายละเอียด" onClick={() => openDetails(row)}>
                    <FileText className="h-4 w-4" />
                  </Button>
                  <Can menuKey={MENU_KEY} action="delete">
                    <Button size="icon" variant="destructive" onClick={() => removeStatement(row.cfstate_id)}><Trash2 className="h-4 w-4" /></Button>
                  </Can>
                </div>
              </td>
            </tr>)}</tbody>
            <tfoot><tr className="bg-muted/30 font-semibold"><td colSpan={7} className="px-3 py-3 text-center">รวม {rows.length} รายการ</td><td className="px-3 py-3 text-right text-emerald-700">{money(sumRevenue)}</td><td className="px-3 py-3 text-right text-red-700">{money(sumExpenses)}</td><td colSpan={3} /></tr></tfoot>
          </table>
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>}
          {!loading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">ไม่พบรายการ</p>}
        </CardContent></Card>
      </div>

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}><DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle>บันทึกรายรับ/รายจ่าย</DialogTitle><DialogDescription>เพิ่มหลายรายการเข้าชุด แล้วบันทึกพร้อมกัน</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3 p-6 text-sm md:grid-cols-4">
          <div>วันที่<DatePicker value={entryForm.cfstate_date} onChange={(value) => setEntryForm({ ...entryForm, cfstate_date: value })} /></div>
          <div><span className="flex items-center gap-1">แผนก<button type="button" onClick={() => openMasterTab("department")} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="จัดการแผนก"><Pencil className="h-3 w-3" /></button></span><Combobox
            className="mt-1 h-9"
            value={entryForm.cfstate_dep_id != null ? String(entryForm.cfstate_dep_id) : ""}
            onChange={(value) => setEntryForm({ ...entryForm, cfstate_dep_id: value ? Number(value) : null })}
            placeholder="เว้นว่าง"
            options={[{ value: "", label: "เว้นว่าง" }, ...activeDepartments.map((item) => ({ value: String(item.cfstate_dep_id), label: item.cfstate_dep_name }))]}
          /></div>
          <div><span className="flex items-center gap-1">หัวข้อ<button type="button" onClick={() => openMasterTab("category")} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="จัดการหัวข้อ"><Pencil className="h-3 w-3" /></button></span><Combobox
            className="mt-1 h-9"
            value={entryForm.cfcat_id ? String(entryForm.cfcat_id) : ""}
            onChange={(value) => changeEntryCategory(Number(value))}
            placeholder="เลือกหัวข้อ"
            options={[{ value: "", label: "เลือกหัวข้อ" }, ...activeCategories.map((item) => ({ value: String(item.cfcat_id), label: item.cfcat_name }))]}
          /></div>
          <div><span className="flex items-center gap-1">แหล่งที่มา<button type="button" onClick={() => openMasterTab("source")} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="จัดการแหล่งที่มา"><Pencil className="h-3 w-3" /></button></span><Combobox
            className="mt-1 h-9"
            value={entryForm.cflist_id ? String(entryForm.cflist_id) : ""}
            onChange={(value) => setEntryForm({ ...entryForm, cflist_id: Number(value) })}
            placeholder="เลือกแหล่งที่มา"
            options={[{ value: "", label: "เลือกแหล่งที่มา" }, ...formSources.map((item) => ({ value: String(item.cflist_id), label: item.cflist_name }))]}
          /></div>
          <div>ใบกำกับภาษี<Combobox
            className="mt-1 h-9"
            value={entryForm.cfstate_invoice == null ? "null" : String(entryForm.cfstate_invoice)}
            onChange={(value) => setEntryForm({ ...entryForm, cfstate_invoice: value === "null" ? null : Number(value) as 0 | 1 })}
            options={[{ value: "null", label: "ไม่มีใบกำกับ" }, { value: "0", label: "รอใบกำกับ" }, { value: "1", label: "ได้รับแล้ว" }]}
          /></div>
          <div>คำนวณต้นทุน<Combobox
            className="mt-1 h-9"
            value={String(entryForm.cfstate_refrain)}
            onChange={(value) => setEntryForm({ ...entryForm, cfstate_refrain: Number(value) as 0 | 1 })}
            options={[{ value: "1", label: "คำนวณต้นทุน" }, { value: "0", label: "ไม่คำนวณ" }]}
          /></div>
          <label>จำนวนเงิน (+รับ / -จ่าย)<Input value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="-1500.00" /></label>
          <label className="hidden">Ref<Input value={entryForm.cfstate_ref || ""} onChange={(e) => setEntryForm({ ...entryForm, cfstate_ref: e.target.value })} /></label>
          <label className="col-span-2 md:col-span-4">รายละเอียด<textarea className="mt-1 min-h-20 w-full rounded-md border px-3 py-2" value={entryForm.cfstate_detail || ""} onChange={(e) => setEntryForm({ ...entryForm, cfstate_detail: e.target.value })} /></label>
          <Button className="col-span-2 md:col-span-4" variant="outline" onClick={addDraft}><Plus className="h-4 w-4" />เพิ่มเข้าชุด</Button>
        </div>
        {drafts.length > 0 && <div className="mx-6 overflow-x-auto rounded-md border"><table className="w-full text-xs"><thead><tr className="bg-muted"><th className="p-2">วันที่</th><th>หัวข้อ</th><th>แหล่งที่มา</th><th>รายละเอียด</th><th>จำนวนเงิน</th><th /></tr></thead><tbody>{drafts.map((item, index) => <tr key={index} className="border-t"><td className="p-2">{formatDate(item.cfstate_date)}</td><td>{categoryName.get(item.cfcat_id)}</td><td>{sources.find((source) => source.cflist_id === item.cflist_id)?.cflist_name}</td><td>{item.cfstate_detail}</td><td className="text-right">{money(item.cfstate_amount)}</td><td className="p-1"><Button size="icon" variant="ghost" onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>}
        <DialogFooter><Button variant="outline" onClick={() => setEntryOpen(false)}>ยกเลิก</Button><Button disabled={!drafts.length || checkingDuplicates} onClick={confirmSaveDrafts}><Save className="h-4 w-4" />{checkingDuplicates ? "กำลังตรวจสอบ..." : `บันทึก ${drafts.length} รายการ`}</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={duplicateReviewOpen} onOpenChange={setDuplicateReviewOpen}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>พบรายการซ้ำ {duplicateCheck?.duplicates.length || 0} รายการ</DialogTitle><DialogDescription>ข้อมูลตรงกับรายการที่มีอยู่แล้วทุกช่อง (วันที่ หัวข้อ แหล่งที่มา จำนวนเงิน ฯลฯ) เลือกวิธีจัดการรายการซ้ำเหล่านี้</DialogDescription></DialogHeader>
        <div className="space-y-3 p-6">
          <div className="max-h-64 overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted"><th className="p-2 text-left">วันที่</th><th className="text-left">หัวข้อ</th><th className="text-left">รายละเอียด</th><th className="text-right">จำนวนเงิน</th></tr></thead>
              <tbody>{duplicateCheck?.duplicates.map((dup) => <tr key={dup.index} className="border-t"><td className="p-2">{formatDate(dup.item.cfstate_date)}</td><td>{categoryName.get(dup.item.cfcat_id)}</td><td>{dup.item.cfstate_detail}</td><td className="text-right">{money(dup.item.cfstate_amount)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">รายการที่เหลือ (ไม่ซ้ำ) จะถูกบันทึกตามปกติไม่ว่าจะเลือกวิธีใด</p>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDuplicateReviewOpen(false)}>ยกเลิก</Button>
          <Button variant="outline" onClick={() => saveDrafts("skip")}>ข้ามรายการซ้ำ</Button>
          <Button variant="outline" onClick={() => saveDrafts("update")}>อัปเดตรายการเดิม</Button>
          <Button onClick={() => saveDrafts("create")}>บันทึกซ้ำเป็นรายการใหม่</Button>
        </DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={masterOpen} onOpenChange={setMasterOpen}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>จัดการข้อมูลตั้งต้น</DialogTitle><DialogDescription>หัวข้อ แหล่งที่มา และแผนก ใช้ร่วมกับรายการทั้งหมด</DialogDescription></DialogHeader>
        <div className="space-y-4 p-6">
          <div className="flex gap-2">{([['category','หัวข้อ'],['source','แหล่งที่มา'],['department','แผนก']] as const).map(([key,label]) => <Button key={key} variant={masterTab === key ? "default" : "outline"} onClick={() => setMasterTab(key)}>{label}</Button>)}</div>
          <div className="flex gap-2">{masterTab === "source" && <Combobox
            className="h-9 w-56"
            value={masterCategoryId}
            onChange={setMasterCategoryId}
            placeholder="เลือกหัวข้อ"
            options={[{ value: "", label: "เลือกหัวข้อ" }, ...activeCategories.map((item) => ({ value: String(item.cfcat_id), label: item.cfcat_name }))]}
          />}<Input value={masterName} onChange={(e) => setMasterName(e.target.value)} placeholder={`เพิ่ม${masterTab === 'category' ? 'หัวข้อ' : masterTab === 'source' ? 'แหล่งที่มา' : 'แผนก'}`} /><Button onClick={addMaster}><Plus className="h-4 w-4" />เพิ่ม</Button></div>
          <div className="divide-y rounded-md border">
            {masterTab === "category" && categories.map((item) => <MasterRow key={item.cfcat_id} name={item.cfcat_name} active={item.cfcat_status} onEdit={() => editMaster("category", item.cfcat_id, item.cfcat_name)} onToggle={() => toggleMaster("category", item.cfcat_id, item.cfcat_status)} onDelete={() => deleteMaster("category", item.cfcat_id, "หัวข้อ")} />)}
            {masterTab === "department" && departments.map((item) => <MasterRow key={item.cfstate_dep_id} name={item.cfstate_dep_name} active={item.cfstate_dep_status} onEdit={() => editMaster("department", item.cfstate_dep_id, item.cfstate_dep_name)} onToggle={() => toggleMaster("department", item.cfstate_dep_id, item.cfstate_dep_status)} onDelete={() => deleteMaster("department", item.cfstate_dep_id, "แผนก")} />)}
            {masterTab === "source" && sources.map((item) => <MasterRow key={item.cflist_id} name={`${item.cflist_name} — ${categoryName.get(item.cfcat_id) || ''}`} active={item.cflist_status} onEdit={() => editMaster("source", item.cflist_id, item.cflist_name)} onToggle={() => toggleMaster("source", item.cflist_id, item.cflist_status)} onMove={() => moveSource(item)} onDelete={() => deleteMaster("source", item.cflist_id, "แหล่งที่มา")} />)}
          </div>
        </div>
      </DialogContent></Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>นำเข้ารายรับ/รายจ่าย</DialogTitle><DialogDescription>รองรับ CSV, XLSX, XLS ทั้งไฟล์เดิม 8 คอลัมน์และรูปแบบปัจจุบัน 10 คอลัมน์</DialogDescription></DialogHeader>
        <div className="space-y-4 p-6">
          <div className="space-y-1 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
            <p>คอลัมน์มาตรฐาน: วันที่, หัวข้อ, แหล่งที่มา, รายละเอียด, ใบกำกับภาษี, คำนวณต้นทุน, รายรับ, รายจ่าย, Ref, แผนก</p>
            <p className="font-medium">กรอกจำนวนเงินเพียงด้านเดียว: รายรับ 15,000 / รายจ่าย 0 หรือ รายรับ 0 / รายจ่าย -12,000</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => crmCashflowApi.downloadTemplate("xlsx")}><Download className="h-4 w-4" />Template XLSX</Button><Button variant="outline" onClick={() => crmCashflowApi.downloadTemplate("csv")}><Download className="h-4 w-4" />Template CSV</Button></div>
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => {
            setImportFile(e.target.files?.[0] || null);
            setImportPreview(null);
            setImportSkipRows([]);
            setImportDuplicateAction("skip");
          }} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} />ไฟล์มีแถวหัวตาราง</label>
          <div className="rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!useExistingData} onChange={(e) => { setUseExistingData(!e.target.checked); setImportPreview(null); }} />สร้างหัวข้อ แหล่งที่มา และแผนกที่ยังไม่มีให้อัตโนมัติ</label>
            <p className="mt-1 pl-5 text-xs text-muted-foreground">เปิดไว้สำหรับการนำเข้าครั้งแรก ระบบจะใช้ข้อมูลเดิมเมื่อชื่อซ้ำและสร้างเฉพาะรายการที่ยังไม่มี</p>
          </div>
          {importPreview && <div className="space-y-2"><p className="text-sm">ทั้งหมด {importPreview.total_rows} แถว / พบปัญหา {importPreview.error_count} แถว{importPreview.duplicate_count > 0 && ` / พบรายการซ้ำ ${importPreview.duplicate_count} แถว`}</p><div className="max-h-[50vh] overflow-auto rounded-md border"><table className="w-full min-w-[900px] text-xs"><thead><tr className="sticky top-0 z-10 bg-muted">{importPreview.headers.map((head) => <th key={head} className="p-2 text-left">{head}</th>)}<th>ผลตรวจ</th></tr></thead><tbody>{importPreview.preview.map((item) => <tr key={item.row_number} className="border-t"><td className="p-2">{item.data?.cfstate_date ? formatDate(item.data.cfstate_date) : ""}</td><td>{item.data?.category}</td><td>{item.data?.source}</td><td>{item.data?.detail}</td><td>{item.data?.invoice == null ? "ไม่มี" : item.data.invoice ? "ได้รับแล้ว" : "รอ"}</td><td>{item.data?.refrain ? "ON" : "OFF"}</td><td>{item.data?.income}</td><td>{item.data?.expense}</td><td>{item.data?.ref}</td><td>{item.data?.department}</td><td className={item.errors.length ? "text-red-600" : item.duplicate_id ? "text-amber-600" : "text-emerald-600"}>{item.errors.length ? item.errors.join(", ") : item.duplicate_id ? <label className="flex flex-col items-center gap-0.5"><span>ซ้ำกับ #{item.duplicate_id}</span><input type="checkbox" title="ข้ามแถวนี้" checked={importSkipRows.includes(item.row_number)} onChange={(e) => toggleImportSkipRow(item.row_number, e.target.checked)} /></label> : "ผ่าน"}</td></tr>)}</tbody></table></div>{importPreview.error_count > 0 && <Button variant="destructive" onClick={() => crmCashflowApi.downloadErrors(importPreview.error_rows, importPreview.error_details)}><Download className="h-4 w-4" />ดาวน์โหลดแถวผิดพลาด</Button>}
            {importPreview.duplicate_count > 0 && <div className="space-y-1 text-sm text-amber-800">
              <p>ติ๊กในคอลัมน์ "ผลตรวจ" = ข้ามแถวนั้น</p>
              <div className="flex flex-wrap items-center gap-2">แถวซ้ำที่ไม่ได้ติ๊ก:
                <Combobox
                  className="h-8 w-56"
                  value={importDuplicateAction}
                  onChange={(value) => changeImportDuplicateAction(value as DuplicateAction)}
                  options={[
                    { value: "skip", label: "ข้ามทั้งหมด (ไม่นำเข้า)" },
                    { value: "update", label: "อัปเดตรายการเดิม (ไม่สร้างซ้ำ)" },
                    { value: "create", label: "นำเข้าซ้ำ (สร้างรายการใหม่)" },
                  ]}
                />
              </div>
            </div>}
          </div>}
        </div>
        <DialogFooter><Button variant="outline" disabled={!importFile || importing} onClick={previewFile}>แสดงตัวอย่าง</Button><Button disabled={!importFile || !importPreview || importing} onClick={importData}>{importing ? "กำลังทำงาน..." : "นำเข้าข้อมูล"}</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={!!detailStatement} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent className="max-w-2xl border-0 bg-transparent p-0 pt-8 text-white shadow-none [&>button]:bg-black/50 [&>button]:p-1 [&>button]:opacity-100 [&>button]:hover:bg-black/70">
          <DialogTitle className="sr-only">ไฟล์แนบ</DialogTitle>
          <div className="max-h-[85vh] space-y-3 overflow-y-auto rounded-xl bg-white shadow-xl">
            {detailLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : detailAttachments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีไฟล์แนบ (แนบไฟล์ได้ที่หน้าติดตามใบกำกับภาษี)</p>
            ) : (
              detailAttachments.map((attachment) => (
                <div key={attachment.id}>
                  {!attachment.previewUrl ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">กำลังโหลดไฟล์...</p>
                  ) : attachment.content_type.startsWith("image/") ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file_name}
                      className="mx-auto max-h-[70vh] rounded-lg border object-contain"
                    />
                  ) : attachment.content_type === "application/pdf" ? (
                    <iframe
                      src={attachment.previewUrl}
                      title={attachment.file_name}
                      className="h-[70vh] w-full rounded-lg border"
                    />
                  ) : (
                    <p className="py-4 text-center text-xs text-muted-foreground">ไม่สามารถแสดงไฟล์ประเภทนี้ได้</p>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MasterRow({ name, active, onEdit, onToggle, onMove, onDelete }: {
  name: string; active: number; onEdit: () => void; onToggle: () => void;
  onMove?: () => void; onDelete?: () => void;
}) {
  return <div className="flex items-center gap-2 px-3 py-2 text-sm"><span className={`flex-1 ${active ? "" : "text-muted-foreground line-through"}`}>{name}</span><Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={onToggle}>{active ? "ปิด" : "เปิด"}</Button>{onDelete && <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</div>;
}