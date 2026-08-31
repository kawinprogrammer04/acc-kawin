import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle, ArrowUpCircle, Check, CheckCircle2, Clock3, Download,
  Eraser, FileSpreadsheet, Import, Paperclip, Pencil, Plus, Save,
  Settings2, Trash2, Upload, X,
} from "lucide-react";

import {
  crmCashflowApi,
  IMPORT_FIELD_LABELS,
  type CheckDuplicatesResult,
  type CrmCashflowAttachment,
  type CrmCashflowCategory,
  type CrmCashflowDashboardSummary,
  type CrmCashflowDepartment,
  type CrmCashflowImportTemplate,
  type CrmCashflowInvoiceStatus,
  type CrmCashflowSource,
  type CrmCashflowStatement,
  type CrmCashflowStatementFilters,
  type CrmCashflowVerificationStatus,
  type CrmStatementInput,
  type DuplicateAction,
  type ImportPreview,
  type ImportTemplateColumn,
} from "@/api/crmCashflow";
import { Can } from "@/components/auth/RequirePermission";
import { DataListFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListKpiCard } from "@/components/data-list/DataListKpiCard";
import { DataListPagination } from "@/components/data-list/DataListPagination";
import { PresetDateRangeFilter } from "@/components/data-list/PresetDateRangeFilter";
import {
  dataListTableHeaderCellClass,
  dataListTableScrollClass,
} from "@/components/data-list/styles";
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
import { formatDate, today } from "@/lib/format";
import { cn } from "@/lib/utils";

const MENU_KEY = "crm_cashflow_statement";
const DEFAULT_PAGE_SIZE = 25;
const money = (value: number) => new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
const displayCrmTerms = (value: string) => value
  .replace(/รายละเอียด/g, "Description")
  .replace(/แหล่งที่มา/g, "note");

const emptyDashboard: CrmCashflowDashboardSummary = {
  sum_revenue: 0,
  sum_expenses: 0,
  verified_count: 0,
  pending_count: 0,
  verified_revenue: 0,
  verified_expenses: 0,
  pending_revenue: 0,
  pending_expenses: 0,
};

function errorMessage(error: any) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return displayCrmTerms(detail);
  if (Array.isArray(detail)) return displayCrmTerms(detail.map((item) => item.msg).join(", "));
  return displayCrmTerms(error?.message || "เกิดข้อผิดพลาด");
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

// ── Import templates ─────────────────────────────────────────────────────────
// Draft state for the template editor — mirrors ImportTemplateInput but keeps
// the row's own id (null while creating) so save() knows create vs. update.
interface TemplateDraft {
  id: number | null;
  name: string;
  headerRow: boolean;
  columns: ImportTemplateColumn[];
}
const DEFAULT_TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { field: "date", label: IMPORT_FIELD_LABELS.date, column: "" },
  { field: "category", label: IMPORT_FIELD_LABELS.category, column: "" },
  { field: "source", label: IMPORT_FIELD_LABELS.source, column: "" },
  { field: "detail", label: IMPORT_FIELD_LABELS.detail, column: "" },
  { field: "refrain", label: IMPORT_FIELD_LABELS.refrain, column: "" },
  { field: "income", label: IMPORT_FIELD_LABELS.income, column: "" },
  { field: "expense", label: IMPORT_FIELD_LABELS.expense, column: "" },
  { field: "amount", label: IMPORT_FIELD_LABELS.amount, column: "" },
  { field: "ref", label: IMPORT_FIELD_LABELS.ref, column: "" },
  { field: "department", label: IMPORT_FIELD_LABELS.department, column: "" },
];

