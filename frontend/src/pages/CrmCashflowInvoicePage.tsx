import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Eye, Paperclip, RefreshCw, Trash2, Upload, X } from "lucide-react";

import {
  crmCashflowApi,
  type CrmCashflowAttachment,
  type CrmCashflowCategory,
  type CrmCashflowDocumentType,
  type CrmCashflowInvoiceStatus,
  type CrmCashflowStatement,
} from "@/api/crmCashflow";
import { Can } from "@/components/auth/RequirePermission";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { InvoiceStatusBadge } from "@/components/ui/invoice-status-badge";
import { formatDate, localDateInput } from "@/lib/format";

const MENU_KEY = "crm_cashflow_invoice";
const money = (value: number) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const message = (error: any) => error?.response?.data?.detail || error?.message || "เกิดข้อผิดพลาด";
const DOCUMENT_TYPES: { value: CrmCashflowDocumentType; label: string }[] = [
  { value: "tax_invoice", label: "ใบกำกับภาษี" },
  { value: "cash_bill", label: "บิลเงินสด" },
  { value: "other", label: "อื่นๆ" },
];
const INVOICE_STATUS_OPTIONS: { value: CrmCashflowInvoiceStatus; label: string }[] = [
  { value: "none", label: "ยังไม่ระบุ" },
  { value: "pending", label: "รอใบกำกับ" },
  { value: "received", label: "ได้รับแล้ว" },
  { value: "tax_invoice", label: "ใบกำกับภาษี" },
  { value: "cash_bill", label: "บิลเงินสด" },
  { value: "other", label: "อื่นๆ" },
];
type DatePreset = "custom" | "today" | "yesterday" | "last7" | "last30" | "this_month" | "last_month";
const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "custom", label: "กำหนดเอง" },
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "last7", label: "7 วันล่าสุด" },
  { value: "last30", label: "30 วันล่าสุด" },
  { value: "this_month", label: "เดือนนี้" },
  { value: "last_month", label: "เดือนที่แล้ว" },
];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const addDays = (base: Date, delta: number) => {
  const next = new Date(base);
  next.setDate(next.getDate() + delta);
  return next;
};
function effectiveInvoiceStatus(row: CrmCashflowStatement): CrmCashflowInvoiceStatus {
  if (row.cfstate_document_type) return row.cfstate_document_type;
  if (row.cfstate_invoice == null) return "none";
  return row.cfstate_invoice === 1 ? "received" : "pending";
}
type VerificationDialog =
  | { type: "blocked"; reason: string }
  | { type: "confirm"; statementId: number };

