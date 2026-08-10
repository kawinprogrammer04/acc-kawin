import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Eye, Paperclip, RefreshCw, Trash2, Upload, X } from "lucide-react";

import {
  crmCashflowApi,
  type CrmCashflowAttachment,
  type CrmCashflowCategory,
  type CrmCashflowStatement,
} from "@/api/crmCashflow";
import { Can } from "@/components/auth/RequirePermission";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format";

const MENU_KEY = "crm_cashflow_invoice";
const money = (value: number) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const message = (error: any) => error?.response?.data?.detail || error?.message || "เกิดข้อผิดพลาด";

export function CrmCashflowInvoicePage() {
  const [categories, setCategories] = useState<CrmCashflowCategory[]>([]);
  const [rows, setRows] = useState<CrmCashflowStatement[]>([]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [toastKey, setToastKey] = useState(0);

  // Attachment dialog state
  const [attachmentStatement, setAttachmentStatement] = useState<CrmCashflowStatement | null>(null);
  const [attachments, setAttachments] = useState<CrmCashflowAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; contentType: string; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
      setRows(result.items);
    } catch (requestError) { showError(String(message(requestError))); }
    finally { setLoading(false); }
  }, [dateStart, dateEnd, categoryId]);

  useEffect(() => {
    crmCashflowApi.categories().then(setCategories).catch((requestError) => showError(String(message(requestError))));
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  const markVerified = async (id: number) => {
    try {
      await crmCashflowApi.updateStatement(id, { cfstate_verified: 1 });
      showNotice("บันทึกว่าตรวจสอบแล้ว");
      await loadRows();
    } catch (requestError) { showError(String(message(requestError))); }
  };
  const toggleInvoice = async (id: number, checked: boolean) => {
    try {
      await crmCashflowApi.updateStatement(id, { cfstate_invoice: checked ? 1 : 0 });
      await loadRows();
    } catch (requestError) { showError(String(message(requestError))); }
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
    setAttachmentsLoading(true);
    try {
      setAttachments(await crmCashflowApi.attachments(statement.cfstate_id));
    } catch (requestError) {
      showError(message(requestError));
    } finally {
      setAttachmentsLoading(false);
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
      await crmCashflowApi.uploadAttachment(attachmentStatement.cfstate_id, file);
      setAttachments(await crmCashflowApi.attachments(attachmentStatement.cfstate_id));
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
      setAttachments(await crmCashflowApi.attachments(attachmentStatement.cfstate_id));
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
        <div className="space-y-1 text-xs">วันที่เริ่มต้น<DatePicker value={dateStart} onChange={setDateStart} /></div>
        <div className="space-y-1 text-xs">วันที่สิ้นสุด<DatePicker value={dateEnd} onChange={setDateEnd} /></div>
        <label className="min-w-56 space-y-1 text-xs">หัวข้อ<select className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">ทั้งหมด</option>{categories.map((item) => <option key={item.cfcat_id} value={item.cfcat_id}>{item.cfcat_name}</option>)}</select></label>
        <Button variant="outline" onClick={loadRows}><RefreshCw className="h-4 w-4" />ดูรายงาน</Button>
      </CardContent></Card>
      <Card><CardContent className="overflow-x-auto pt-6"><table className="w-full min-w-[1140px] text-sm">
        <thead><tr className="border-b bg-muted/40 text-left text-xs">{['#','วันที่','หัวข้อ','แหล่งที่มา','รายละเอียด','ยอดรับ','ยอดจ่าย','ใบกำกับภาษี','ผู้บันทึก','ตรวจสอบแล้ว','จัดการ'].map((head) => <th key={head} className="px-3 py-2">{head}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.cfstate_id} className="border-b">
          <td className="px-3 py-2">{index + 1}</td><td className="px-3 py-2">{formatDate(row.cfstate_date)}</td><td className="px-3 py-2">{row.cfcat_name}</td><td className="px-3 py-2">{row.cflist_name}</td><td className="max-w-60 whitespace-normal px-3 py-2">{row.cfstate_detail || "-"}</td>
          <td className="px-3 py-2 text-right text-emerald-700">{row.cfstate_amount > 0 ? money(row.cfstate_amount) : "0.00"}</td><td className="px-3 py-2 text-right text-red-700">{row.cfstate_amount < 0 ? money(row.cfstate_amount) : "0.00"}</td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-2">
              {row.cfstate_invoice != null && (
                <Can menuKey={MENU_KEY} action="update">
                  <Switch
                    checked={row.cfstate_invoice === 1}
                    onCheckedChange={(checked) => toggleInvoice(row.cfstate_id, checked)}
                  />
                </Can>
              )}
              <span className="text-xs text-muted-foreground">
                {row.cfstate_invoice == null ? "ไม่มีใบกำกับ" : row.cfstate_invoice === 1 ? "ได้รับแล้ว" : "รอใบกำกับ"}
              </span>
            </div>
          </td><td className="px-3 py-2">{row.user_name}</td>
          <td className="px-3 py-2"><Can menuKey={MENU_KEY} action="update"><Button size="sm" variant="outline" onClick={() => markVerified(row.cfstate_id)}>ตรวจสอบแล้ว</Button></Can></td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" title="แนบไฟล์" onClick={() => openAttachments(row)}>
                <Paperclip className="h-4 w-4" />
              </Button>
              <Can menuKey={MENU_KEY} action="delete">
                <Button size="icon" variant="destructive" onClick={() => remove(row.cfstate_id)}><Trash2 className="h-4 w-4" /></Button>
              </Can>
            </div>
          </td>
        </tr>)}</tbody>
      </table>{loading && <p className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>}{!loading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีรายการที่ต้องตรวจสอบ</p>}</CardContent></Card>
    </div>

    <Dialog open={!!attachmentStatement} onOpenChange={(open) => !open && setAttachmentStatement(null)}>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAttachmentStatement(null)}>ปิด</Button>
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