const excelColumnName = (position: number) => {
  let value = position;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

export function CrmCashflowStatementPage() {
  const [categories, setCategories] = useState<CrmCashflowCategory[]>([]);
  const [sources, setSources] = useState<CrmCashflowSource[]>([]);
  const [departments, setDepartments] = useState<CrmCashflowDepartment[]>([]);
  const [rows, setRows] = useState<CrmCashflowStatement[]>([]);
  const [sumRevenue, setSumRevenue] = useState(0);
  const [sumExpenses, setSumExpenses] = useState(0);
  const [dashboard, setDashboard] = useState<CrmCashflowDashboardSummary>(emptyDashboard);
  const [dateStart, setDateStart] = useState(today());
  const [dateEnd, setDateEnd] = useState(today());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [verificationFilter, setVerificationFilter] = useState<"" | CrmCashflowVerificationStatus>("");
  const [invoiceFilter, setInvoiceFilter] = useState<"" | CrmCashflowInvoiceStatus>("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [downloadingFiles, setDownloadingFiles] = useState(false);
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
  const [importTemplates, setImportTemplates] = useState<CrmCashflowImportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Attachment manager for the selected statement.
  const [detailStatement, setDetailStatement] = useState<CrmCashflowStatement | null>(null);
  const [detailAttachments, setDetailAttachments] = useState<(CrmCashflowAttachment & { previewUrl?: string })[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailUploading, setDetailUploading] = useState(false);
  const [detailDeletingId, setDetailDeletingId] = useState<string | null>(null);

  const activeCategories = categories.filter((item) => item.cfcat_status === 1);
  const activeDepartments = departments.filter((item) => item.cfstate_dep_status === 1);
  const formSources = sources.filter(
    (item) => item.cflist_status === 1 && item.cfcat_id === entryForm.cfcat_id && item.cflist_hide == null,
  );

  const statementFilters = useMemo<CrmCashflowStatementFilters>(() => ({
    start_date: dateStart || undefined,
    end_date: dateEnd || undefined,
    cfcat_id: categoryFilter ? Number(categoryFilter) : undefined,
    verification_status: verificationFilter || undefined,
    invoice_status: invoiceFilter || undefined,
  }), [dateStart, dateEnd, categoryFilter, verificationFilter, invoiceFilter]);

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

  const loadImportTemplates = useCallback(async () => {
    try {
      setImportTemplates(await crmCashflowApi.importTemplates());
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await crmCashflowApi.statements({
        ...statementFilters,
        page,
        page_size: pageSize,
      });
      setRows(result.items);
      setTotal(result.total);
      setSumRevenue(result.sum_revenue);
      setSumExpenses(result.sum_expenses);
      setDashboard(result.dashboard ?? emptyDashboard);
      setUpdatedAt(new Date());
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [statementFilters, page, pageSize]);

  useEffect(() => {
    loadMasters().catch((requestError) => showError(errorMessage(requestError)));
  }, [loadMasters]);
  useEffect(() => { loadRows(); }, [loadRows]);
  useEffect(() => { loadImportTemplates(); }, [loadImportTemplates]);

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
      showError("กรุณาเลือกหัวข้อ note และระบุจำนวนเงินให้ถูกต้อง");
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

  const uploadDetailAttachment = async (file: File | null) => {
    if (!detailStatement || !file) return;
    if (detailAttachments.length >= 2) {
      showError("แต่ละรายการแนบได้สูงสุด 2 ไฟล์ กรุณาลบไฟล์เดิมก่อน");
      return;
    }
    setDetailUploading(true);
    try {
      const uploaded = await crmCashflowApi.uploadAttachment(detailStatement.cfstate_id, file);
      let previewUrl: string | undefined;
      try {
        const blob = await crmCashflowApi.openAttachment(detailStatement.cfstate_id, uploaded.id);
        previewUrl = URL.createObjectURL(blob);
      } catch {
        // The file is still uploaded successfully even if its inline preview fails.
      }
      setDetailAttachments((current) => [...current, { ...uploaded, previewUrl }]);
      setRows((current) => current.map((row) => row.cfstate_id === detailStatement.cfstate_id
        ? { ...row, attachment_count: row.attachment_count + 1 }
        : row));
      setDetailStatement((current) => current
        ? { ...current, attachment_count: current.attachment_count + 1 }
        : current);
      showNotice("อัปโหลดไฟล์แนบสำเร็จ");
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setDetailUploading(false);
    }
  };

  const deleteDetailAttachment = async (attachmentId: string) => {
    if (!detailStatement || !window.confirm("ยืนยันการลบไฟล์แนบนี้?")) return;
    setDetailDeletingId(attachmentId);
    try {
      await crmCashflowApi.deleteAttachment(detailStatement.cfstate_id, attachmentId);
      setDetailAttachments((current) => {
        const removed = current.find((attachment) => attachment.id === attachmentId);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        return current.filter((attachment) => attachment.id !== attachmentId);
      });
      setRows((current) => current.map((row) => row.cfstate_id === detailStatement.cfstate_id
        ? { ...row, attachment_count: Math.max(0, row.attachment_count - 1) }
        : row));
      setDetailStatement((current) => current
        ? { ...current, attachment_count: Math.max(0, current.attachment_count - 1) }
        : current);
      showNotice("ลบไฟล์แนบแล้ว");
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setDetailDeletingId(null);
    }
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
    const targetSource = window.prompt("รหัส note ปลายทาง (เว้นว่างเพื่อสร้างใหม่)", "");
    let payload: { new_cfcat_id: number; new_cflist_id?: number; new_list_name?: string } = {
      new_cfcat_id: Number(targetCategory),
    };
    if (targetSource) payload.new_cflist_id = Number(targetSource);
    else {
      const newName = window.prompt("ชื่อ note ใหม่", source.cflist_name)?.trim();
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
      const result = await crmCashflowApi.previewImport(
        importFile, headerRow, useExistingData,
        selectedTemplateId ? Number(selectedTemplateId) : undefined,
      );
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
        selectedTemplateId ? Number(selectedTemplateId) : undefined,
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

  // ── Import template handlers ──────────────────────────────────────────────
  const selectImportTemplate = (value: string) => {
    setSelectedTemplateId(value);
    setImportPreview(null);
    const template = importTemplates.find((item) => String(item.cfimptpl_id) === value);
    if (template) setHeaderRow(template.cfimptpl_header_row);
  };

  // Downloads a blank file laid out like whichever template is currently
  // selected — the standard 10-column layout when none is picked.
  const downloadCurrentTemplate = async (format: "xlsx" | "csv") => {
    try {
      if (selectedTemplateId) {
        await crmCashflowApi.downloadImportTemplateFile(Number(selectedTemplateId), format);
      } else {
        await crmCashflowApi.downloadTemplate(format);
      }
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  const downloadTemplateDraft = async (format: "xlsx" | "csv") => {
    if (!templateDraft?.id) return;
    try {
      await crmCashflowApi.downloadImportTemplateFile(templateDraft.id, format);
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  const startNewTemplate = () => {
    setTemplateDraft({
      id: null, name: "", headerRow: true,
      columns: DEFAULT_TEMPLATE_COLUMNS.map((column) => ({ ...column })),
    });
  };

  const loadTemplateIntoEditor = (template: CrmCashflowImportTemplate) => {
    const mappedColumns = new Map(template.cfimptpl_columns.map((column, index) => [
      column.field,
      Object.prototype.hasOwnProperty.call(column, "column")
        ? column.column || ""
        : excelColumnName(index + 1),
    ]));
    setTemplateDraft({
      id: template.cfimptpl_id,
      name: template.cfimptpl_name,
      headerRow: template.cfimptpl_header_row,
      columns: DEFAULT_TEMPLATE_COLUMNS.map((column) => ({
        ...column, column: mappedColumns.get(column.field) || "",
      })),
    });
  };

  const updateTemplateColumn = (index: number, patch: Partial<ImportTemplateColumn>) => {
    setTemplateDraft((current) => current ? {
      ...current,
      columns: current.columns.map((column, columnIndex) => (
        columnIndex === index ? { ...column, ...patch } : column
      )),
    } : current);
  };

  const saveTemplate = async () => {
    if (!templateDraft) return;
    if (!templateDraft.name.trim()) { showError("กรุณาระบุชื่อเทมเพลต"); return; }
    if (!templateDraft.columns.length) { showError("กรุณาเพิ่มอย่างน้อย 1 คอลัมน์"); return; }
    setSavingTemplate(true);
    try {
      const payload = {
        cfimptpl_name: templateDraft.name.trim(),
        cfimptpl_header_row: templateDraft.headerRow,
        cfimptpl_columns: templateDraft.columns.map((column) => ({
          field: column.field,
          label: IMPORT_FIELD_LABELS[column.field],
          column: column.column?.trim().toUpperCase() || null,
        })),
      };
      const saved = templateDraft.id
        ? await crmCashflowApi.updateImportTemplate(templateDraft.id, payload)
        : await crmCashflowApi.createImportTemplate(payload);
      await loadImportTemplates();
      setTemplateDraft(null);
      setSelectedTemplateId(String(saved.cfimptpl_id));
      setHeaderRow(saved.cfimptpl_header_row);
      showNotice("บันทึกเทมเพลตแล้ว");
    } catch (requestError) {
      showError(errorMessage(requestError));
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplateDraft = async () => {
    if (!templateDraft?.id) return;
    if (!window.confirm("ยืนยันการลบเทมเพลตนี้?")) return;
    try {
      await crmCashflowApi.deleteImportTemplate(templateDraft.id);
      await loadImportTemplates();
      if (selectedTemplateId === String(templateDraft.id)) setSelectedTemplateId("");
      setTemplateDraft(null);
      showNotice("ลบเทมเพลตแล้ว");
    } catch (requestError) {
      showError(errorMessage(requestError));
    }
  };

  // ── Attachment handlers ──────────────────────────────────────────────────
  const categoryName = useMemo(
    () => new Map(categories.map((item) => [item.cfcat_id, item.cfcat_name])), [categories],
  );

  useEffect(() => {
    const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, total]);

  const changeDateRange = (from: string, to: string) => {
    setPage(1);
    setDateStart(from);
    setDateEnd(to);
  };

  const resetFilters = () => {
    const currentDay = today();
    setPage(1);
    setDateStart(currentDay);
    setDateEnd(currentDay);
    setCategoryFilter("");
    setVerificationFilter("");
    setInvoiceFilter("");
  };

  const downloadStatementFiles = async () => {
    setDownloadingFiles(true);
    try {
      await crmCashflowApi.exportStatementFiles(statementFilters);
      showNotice("ดาวน์โหลด ZIP ไฟล์แนบเรียบร้อยแล้ว");
    } catch (requestError: any) {
      if (requestError?.response?.status === 404) {
        showError("ไม่พบไฟล์รูปภาพหรือ PDF ตามตัวกรองที่เลือก");
      } else {
        showError(errorMessage(requestError));
      }
    } finally {
      setDownloadingFiles(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="รายรับ-รายจ่าย (CRM)" description="รูปแบบการทำงานเดียวกับ crm-kawin พร้อมใช้ผู้ใช้งานและบริษัทของ acc-kawin">
        <Can menuKey={MENU_KEY} action="export">
          <Button variant="outline" onClick={() => crmCashflowApi.exportStatements(statementFilters)}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
          <Button variant="outline" onClick={downloadStatementFiles} disabled={downloadingFiles}>
            <Download className="h-4 w-4" />{downloadingFiles ? "กำลังสร้าง ZIP..." : "Export ไฟล์แนบ"}
          </Button>
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

      <div className="flex-1 space-y-6 overflow-auto p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Dashboard รายรับ-รายจ่าย">
          <DataListKpiCard label="ยอดรายรับ" value={dashboard.sum_revenue} currency tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-950" icon={ArrowUpCircle} />
          <DataListKpiCard label="ยอดรายจ่าย" value={dashboard.sum_expenses} currency tone="bg-rose-100 text-rose-700 dark:bg-rose-950" icon={ArrowDownCircle} />
          <DataListKpiCard label="ตรวจสอบแล้ว" value={dashboard.verified_count} tone="bg-blue-100 text-blue-700 dark:bg-blue-950" icon={CheckCircle2} />
          <DataListKpiCard label="ยังไม่ตรวจสอบ" value={dashboard.pending_count} tone="bg-amber-100 text-amber-700 dark:bg-amber-950" icon={Clock3} />
        </div>

        <form onSubmit={(event) => event.preventDefault()} className="relative z-30 space-y-5 rounded-2xl border bg-card/80 p-6 shadow-lg backdrop-blur-xl">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <PresetDateRangeFilter dateFrom={dateStart} dateTo={dateEnd} onChange={changeDateRange} />
            <DataListFilterSelect
              label="หัวข้อ"
              value={categoryFilter}
              allLabel="ทุกหัวข้อ"
              options={activeCategories.map((item) => ({ value: String(item.cfcat_id), label: item.cfcat_name }))}
              onChange={(value) => { setPage(1); setCategoryFilter(value); }}
            />
            <DataListFilterSelect
              label="การตรวจสอบ"
              value={verificationFilter}
              allLabel="ทุกสถานะ"
              options={[{ value: "pending", label: "รอตรวจสอบ" }, { value: "verified", label: "ตรวจสอบแล้ว" }]}
              onChange={(value) => { setPage(1); setVerificationFilter(value as "" | CrmCashflowVerificationStatus); }}
            />
            <DataListFilterSelect
              label="ใบกำกับภาษี"
              value={invoiceFilter}
              allLabel="ทุกสถานะ"
              options={[
                { value: "none", label: "ยังไม่ระบุ" },
                { value: "pending", label: "รอใบกำกับ" },
                { value: "received", label: "ได้รับแล้ว" },
                { value: "tax_invoice", label: "ใบกำกับภาษี" },
                { value: "cash_bill", label: "บิลเงินสด" },
                { value: "other", label: "อื่นๆ" },
              ]}
              onChange={(value) => { setPage(1); setInvoiceFilter(value as "" | CrmCashflowInvoiceStatus); }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <span className="text-xs font-bold text-muted-foreground">ตัวกรองทำงานอัตโนมัติเมื่อเลือกข้อมูล</span>
            <div className="flex flex-wrap items-center gap-2">
              <Can menuKey={MENU_KEY} action="update">
                <Button type="button" variant="outline" onClick={() => setMasterOpen(true)}><Settings2 className="h-4 w-4" />จัดการข้อมูลตั้งต้น</Button>
              </Can>
              <Button type="button" variant="outline" onClick={resetFilters} className="text-muted-foreground hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Eraser className="h-4 w-4" />ล้างตัวกรอง</Button>
            </div>
          </div>
        </form>

        <Card className="overflow-hidden"><CardContent className="p-0"><div className={dataListTableScrollClass}>
          <table className="w-full min-w-[1510px] table-fixed border-separate border-spacing-0 text-sm">
            <thead><tr className="text-left text-xs">
              {[
                ['#', 50], ['วันที่', 90], ['หัวข้อ', 110], ['Description', 220], ['note', 140], ['หมายเหตุ', 140],
                ['ใบกำกับภาษี', 110], ['ตรวจสอบแล้ว', 90], ['คำนวณต้นทุน', 100], ['ยอดรับ', 100],
                ['ยอดจ่าย', 100], ['แผนก', 80], ['ผู้บันทึก', 100], ['จัดการ', 90],
              ].map(([head, width], index) => (
                <th
                  key={head}
                  style={{ width }}
                  className={`${dataListTableHeaderCellClass} px-3 py-3 ${[9, 10].includes(index) ? "text-right" : index === 7 ? "text-center" : "text-left"}`}
                >
                  {head}
                </th>
              ))}
            </tr></thead>
            <tbody className="divide-y">
              {loading && <tr><td colSpan={14} className="px-4 py-12 text-center text-sm text-muted-foreground">กำลังโหลด...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={14} className="px-4 py-12 text-center text-sm text-muted-foreground">ไม่พบรายการตามตัวกรอง</td></tr>}
              {!loading && rows.map((row, index) => <tr key={row.cfstate_id} className="align-top hover:bg-muted/40">
              <td className="px-3 py-2">{pageSize === 0 ? index + 1 : ((page - 1) * pageSize) + index + 1}</td><td className="px-3 py-2">{formatDate(row.cfstate_date)}</td>
              <td className="px-3 py-2">{row.cfcat_name}</td>
              <td className="max-w-56 whitespace-normal px-3 py-2">{row.cfstate_detail || "-"}</td>
              <td className="px-3 py-2">{row.cflist_name}</td>
              <td className="px-3 py-2">{row.cfstate_note || "-"}</td>
              <td className="px-3 py-2"><InvoiceStatusBadge invoice={row.cfstate_invoice} documentType={row.cfstate_document_type} /></td>
              <td className="px-3 py-2 text-center">{row.cfstate_verified === 1 && <Check className="mx-auto h-4 w-4 text-emerald-600" />}</td>
              <td className="px-3 py-2"><Switch checked={row.cfstate_refrain === 1} onCheckedChange={(checked) => updateFlag(row.cfstate_id, { cfstate_refrain: checked ? 1 : 0 })} /></td>
              <td className="px-3 py-2 text-right text-emerald-700">{row.cfstate_amount > 0 ? money(row.cfstate_amount) : "0.00"}</td>
              <td className="px-3 py-2 text-right text-red-700">{row.cfstate_amount < 0 ? money(row.cfstate_amount) : "0.00"}</td>
              <td className="px-3 py-2">{row.cfstate_dep_name || "-"}</td><td className="px-3 py-2">{row.user_name}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 px-2"
                    title="ไฟล์แนบ"
                    onClick={() => openDetails(row)}
                  >
                    <Paperclip className="h-4 w-4" />
                    <span className="text-xs">{row.attachment_count}</span>
                  </Button>
                  <Can menuKey={MENU_KEY} action="delete">
                    <Button size="icon" variant="destructive" onClick={() => removeStatement(row.cfstate_id)}><Trash2 className="h-4 w-4" /></Button>
                  </Can>
                </div>
              </td>
            </tr>)}</tbody>
            <tfoot><tr className="bg-muted/30 font-semibold"><td colSpan={9} className="px-3 py-3 text-center">รวมทั้งหมด {total.toLocaleString("th-TH")} รายการ</td><td className="px-3 py-3 text-right text-emerald-700">{money(sumRevenue)}</td><td className="px-3 py-3 text-right text-red-700">{money(sumExpenses)}</td><td colSpan={3} /></tr></tfoot>
          </table>
        </div></CardContent></Card>

        <DataListPagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(value) => { setPage(1); setPageSize(value); }}
          updatedAt={updatedAt}
        />
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
          <div><span className="flex items-center gap-1">note<button type="button" onClick={() => openMasterTab("source")} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="จัดการ note"><Pencil className="h-3 w-3" /></button></span><Combobox
            className="mt-1 h-9"
            value={entryForm.cflist_id ? String(entryForm.cflist_id) : ""}
            onChange={(value) => setEntryForm({ ...entryForm, cflist_id: Number(value) })}
            placeholder="เลือก note"
            options={[{ value: "", label: "เลือก note" }, ...formSources.map((item) => ({ value: String(item.cflist_id), label: item.cflist_name }))]}
          /></div>
          <div>ใบกำกับภาษี<Combobox
            className="mt-1 h-9"
            value={entryForm.cfstate_invoice == null ? "null" : String(entryForm.cfstate_invoice)}
            onChange={(value) => setEntryForm({ ...entryForm, cfstate_invoice: value === "null" ? null : Number(value) as 0 | 1 })}
            options={[{ value: "null", label: "ยังไม่ระบุ" }, { value: "0", label: "รอใบกำกับ" }, { value: "1", label: "ได้รับแล้ว" }]}
          /></div>
          <div>คำนวณต้นทุน<Combobox
            className="mt-1 h-9"
            value={String(entryForm.cfstate_refrain)}
            onChange={(value) => setEntryForm({ ...entryForm, cfstate_refrain: Number(value) as 0 | 1 })}
            options={[{ value: "1", label: "คำนวณต้นทุน" }, { value: "0", label: "ไม่คำนวณ" }]}
          /></div>
          <label>จำนวนเงิน (+รับ / -จ่าย)<Input value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="-1500.00" /></label>
          <label className="hidden">Ref<Input value={entryForm.cfstate_ref || ""} onChange={(e) => setEntryForm({ ...entryForm, cfstate_ref: e.target.value })} /></label>
          <label className="col-span-2 md:col-span-4">Description<textarea className="mt-1 min-h-20 w-full rounded-md border px-3 py-2" value={entryForm.cfstate_detail || ""} onChange={(e) => setEntryForm({ ...entryForm, cfstate_detail: e.target.value })} /></label>
          <Button className="col-span-2 md:col-span-4" variant="outline" onClick={addDraft}><Plus className="h-4 w-4" />เพิ่มเข้าชุด</Button>
        </div>
        {drafts.length > 0 && <div className="mx-6 overflow-x-auto rounded-md border"><table className="w-full text-xs"><thead><tr className="bg-muted"><th className="p-2">วันที่</th><th>หัวข้อ</th><th>note</th><th>Description</th><th>จำนวนเงิน</th><th /></tr></thead><tbody>{drafts.map((item, index) => <tr key={index} className="border-t"><td className="p-2">{formatDate(item.cfstate_date)}</td><td>{categoryName.get(item.cfcat_id)}</td><td>{sources.find((source) => source.cflist_id === item.cflist_id)?.cflist_name}</td><td>{item.cfstate_detail}</td><td className="text-right">{money(item.cfstate_amount)}</td><td className="p-1"><Button size="icon" variant="ghost" onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>}
        <DialogFooter><Button variant="outline" onClick={() => setEntryOpen(false)}>ยกเลิก</Button><Button disabled={!drafts.length || checkingDuplicates} onClick={confirmSaveDrafts}><Save className="h-4 w-4" />{checkingDuplicates ? "กำลังตรวจสอบ..." : `บันทึก ${drafts.length} รายการ`}</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={duplicateReviewOpen} onOpenChange={setDuplicateReviewOpen}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>พบรายการซ้ำ {duplicateCheck?.duplicates.length || 0} รายการ</DialogTitle><DialogDescription>ข้อมูลตรงกับรายการที่มีอยู่แล้วทุกช่อง (วันที่ หัวข้อ note จำนวนเงิน ฯลฯ) เลือกวิธีจัดการรายการซ้ำเหล่านี้</DialogDescription></DialogHeader>
        <div className="space-y-3 p-6">
          <div className="max-h-64 overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead><tr className="bg-muted"><th className="p-2 text-left">วันที่</th><th className="text-left">หัวข้อ</th><th className="text-left">Description</th><th className="text-right">จำนวนเงิน</th></tr></thead>
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
        <DialogHeader><DialogTitle>จัดการข้อมูลตั้งต้น</DialogTitle><DialogDescription>หัวข้อ note และแผนก ใช้ร่วมกับรายการทั้งหมด</DialogDescription></DialogHeader>
        <div className="space-y-4 p-6">
          <div className="flex gap-2">{([['category','หัวข้อ'],['source','note'],['department','แผนก']] as const).map(([key,label]) => <Button key={key} variant={masterTab === key ? "default" : "outline"} onClick={() => setMasterTab(key)}>{label}</Button>)}</div>
          <div className="flex gap-2">{masterTab === "source" && <Combobox
            className="h-9 w-56"
            value={masterCategoryId}
            onChange={setMasterCategoryId}
            placeholder="เลือกหัวข้อ"
            options={[{ value: "", label: "เลือกหัวข้อ" }, ...activeCategories.map((item) => ({ value: String(item.cfcat_id), label: item.cfcat_name }))]}
          />}<Input value={masterName} onChange={(e) => setMasterName(e.target.value)} placeholder={`เพิ่ม${masterTab === 'category' ? 'หัวข้อ' : masterTab === 'source' ? 'note' : 'แผนก'}`} /><Button onClick={addMaster}><Plus className="h-4 w-4" />เพิ่ม</Button></div>
          <div className="divide-y rounded-md border">
            {masterTab === "category" && categories.map((item) => <MasterRow key={item.cfcat_id} name={item.cfcat_name} active={item.cfcat_status} onEdit={() => editMaster("category", item.cfcat_id, item.cfcat_name)} onToggle={() => toggleMaster("category", item.cfcat_id, item.cfcat_status)} onDelete={() => deleteMaster("category", item.cfcat_id, "หัวข้อ")} />)}
            {masterTab === "department" && departments.map((item) => <MasterRow key={item.cfstate_dep_id} name={item.cfstate_dep_name} active={item.cfstate_dep_status} onEdit={() => editMaster("department", item.cfstate_dep_id, item.cfstate_dep_name)} onToggle={() => toggleMaster("department", item.cfstate_dep_id, item.cfstate_dep_status)} onDelete={() => deleteMaster("department", item.cfstate_dep_id, "แผนก")} />)}
            {masterTab === "source" && sources.map((item) => <MasterRow key={item.cflist_id} name={`${item.cflist_name} — ${categoryName.get(item.cfcat_id) || ''}`} active={item.cflist_status} onEdit={() => editMaster("source", item.cflist_id, item.cflist_name)} onToggle={() => toggleMaster("source", item.cflist_id, item.cflist_status)} onMove={() => moveSource(item)} onDelete={() => deleteMaster("source", item.cflist_id, "note")} />)}
          </div>
        </div>
      </DialogContent></Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>นำเข้ารายรับ/รายจ่าย</DialogTitle><DialogDescription>รองรับ CSV, XLSX, XLS ทั้งไฟล์เดิม 8 คอลัมน์และรูปแบบปัจจุบัน 10 คอลัมน์</DialogDescription></DialogHeader>
        <div className="space-y-4 p-6">
          <div className="space-y-1 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
            <p>คอลัมน์มาตรฐาน: วันที่, หัวข้อ, note, Description, ใบกำกับภาษี, คำนวณต้นทุน, รายรับ, รายจ่าย, Ref, แผนก</p>
            <p className="font-medium">กรอกจำนวนเงินเพียงด้านเดียว: รายรับ 15,000 / รายจ่าย 0 หรือ รายรับ 0 / รายจ่าย 12,000 — ไม่ต้องใส่เครื่องหมายลบ</p>
            <p>เว้น note ได้ ระบบจะบันทึกเป็น “ไม่ระบุ” ให้อัตโนมัติ</p>
            <p>รายการที่นำเข้าจะเว้นคอลัมน์ใบกำกับภาษีไว้ก่อน เพื่อรอตรวจสอบและเลือกประเภทเอกสารภายหลัง</p>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <label className="min-w-56 flex-1 space-y-1 text-xs">รูปแบบเทมเพลต (คอลัมน์ในไฟล์)
              <select
                className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                value={selectedTemplateId}
                onChange={(e) => selectImportTemplate(e.target.value)}
              >
                <option value="">มาตรฐาน (ตรวจจับอัตโนมัติ)</option>
                {importTemplates.map((tpl) => (
                  <option key={tpl.cfimptpl_id} value={tpl.cfimptpl_id}>{tpl.cfimptpl_name}</option>
                ))}
              </select>
            </label>
            <Button variant="outline" size="sm" onClick={() => downloadCurrentTemplate("xlsx")}>
              <Download className="h-4 w-4" />ดาวน์โหลด XLSX
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadCurrentTemplate("csv")}>
              <Download className="h-4 w-4" />ดาวน์โหลด CSV
            </Button>
            <Can menuKey={MENU_KEY} action="update">
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => { setTemplateDraft(null); setTemplateManagerOpen(true); }}
              >
                <Settings2 className="h-4 w-4" />จัดการเทมเพลต
              </Button>
            </Can>
          </div>
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => {
            setImportFile(e.target.files?.[0] || null);
            setImportPreview(null);
            setImportSkipRows([]);
            setImportDuplicateAction("skip");
          }} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} />ไฟล์มีแถวหัวตาราง</label>
          <div className="rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!useExistingData} onChange={(e) => { setUseExistingData(!e.target.checked); setImportPreview(null); }} />สร้างหัวข้อ note และแผนกที่ยังไม่มีให้อัตโนมัติ</label>
            <p className="mt-1 pl-5 text-xs text-muted-foreground">เปิดไว้สำหรับการนำเข้าครั้งแรก ระบบจะใช้ข้อมูลเดิมเมื่อชื่อซ้ำและสร้างเฉพาะรายการที่ยังไม่มี</p>
          </div>
          {importPreview && <div className="space-y-2"><p className="text-sm">ทั้งหมด {importPreview.total_rows} แถว / พบปัญหา {importPreview.error_count} แถว{importPreview.duplicate_count > 0 && ` / พบรายการซ้ำ ${importPreview.duplicate_count} แถว`}</p><div className="max-h-[50vh] overflow-auto rounded-md border"><table className="w-full min-w-[900px] text-xs"><thead><tr className="sticky top-0 z-10 bg-muted">{[importPreview.headers[0], importPreview.headers[1], importPreview.headers[3], importPreview.headers[2], ...importPreview.headers.slice(4)].map((head) => <th key={head} className="p-2 text-left">{displayCrmTerms(head)}</th>)}<th>ผลตรวจ</th></tr></thead><tbody>{importPreview.preview.map((item) => <tr key={item.row_number} className="border-t"><td className="p-2">{item.data?.cfstate_date ? formatDate(item.data.cfstate_date) : ""}</td><td>{item.data?.category}</td><td>{item.data?.detail}</td><td>{item.data?.source}</td><td>{item.data?.invoice == null ? "" : item.data.invoice ? "ได้รับแล้ว" : "รอ"}</td><td>{item.data?.refrain ? "ON" : "OFF"}</td><td>{item.data?.income}</td><td>{item.data?.expense}</td><td>{item.data?.ref}</td><td>{item.data?.department}</td><td className={item.errors.length ? "text-red-600" : item.duplicate_id ? "text-amber-600" : "text-emerald-600"}>{item.errors.length ? displayCrmTerms(item.errors.join(", ")) : item.duplicate_id ? <label className="flex flex-col items-center gap-0.5"><span>ซ้ำกับ #{item.duplicate_id}</span><input type="checkbox" title="ข้ามแถวนี้" checked={importSkipRows.includes(item.row_number)} onChange={(e) => toggleImportSkipRow(item.row_number, e.target.checked)} /></label> : "ผ่าน"}</td></tr>)}</tbody></table></div>{importPreview.error_count > 0 && <Button variant="destructive" onClick={() => crmCashflowApi.downloadErrors(importPreview.error_rows, importPreview.error_details)}><Download className="h-4 w-4" />ดาวน์โหลดแถวผิดพลาด</Button>}
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

      <Dialog open={templateManagerOpen} onOpenChange={setTemplateManagerOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>จัดการเทมเพลตนำเข้า</DialogTitle>
            <DialogDescription>
              ระบุชื่อคอลัมน์จากไฟล์จริงให้ข้อมูลแต่ละประเภท เช่น วันที่อยู่คอลัมน์ A รายรับอยู่คอลัมน์ J และ Description อยู่คอลัมน์ AO
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 p-6 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Button size="sm" variant="outline" className="w-full" onClick={startNewTemplate}>
                <Plus className="h-4 w-4" />เทมเพลตใหม่
              </Button>
              <div className="divide-y rounded-md border">
                {importTemplates.map((tpl) => (
                  <button
                    key={tpl.cfimptpl_id}
                    type="button"
                    onClick={() => loadTemplateIntoEditor(tpl)}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-sm hover:bg-muted",
                      templateDraft?.id === tpl.cfimptpl_id && "bg-muted font-medium",
                    )}
                  >
                    {tpl.cfimptpl_name}
                  </button>
                ))}
                {importTemplates.length === 0 && (
                  <p className="p-3 text-center text-xs text-muted-foreground">ยังไม่มีเทมเพลต</p>
                )}
              </div>
            </div>

            {templateDraft ? (
              <div className="space-y-3">
                <label className="block text-sm">ชื่อเทมเพลต
                  <Input
                    className="mt-1"
                    value={templateDraft.name}
                    onChange={(e) => setTemplateDraft((current) => current ? { ...current, name: e.target.value } : current)}
                    placeholder="เช่น ไฟล์จากธนาคาร A"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={templateDraft.headerRow}
                    onChange={(e) => setTemplateDraft((current) => current ? { ...current, headerRow: e.target.checked } : current)}
                  />
                  ไฟล์มีแถวหัวตาราง (ค่าเริ่มต้นเมื่อเลือกเทมเพลตนี้)
                </label>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_160px] items-end gap-2 text-xs font-medium text-muted-foreground">
                    <span>ข้อมูลในระบบ</span>
                    <span>ชื่อคอลัมน์ในไฟล์</span>
                  </div>
                  {templateDraft.columns.map((column, index) => (
                    <div key={column.field} className="grid grid-cols-[1fr_160px] items-center gap-2">
                      <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm">
                        {IMPORT_FIELD_LABELS[column.field]}
                      </div>
                      <Input
                        className="h-9 uppercase"
                        value={column.column || ""}
                        onChange={(e) => updateTemplateColumn(index, { column: e.target.value.toUpperCase() })}
                        placeholder="เว้นว่าง หรือ A, J, AO"
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">ช่องที่ไม่กรอกชื่อคอลัมน์ในไฟล์จะเป็นค่าว่าง ต้องระบุ "วันที่" และจำนวนเงินอย่างน้อยหนึ่งแบบ (รายรับ/รายจ่าย หรือจำนวนเงินรวม) ส่วน "หัวข้อ" เว้นได้ ระบบจะกำหนดจากยอดเงินอัตโนมัติ</p>
                </div>
                {templateDraft.id && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2">
                    <span className="text-xs text-muted-foreground">ดาวน์โหลดไฟล์เปล่าตามรูปแบบเทมเพลตนี้:</span>
                    <Button size="sm" variant="outline" onClick={() => downloadTemplateDraft("xlsx")}>
                      <Download className="h-4 w-4" />XLSX
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadTemplateDraft("csv")}>
                      <Download className="h-4 w-4" />CSV
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 pt-2">
                  {templateDraft.id ? (
                    <Button variant="destructive" onClick={deleteTemplateDraft}><Trash2 className="h-4 w-4" />ลบเทมเพลต</Button>
                  ) : <span />}
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setTemplateDraft(null)}>ยกเลิก</Button>
                    <Button disabled={savingTemplate} onClick={saveTemplate}>
                      <Save className="h-4 w-4" />{savingTemplate ? "กำลังบันทึก..." : "บันทึกเทมเพลต"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="flex items-center justify-center text-sm text-muted-foreground">
                เลือกเทมเพลตทางซ้าย หรือกด "เทมเพลตใหม่" เพื่อสร้าง
              </p>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTemplateManagerOpen(false)}>ปิด</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailStatement} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>จัดการไฟล์แนบ</DialogTitle>
            <DialogDescription>
              {detailStatement
                ? `${formatDate(detailStatement.cfstate_date)} · ${detailStatement.cfcat_name} · ${money(detailStatement.cfstate_amount)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <Can menuKey={MENU_KEY} action="update">
              {detailAttachments.length < 2 ? (
                <label className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm text-muted-foreground",
                  detailUploading ? "cursor-wait opacity-60" : "cursor-pointer hover:border-primary hover:bg-primary/5",
                )}>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="hidden"
                    disabled={detailUploading}
                    onChange={(event) => {
                      void uploadDetailAttachment(event.target.files?.[0] || null);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Upload className="h-5 w-5" />
                  {detailUploading
                    ? "กำลังอัปโหลด..."
                    : `อัปโหลดรูปภาพหรือ PDF (${detailAttachments.length}/2, สูงสุด 10 MB)`}
                </label>
              ) : (
                <p className="rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                  แนบได้สูงสุด 2 ไฟล์ต่อรายการ — ลบไฟล์เดิมก่อนเพื่ออัปโหลดใหม่
                </p>
              )}
            </Can>
            {detailLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : detailAttachments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
            ) : (
              detailAttachments.map((attachment) => (
                <div key={attachment.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{attachment.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {Math.max(1, Math.round(attachment.file_size / 1024))} KB
                          {attachment.uploaded_by ? ` · ${attachment.uploaded_by}` : ""}
                        </p>
                      </div>
                    </div>
                    <Can menuKey={MENU_KEY} action="delete">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="ลบไฟล์"
                        disabled={detailDeletingId === attachment.id}
                        onClick={() => deleteDetailAttachment(attachment.id)}
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </Can>
                  </div>
                  {!attachment.previewUrl ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">ไม่สามารถแสดงตัวอย่างไฟล์นี้ได้</p>
                  ) : attachment.content_type.startsWith("image/") ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file_name}
                      className="mx-auto max-h-[55vh] rounded-lg border object-contain"
                    />
                  ) : attachment.content_type === "application/pdf" ? (
                    <iframe
                      src={attachment.previewUrl}
                      title={attachment.file_name}
                      className="h-[55vh] w-full rounded-lg border"
                    />
                  ) : (
                    <p className="py-4 text-center text-xs text-muted-foreground">ไม่สามารถแสดงไฟล์ประเภทนี้ได้</p>
                  )}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDetails}>ปิด</Button>
          </DialogFooter>
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