export function CrmCashflowInvoicePage() {
  const { can } = useAuth();
  const [categories, setCategories] = useState<CrmCashflowCategory[]>([]);
  const [rows, setRows] = useState<CrmCashflowStatement[]>([]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("custom");
  const [categoryId, setCategoryId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [detailQuery, setDetailQuery] = useState("");
  const [incomeMin, setIncomeMin] = useState("");
  const [incomeMax, setIncomeMax] = useState("");
  const [expenseMin, setExpenseMin] = useState("");
  const [expenseMax, setExpenseMax] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<"" | CrmCashflowInvoiceStatus>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [savingVerification, setSavingVerification] = useState(false);
  const [verificationDialog, setVerificationDialog] = useState<VerificationDialog | null>(null);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [toastKey, setToastKey] = useState(0);

  // Attachment dialog state
  const [attachmentStatement, setAttachmentStatement] = useState<CrmCashflowStatement | null>(null);
  const [attachments, setAttachments] = useState<CrmCashflowAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [updatingDocumentType, setUpdatingDocumentType] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; contentType: string; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Tracks changes made during the current attachment-dialog session so an
  // accidental close (X button / click outside) can offer to discard them —
  // newly uploaded files get deleted again and the document-type tick reverts.
  const [initialDocumentType, setInitialDocumentType] = useState<CrmCashflowDocumentType | null>(null);
  const [sessionUploadedIds, setSessionUploadedIds] = useState<string[]>([]);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [discardingExit, setDiscardingExit] = useState(false);

  // Camera state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Route every alert through these instead of calling setError/setNotice
  // directly, so the toast re-plays even when the message text repeats.
  const showError = (text: string) => {
    setError(text);
    setNotice("");
    setToastKey((key) => key + 1);
  };
  const showNotice = (text: string) => {
    setNotice(text);
    setError("");
    setToastKey((key) => key + 1);
  };

  useEffect(() => {
    if (!notice && !error) return;
    const timer = setTimeout(() => { setNotice(""); setError(""); }, 4000);
    return () => clearTimeout(timer);
  }, [toastKey]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await crmCashflowApi.invoices({
        start_date: dateStart || undefined, end_date: dateEnd || undefined,
        cfcat_id: categoryId ? Number(categoryId) : undefined,
      });
      setRows(result.items.filter((row) => row.cfstate_amount <= 0));
    } catch (requestError) { showError(String(message(requestError))); }
    finally { setLoading(false); }
  }, [dateStart, dateEnd, categoryId]);

  useEffect(() => {
    crmCashflowApi.categories().then(setCategories).catch((requestError) => showError(String(message(requestError))));
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  // ── Filters & pagination ─────────────────────────────────────────────────
  const changeDateStart = (value: string) => { setDateStart(value); setDatePreset("custom"); };
  const changeDateEnd = (value: string) => { setDateEnd(value); setDatePreset("custom"); };

  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const now = new Date();
    let start = now;
    let end = now;
    if (preset === "yesterday") { start = addDays(now, -1); end = start; }
    else if (preset === "last7") { start = addDays(now, -6); end = now; }
    else if (preset === "last30") { start = addDays(now, -29); end = now; }
    else if (preset === "this_month") { start = new Date(now.getFullYear(), now.getMonth(), 1); end = now; }
    else if (preset === "last_month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    setDateStart(localDateInput(start));
    setDateEnd(localDateInput(end));
  };

  const resetFilters = () => {
    setDatePreset("custom");
    setDateStart(""); setDateEnd("");
    setCategoryId("");
    setSourceId(""); setDetailQuery("");
    setIncomeMin(""); setIncomeMax("");
    setExpenseMin(""); setExpenseMax("");
    setInvoiceStatusFilter("");
  };

  const sourceOptions = useMemo(() => {
    const byId = new Map<number, string>();
    rows.forEach((row) => byId.set(row.cflist_id, row.cflist_name));
    return Array.from(byId.entries())
      .map(([id, name]) => ({ value: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, "th"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const detail = detailQuery.trim().toLowerCase();
    const incomeMinNum = incomeMin === "" ? null : Number(incomeMin);
    const incomeMaxNum = incomeMax === "" ? null : Number(incomeMax);
    const expenseMinNum = expenseMin === "" ? null : Number(expenseMin);
    const expenseMaxNum = expenseMax === "" ? null : Number(expenseMax);
    return rows.filter((row) => {
      if (sourceId && String(row.cflist_id) !== sourceId) return false;
      if (detail && !(row.cfstate_detail || "").toLowerCase().includes(detail)) return false;
      if (incomeMinNum !== null || incomeMaxNum !== null) {
        if (row.cfstate_amount <= 0) return false;
        if (incomeMinNum !== null && row.cfstate_amount < incomeMinNum) return false;
        if (incomeMaxNum !== null && row.cfstate_amount > incomeMaxNum) return false;
      }
      if (expenseMinNum !== null || expenseMaxNum !== null) {
        if (row.cfstate_amount >= 0) return false;
        const absAmount = Math.abs(row.cfstate_amount);
        if (expenseMinNum !== null && absAmount < expenseMinNum) return false;
        if (expenseMaxNum !== null && absAmount > expenseMaxNum) return false;
      }
      if (invoiceStatusFilter && effectiveInvoiceStatus(row) !== invoiceStatusFilter) return false;
      return true;
    });
  }, [rows, sourceId, detailQuery, incomeMin, incomeMax, expenseMin, expenseMax, invoiceStatusFilter]);

  useEffect(() => {
    setPage(1);
  }, [rows, sourceId, detailQuery, incomeMin, incomeMax, expenseMin, expenseMax, invoiceStatusFilter, pageSize]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(filteredRows.length / pageSize)) : 1;
  const currentPage = Math.min(page, totalPages);
  const rowNumberOffset = pageSize > 0 ? (currentPage - 1) * pageSize : 0;
  const pagedRows = pageSize > 0
    ? filteredRows.slice(rowNumberOffset, rowNumberOffset + pageSize)
    : filteredRows;

  const requestVerification = (id: number) => {
    if (attachments.length === 0 || !attachmentStatement?.cfstate_document_type) {
      setVerificationDialog({
        type: "blocked",
        reason: "รายการนี้ต้องมีไฟล์แนบและระบุประเภทเอกสาร ก่อนจึงจะกด “ตรวจสอบแล้ว” ได้",
      });
      return;
    }
    setVerificationDialog({ type: "confirm", statementId: id });
  };

  const confirmVerification = async () => {
    if (verificationDialog?.type !== "confirm" || savingVerification) return;
    setSavingVerification(true);
    try {
      await crmCashflowApi.updateStatement(verificationDialog.statementId, { cfstate_verified: 1 });
      setVerificationDialog(null);
      showNotice("บันทึกว่าตรวจสอบแล้ว");
      closeAttachmentsDialog();
      await loadRows();
    } catch (requestError: any) {
      const reason = String(message(requestError));
      if (requestError?.response?.status === 409) {
        setVerificationDialog({ type: "blocked", reason });
      } else {
        showError(reason);
      }
    } finally {
      setSavingVerification(false);
    }
  };
  const remove = async (id: number) => {
    if (!window.confirm("ยืนยันการลบรายการนี้?")) return;
    try { await crmCashflowApi.deleteStatement(id); await loadRows(); }
    catch (requestError) { showError(String(message(requestError))); }
  };

  // ── Attachment handlers ──────────────────────────────────────────────────
  const openAttachments = async (statement: CrmCashflowStatement) => {
    setAttachmentStatement(statement);
    setAttachments([]);
    setUpdatingDocumentType(false);
    setInitialDocumentType(statement.cfstate_document_type ?? null);
    setSessionUploadedIds([]);
    setExitConfirmOpen(false);
    setAttachmentsLoading(true);
    try {
      const currentAttachments = await crmCashflowApi.attachments(statement.cfstate_id);
      setAttachments(currentAttachments);
      setRows((current) => current.map((row) => row.cfstate_id === statement.cfstate_id
        ? { ...row, attachment_count: currentAttachments.length }
        : row));
      setAttachmentStatement((current) => current ? {
        ...current,
        attachment_count: currentAttachments.length,
      } : current);
    } catch (requestError) {
      showError(message(requestError));
    } finally {
      setAttachmentsLoading(false);
    }
  };

  const closeAttachmentsDialog = () => {
    setAttachmentStatement(null);
    setAttachments([]);
    setInitialDocumentType(null);
    setSessionUploadedIds([]);
    setExitConfirmOpen(false);
  };

  // Guards every way the dialog can be dismissed (X button, Escape, clicking
  // the overlay outside the card) — if anything changed this session, ask
  // for confirmation instead of closing straight away.
  const attemptCloseAttachments = () => {
    const documentTypeChanged = (attachmentStatement?.cfstate_document_type ?? null) !== initialDocumentType;
    if (sessionUploadedIds.length > 0 || documentTypeChanged) {
      setExitConfirmOpen(true);
      return;
    }
    closeAttachmentsDialog();
  };

  const discardAndCloseAttachments = async () => {
    if (!attachmentStatement) { closeAttachmentsDialog(); return; }
    setDiscardingExit(true);
    try {
      for (const attachmentId of sessionUploadedIds) {
        await crmCashflowApi.deleteAttachment(attachmentStatement.cfstate_id, attachmentId);
      }
      if (attachmentStatement.cfstate_document_type !== initialDocumentType) {
        await crmCashflowApi.updateStatement(attachmentStatement.cfstate_id, {
          cfstate_document_type: initialDocumentType,
        });
      }
      const remainingCount = Math.max(0, attachments.length - sessionUploadedIds.length);
      setRows((current) => current.map((row) => row.cfstate_id === attachmentStatement.cfstate_id
        ? { ...row, attachment_count: remainingCount, cfstate_document_type: initialDocumentType }
        : row));
      showNotice("ยกเลิกการเปลี่ยนแปลงแล้ว");
    } catch (requestError) {
      showError(message(requestError));
    } finally {
      setDiscardingExit(false);
      closeAttachmentsDialog();
    }
  };

  const updateDocumentType = async (documentType: CrmCashflowDocumentType) => {
    if (!attachmentStatement || updatingDocumentType) return;
    const nextType = attachmentStatement.cfstate_document_type === documentType ? null : documentType;
    setUpdatingDocumentType(true);
    try {
      await crmCashflowApi.updateStatement(attachmentStatement.cfstate_id, {
        cfstate_document_type: nextType,
      });
      setAttachmentStatement((current) => current ? {
        ...current,
        cfstate_document_type: nextType,
      } : current);
      setRows((current) => current.map((row) => row.cfstate_id === attachmentStatement.cfstate_id
        ? { ...row, cfstate_document_type: nextType }
        : row));
      showNotice(nextType ? "บันทึกประเภทเอกสารแล้ว" : "ยกเลิกประเภทเอกสารแล้ว");
    } catch (requestError) {
      showError(message(requestError));
    } finally {
      setUpdatingDocumentType(false);
    }
  };

  const uploadAttachment = async (file: File | null) => {
    if (!attachmentStatement || !file) return;
    if (attachments.length >= 2) {
      showError("แต่ละรายการแนบได้สูงสุด 2 ไฟล์ กรุณาลบไฟล์เดิมก่อน");
      return;
    }
    setUploadingAttachment(true);
    try {
      const uploaded = await crmCashflowApi.uploadAttachment(attachmentStatement.cfstate_id, file);
      setSessionUploadedIds((ids) => [...ids, uploaded.id]);
      const currentAttachments = await crmCashflowApi.attachments(attachmentStatement.cfstate_id);
      setAttachments(currentAttachments);
      setRows((current) => current.map((row) => row.cfstate_id === attachmentStatement.cfstate_id
        ? { ...row, attachment_count: currentAttachments.length }
        : row));
      setAttachmentStatement((current) => current ? {
        ...current,
        attachment_count: currentAttachments.length,
      } : current);
      showNotice("อัปโหลดไฟล์แนบสำเร็จ");
    } catch (requestError) {
      showError(message(requestError));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const viewAttachment = async (attachment: CrmCashflowAttachment) => {
    if (!attachmentStatement) return;
    setPreviewLoading(true);
    try {
      const blob = await crmCashflowApi.openAttachment(attachmentStatement.cfstate_id, attachment.id);
      const url = URL.createObjectURL(blob);
      setPreviewAttachment({ name: attachment.file_name, contentType: attachment.content_type, url });
    } catch (requestError) {
      showError(message(requestError));
    } finally {
      setPreviewLoading(false);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (!attachmentStatement) return;
    if (!window.confirm("ยืนยันการลบไฟล์แนบนี้?")) return;
    try {
      await crmCashflowApi.deleteAttachment(attachmentStatement.cfstate_id, attachmentId);
      // A file removed explicitly (with the confirm above) is gone for good —
      // if it was uploaded this session, drop it from the revert-on-exit list
      // too so discarding later doesn't try to delete it a second time.
      setSessionUploadedIds((ids) => ids.filter((id) => id !== attachmentId));
      const currentAttachments = await crmCashflowApi.attachments(attachmentStatement.cfstate_id);
      setAttachments(currentAttachments);
      setRows((current) => current.map((row) => row.cfstate_id === attachmentStatement.cfstate_id
        ? { ...row, attachment_count: currentAttachments.length }
        : row));
      setAttachmentStatement((current) => current ? {
        ...current,
        attachment_count: currentAttachments.length,
      } : current);
      showNotice("ลบไฟล์แนบแล้ว");
    } catch (requestError) {
      showError(message(requestError));
    }
  };

  // ── Camera handlers ──────────────────────────────────────────────────────
  const openCamera = async () => {
    setCameraError("");
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          // Documents (A4/ใบเสร็จ) are tall and narrow — ask for a portrait
          // frame instead of the camera's landscape default so the whole
          // page fits without the user having to rotate the phone.
          aspectRatio: { ideal: 3 / 4 },
          width: { ideal: 1440 },
          height: { ideal: 1920 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      // Wait for video element to mount, then attach stream
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      setCameraError("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการใช้งานกล้อง หรือใช้การอัปโหลดไฟล์แทน");
    }
  };

  const closeCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    setCameraOpen(false);
    setCameraError("");
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
      closeCamera();
      uploadAttachment(file);
    }, "image/jpeg", 0.9);
  };

  return <div className="flex h-full flex-col">
    <PageHeader title="ติดตามใบกำกับภาษี (CRM)" description="แสดงทุกรายการที่ยังไม่ได้ตรวจสอบ ไม่ว่าจะมีใบกำกับภาษีหรือไม่ก็ตาม" />

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
        <label className="min-w-36 space-y-1 text-xs">ช่วงวันที่
          <select className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={datePreset} onChange={(event) => applyDatePreset(event.target.value as DatePreset)}>
            {DATE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
        </label>
        <div className="space-y-1 text-xs">วันที่เริ่มต้น<DatePicker value={dateStart} onChange={changeDateStart} /></div>
        <div className="space-y-1 text-xs">วันที่สิ้นสุด<DatePicker value={dateEnd} onChange={changeDateEnd} /></div>
        <label className="min-w-56 space-y-1 text-xs">หัวข้อ<select className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">ทั้งหมด</option>{categories.map((item) => <option key={item.cfcat_id} value={item.cfcat_id}>{item.cfcat_name}</option>)}</select></label>
        <label className="min-w-48 space-y-1 text-xs">แหล่งที่มา<select className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">ทั้งหมด</option>{sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="min-w-48 space-y-1 text-xs">รายละเอียด<Input className="h-9" value={detailQuery} onChange={(event) => setDetailQuery(event.target.value)} placeholder="ค้นหารายละเอียด" /></label>
        <div className="space-y-1 text-xs hidden">ยอดรับ (ต่ำสุด–สูงสุด)
          <div className="flex gap-1">
            <Input className="h-9 w-24" type="number" value={incomeMin} onChange={(event) => setIncomeMin(event.target.value)} placeholder="ต่ำสุด" />
            <Input className="h-9 w-24" type="number" value={incomeMax} onChange={(event) => setIncomeMax(event.target.value)} placeholder="สูงสุด" />
          </div>
        </div>
        <div className="space-y-1 text-xs">ยอดจ่าย (ต่ำสุด–สูงสุด)
          <div className="flex gap-1">
            <Input className="h-9 w-24" type="number" value={expenseMin} onChange={(event) => setExpenseMin(event.target.value)} placeholder="ต่ำสุด" />
            <Input className="h-9 w-24" type="number" value={expenseMax} onChange={(event) => setExpenseMax(event.target.value)} placeholder="สูงสุด" />
          </div>
        </div>
        <label className="min-w-48 space-y-1 text-xs">ใบกำกับภาษี
          <select className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={invoiceStatusFilter} onChange={(event) => setInvoiceStatusFilter(event.target.value as "" | CrmCashflowInvoiceStatus)}>
            <option value="">ทั้งหมด</option>
            {INVOICE_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <Button variant="outline" onClick={loadRows}><RefreshCw className="h-4 w-4" />ดูรายงาน</Button>
        <Button variant="ghost" onClick={resetFilters}>ล้างตัวกรอง</Button>
      </CardContent></Card>
      <Card><CardContent className="overflow-x-auto pt-6"><table className="w-full min-w-[1140px] text-sm">
        <thead><tr className="border-b bg-muted/40 text-left text-xs">{['#','วันที่','หัวข้อ','รายละเอียด','แหล่งที่มา','ยอดรับ','ยอดจ่าย','ใบกำกับภาษี','ผู้บันทึก','จัดการ'].map((head) => <th key={head} className="px-3 py-2">{head}</th>)}</tr></thead>
        <tbody>{pagedRows.map((row, index) => <tr key={row.cfstate_id} className="border-b">
          <td className="px-3 py-2">{rowNumberOffset + index + 1}</td><td className="px-3 py-2">{formatDate(row.cfstate_date)}</td><td className="px-3 py-2">{row.cfcat_name}</td><td className="max-w-60 whitespace-normal px-3 py-2">{row.cfstate_detail || "-"}</td><td className="px-3 py-2">{row.cflist_name}</td>
          <td className="px-3 py-2 text-right text-emerald-700">{row.cfstate_amount > 0 ? money(row.cfstate_amount) : "0.00"}</td><td className="px-3 py-2 text-right text-red-700">{row.cfstate_amount < 0 ? money(row.cfstate_amount) : "0.00"}</td>
          <td className="px-3 py-2"><InvoiceStatusBadge invoice={row.cfstate_invoice} documentType={row.cfstate_document_type} /></td><td className="px-3 py-2">{row.user_name}</td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" title="แนบไฟล์ / ตรวจสอบแล้ว" onClick={() => openAttachments(row)}>
                <Paperclip className="h-4 w-4" />
              </Button>
              <Can menuKey={MENU_KEY} action="delete">
                <Button size="icon" variant="destructive" onClick={() => remove(row.cfstate_id)}><Trash2 className="h-4 w-4" /></Button>
              </Can>
            </div>
          </td>
        </tr>)}</tbody>
      </table>{loading && <p className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>}{!loading && filteredRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีรายการที่ต้องตรวจสอบ</p>}
      {!loading && filteredRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
          <p className="text-muted-foreground">
            ทั้งหมด {filteredRows.length} รายการ{filteredRows.length !== rows.length ? ` (จาก ${rows.length} รายการ)` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">แสดง
              <select className="h-8 rounded-md border bg-white px-2 text-sm" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                <option value={0}>ทั้งหมด</option>
              </select>
              แถว/หน้า
            </label>
            {pageSize > 0 && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>ก่อนหน้า</Button>
                <span className="px-2 text-xs text-muted-foreground">หน้า {currentPage} / {totalPages}</span>
                <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>ถัดไป</Button>
              </div>
            )}
          </div>
        </div>
      )}
      </CardContent></Card>
    </div>

    <Dialog open={!!verificationDialog} onOpenChange={(open) => !open && setVerificationDialog(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{verificationDialog?.type === "blocked" ? "ไม่สามารถตรวจสอบได้" : "ยืนยันการตรวจสอบ"}</DialogTitle>
          <DialogDescription>
            {verificationDialog?.type === "blocked"
              ? verificationDialog.reason
              : "ยืนยันว่าคุณตรวจสอบไฟล์แนบของรายการนี้เรียบร้อยแล้วใช่หรือไม่?"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {verificationDialog?.type === "confirm" ? (
            <>
              <Button variant="outline" disabled={savingVerification} onClick={() => setVerificationDialog(null)}>ยกเลิก</Button>
              <Button disabled={savingVerification} onClick={confirmVerification}>
                {savingVerification ? "กำลังบันทึก..." : "ยืนยันว่าตรวจสอบแล้ว"}
              </Button>
            </>
          ) : (
            <Button onClick={() => setVerificationDialog(null)}>ตกลง</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={exitConfirmOpen} onOpenChange={(open) => !open && !discardingExit && setExitConfirmOpen(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>ยืนยันการออกจากหน้าเอกสารแนบ</DialogTitle>
          <DialogDescription>
            คุณมีการอัปโหลดไฟล์หรือติ๊กประเภทเอกสารที่ยังไม่ได้ยืนยัน “ตรวจสอบแล้ว” — ถ้าออกตอนนี้
            ไฟล์ที่เพิ่งแนบในรอบนี้จะถูกลบ และประเภทเอกสารที่ติ๊กไว้จะไม่ถูกบันทึก ต้องการออกหรือไม่?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={discardingExit} onClick={() => setExitConfirmOpen(false)}>อยู่ต่อ</Button>
          <Button variant="destructive" disabled={discardingExit} onClick={discardAndCloseAttachments}>
            {discardingExit ? "กำลังยกเลิก..." : "ออกและลบข้อมูล"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!attachmentStatement} onOpenChange={(open) => { if (!open) attemptCloseAttachments(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>เอกสารแนบ</DialogTitle>
          <DialogDescription>
            {attachmentStatement
              ? `${formatDate(attachmentStatement.cfstate_date)} · ${attachmentStatement.cfcat_name} · ${money(attachmentStatement.cfstate_amount)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 p-6">
          <Can menuKey={MENU_KEY} action="update">
            {attachments.length < 2 ? (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={openCamera}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary hover:bg-primary/5"
                >
                  <Camera className="h-5 w-5" />
                  {uploadingAttachment ? "กำลังอัปโหลด..." : `ถ่ายรูป (${attachments.length}/2)`}
                </button>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm text-muted-foreground hover:border-primary hover:bg-primary/5">
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="hidden"
                    onChange={(e) => { uploadAttachment(e.target.files?.[0] || null); e.currentTarget.value = ""; }}
                  />
                  <Upload className="h-5 w-5" />
                  {uploadingAttachment ? "กำลังอัปโหลด..." : `อัปโหลดรูปภาพหรือ PDF (${attachments.length}/2, สูงสุด 10 MB)`}
                </label>
              </div>
            ) : (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                แนบได้สูงสุด 2 ไฟล์ต่อรายการ — ลบไฟล์เดิมก่อนเพื่ออัปโหลดใหม่
              </p>
            )}
          </Can>
          {attachmentsLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
          ) : attachments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
          ) : (
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
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
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="ดูไฟล์"
                      onClick={() => viewAttachment(attachment)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Can menuKey={MENU_KEY} action="delete">
                      <Button size="icon" variant="ghost" title="ลบไฟล์" onClick={() => deleteAttachment(attachment.id)}>
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </Can>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">ประเภทเอกสาร</p>
            <div className="flex flex-wrap gap-4">
              {DOCUMENT_TYPES.map((documentType) => (
                <label key={documentType.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attachmentStatement?.cfstate_document_type === documentType.value}
                    disabled={!can(MENU_KEY, "update") || updatingDocumentType}
                    readOnly
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void updateDocumentType(documentType.value);
                    }}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  {documentType.label}
                </label>
              ))}
            </div>
            {!can(MENU_KEY, "update") && (
              <p className="text-xs text-muted-foreground">ดูได้อย่างเดียว — ไม่มีสิทธิ์แก้ไขประเภทเอกสาร</p>
            )}
          </div>
          {can(MENU_KEY, "update") && (attachments.length === 0 || !attachmentStatement?.cfstate_document_type) && (
            <p className="text-center text-xs text-amber-700">
              ต้องแนบไฟล์อย่างน้อย 1 ไฟล์ และเลือกประเภทเอกสาร ก่อนกด “ตรวจสอบแล้ว”
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={discardingExit} onClick={attemptCloseAttachments}>ปิด</Button>
          <Can menuKey={MENU_KEY} action="update">
            <Button
              disabled={attachments.length === 0 || !attachmentStatement?.cfstate_document_type}
              onClick={() => attachmentStatement && requestVerification(attachmentStatement.cfstate_id)}
            >
              ตรวจสอบแล้ว
            </Button>
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={cameraOpen} onOpenChange={(open) => { if (!open) closeCamera(); }}>
      <DialogContent className="max-w-sm border-0 bg-transparent shadow-none">
        <DialogHeader>
          <DialogTitle>ถ่ายรูป</DialogTitle>
          <DialogDescription>จัดเอกสารให้เต็มกรอบแนวตั้งแล้วกดถ่าย</DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto aspect-[3/4] max-h-[70vh] w-full">
          {cameraError ? (
            <p className="flex h-full items-center justify-center text-center text-sm text-red-600">{cameraError}</p>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full rounded-lg border object-cover"
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeCamera}>ยกเลิก</Button>
          <Button onClick={capturePhoto} disabled={!!cameraError}>ถ่าย</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!previewAttachment} onOpenChange={(open) => !open && setPreviewAttachment(null)}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{previewAttachment?.name || "ดูไฟล์"}</DialogTitle>
          <DialogDescription>แสดงไฟล์แนบ</DialogDescription>
        </DialogHeader>
        <div className="p-6">
          {previewLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
          ) : previewAttachment?.contentType.startsWith("image/") ? (
            <img
              src={previewAttachment.url}
              alt={previewAttachment.name}
              className="mx-auto max-h-[70vh] rounded-lg border object-contain"
            />
          ) : previewAttachment?.contentType === "application/pdf" ? (
            <iframe
              src={previewAttachment.url}
              title={previewAttachment.name}
              className="h-[70vh] w-full rounded-lg border"
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">ไม่สามารถแสดงไฟล์ประเภทนี้ได้</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPreviewAttachment(null)}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
