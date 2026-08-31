import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle, ArrowRight, CheckCircle2, FileImage, FileSearch, FileSpreadsheet,
  FileText, ImagePlus, Loader2, Save, Trash2, UploadCloud,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import {
  referenceItemsApi, statementsApi, type PreviewPayload, type ReferenceSource, type Statement, type UploadJobStatus,
} from "@/api/statement";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FriendlyEmpty, StatementJourney } from "./StatementUx";

type Phase = "idle" | "uploading" | "processing" | "saving";
type DropTarget = "statement" | "evidence" | null;
type EvidenceReviewRow = {
  include: boolean;
  transaction_date: string;
  description: string;
  amount: string;
  card_last4: string;
  tr_code: string;
  channel: string;
  warnings: string[];
};

const PHASE_MESSAGE: Record<Phase, string> = {
  idle: "",
  uploading: "กำลังส่งไฟล์เข้าระบบ...",
  processing: "กำลังอ่านวันที่ ยอดเงิน เลขบัตร และข้อมูลในไฟล์...",
  saving: "กำลังจัดเก็บรายการที่อ่านได้...",
};

const imageExtensions = new Set(["jpg", "jpeg", "png", "webp"]);

export function UploadTab() {
  const navigate = useNavigate();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [evidenceSources, setEvidenceSources] = useState<ReferenceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [jobMessage, setJobMessage] = useState("");
  const [currentFiles, setCurrentFiles] = useState<string[]>([]);
  const [lastSavedStatementId, setLastSavedStatementId] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<DropTarget>(null);
  const [currentJobToken, setCurrentJobToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [reviewRows, setReviewRows] = useState<EvidenceReviewRow[]>([]);
  const [previewImages, setPreviewImages] = useState<{ name: string; url: string }[]>([]);
  const [previewImageError, setPreviewImageError] = useState<string | null>(null);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState(0);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewImageUrlsRef = useRef<string[]>([]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statementRows, referenceData] = await Promise.all([
        statementsApi.list(20),
        referenceItemsApi.list(),
      ]);
      setStatements(statementRows);
      setEvidenceSources(referenceData.sources);
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดรายการไฟล์ล่าสุดไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    previewImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const replacePreviewImages = (images: { name: string; url: string }[]) => {
    previewImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewImageUrlsRef.current = images.map((image) => image.url);
    setPreviewImages(images);
  };

  const saveStatementAutomatically = useCallback(async (previewToken: string, previewData: PreviewPayload) => {
    setPhase("saving");
    try {
      const rows = previewData.rows.map((row) => ({
        include: row.include,
        reviewed: true,
        transaction_date: row.transaction_date ?? "",
        description: row.description ?? "",
        amount: row.amount != null ? String(row.amount) : "",
        card_last4: row.card_last4 ?? "",
        tr_code: row.tr_code ?? "",
        channel: String(row.channel ?? ""),
      }));
      const result = await statementsApi.confirmPreview(previewToken, rows);
      setLastSavedStatementId(result.statement_id ?? null);
      showToast("อัปโหลด Statement สำเร็จแล้ว — กดชื่อไฟล์เพื่อดูรายการได้ทันที");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "บันทึกข้อมูลจากไฟล์ไม่สำเร็จ"));
      await statementsApi.cancelPreview(previewToken).catch(() => undefined);
    } finally {
      setPhase("idle");
      setCurrentFiles([]);
      setJobMessage("");
      setCurrentJobToken(null);
    }
  }, [load]);

  const openEvidenceReview = useCallback(async (previewToken: string, previewData: PreviewPayload) => {
    const defaultChannel = previewData.preview_images[0]?.name ?? "manual";
    const rows: EvidenceReviewRow[] = previewData.rows.map((row) => ({
      include: row.include,
      transaction_date: row.transaction_date ?? "",
      description: row.description ?? "",
      amount: row.amount != null ? String(row.amount) : "",
      card_last4: row.card_last4 ?? "",
      tr_code: row.tr_code ?? "",
      channel: String(row.channel ?? defaultChannel),
      warnings: row.warnings ?? [],
    }));
    const loadedImageResults = await Promise.all(previewData.preview_images.map(async (image) => {
      try {
        const blob = await statementsApi.getPreviewImage(previewToken, image.index);
        return { image: { name: image.name, url: URL.createObjectURL(blob) }, failedName: null };
      } catch {
        return { image: null, failedName: image.name };
      }
    }));
    const images = loadedImageResults
      .map((result) => result.image)
      .filter((image): image is { name: string; url: string } => image !== null);
    const failedNames = loadedImageResults
      .map((result) => result.failedName)
      .filter((name): name is string => name !== null);
    replacePreviewImages(images);
    setPreviewImageError(
      failedNames.length > 0
        ? `เปิดรูปไม่ได้ ${failedNames.length} ไฟล์ กรุณายกเลิกแล้วอัปโหลดใหม่`
        : null,
    );
    setPreview(previewData);
    setReviewRows(rows);
    setSelectedPreviewImage(0);
    setReviewConfirmed(false);
    setReviewError(null);
    setPhase("idle");
    setCurrentFiles([]);
    setJobMessage("");
    setCurrentJobToken(null);
  }, []);

  const handleCompletedPreview = useCallback(async (previewToken: string) => {
    try {
      const previewData = await statementsApi.getPreview(previewToken);
      if (previewData.statement.statement_type === "ads_screenshot") {
        await openEvidenceReview(previewToken, previewData);
      } else {
        await saveStatementAutomatically(previewToken, previewData);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "เปิดข้อมูลที่อ่านได้ไม่สำเร็จ"));
      setPhase("idle");
      setCurrentFiles([]);
      setCurrentJobToken(null);
    }
  }, [openEvidenceReview, saveStatementAutomatically]);

  const pollJob = useCallback((jobToken: string) => {
    setPhase("processing");
    pollRef.current = window.setInterval(async () => {
      try {
        const status: UploadJobStatus = await statementsApi.jobStatus(jobToken);
        setJobMessage(status.message);
        if (status.status === "complete" && status.preview_token) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          await handleCompletedPreview(status.preview_token);
        } else if (status.status === "failed" || status.status === "missing") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setError(status.error || "ระบบอ่านไฟล์ไม่สำเร็จ กรุณาตรวจไฟล์แล้วลองอีกครั้ง");
          setPhase("idle");
          setCurrentFiles([]);
          setCurrentJobToken(null);
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setError(getApiErrorMessage(err, "ตรวจสอบสถานะการอ่านไฟล์ไม่สำเร็จ"));
        setPhase("idle");
        setCurrentFiles([]);
        setCurrentJobToken(null);
      }
    }, 1500);
  }, [handleCompletedPreview]);

  const cancelCurrentJob = async () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (currentJobToken) await statementsApi.cancelJob(currentJobToken).catch(() => undefined);
    setPhase("idle");
    setCurrentFiles([]);
    setCurrentJobToken(null);
    setJobMessage("");
    showToast("ยกเลิกการอ่านข้อความแล้ว");
  };

  const handleStatementFile = async (file: File) => {
    setError(null);
    setLastSavedStatementId(null);
    setCurrentFiles([file.name]);
    setPhase("uploading");
    try {
      const { job_token } = await statementsApi.upload(file);
      setCurrentJobToken(job_token);
      pollJob(job_token);
    } catch (err) {
      setError(getApiErrorMessage(err, "อัปโหลด Statement ไม่สำเร็จ"));
      setPhase("idle");
      setCurrentFiles([]);
    }
  };

  const handleEvidenceFiles = async (files: File[]) => {
    setError(null);
    setCurrentFiles(files.map((file) => file.name));
    setPhase("uploading");
    try {
      const images = files.filter((file) => imageExtensions.has(file.name.split(".").pop()?.toLowerCase() ?? ""));
      const documents = files.filter((file) => !images.includes(file));
      if (images.length > 10) throw new Error("เลือกภาพได้ไม่เกิน 10 ไฟล์ต่อครั้ง");
      const oversizedImage = images.find((file) => file.size > 8 * 1024 * 1024);
      if (oversizedImage) throw new Error(`${oversizedImage.name} มีขนาดเกิน 8 MB`);
      let documentRows = 0;
      for (const file of documents) {
        const result = await referenceItemsApi.upload(file);
        documentRows += result.inserted;
      }
      if (images.length > 0) {
        const { job_token } = await statementsApi.uploadImages(images);
        setCurrentJobToken(job_token);
        if (documentRows > 0) showToast(`อ่านไฟล์เอกสารแล้ว ${documentRows} รายการ กำลังอ่านรูปภาพต่อ...`);
        pollJob(job_token);
        return;
      }
      showToast(`อ่านหลักฐานสำเร็จ ${documentRows} รายการ`);
      setPhase("idle");
      setCurrentFiles([]);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "อัปโหลดหลักฐานไม่สำเร็จ"));
      setPhase("idle");
      setCurrentFiles([]);
    }
  };

  const setReviewRowIncluded = (index: number, include: boolean) => {
    setReviewRows((current) => current.map(
      (row, rowIndex) => rowIndex === index ? { ...row, include } : row,
    ));
    setReviewConfirmed(false);
  };

  const closeEvidenceReview = async () => {
    const token = preview?.preview_token;
    setPreview(null);
    setReviewRows([]);
    setReviewError(null);
    setPreviewImageError(null);
    setReviewConfirmed(false);
    replacePreviewImages([]);
    if (token) await statementsApi.cancelPreview(token).catch(() => undefined);
  };

  const saveEvidenceReview = async () => {
    if (!preview || !reviewConfirmed) return;
    const includedRows = reviewRows.filter((row) => row.include);
    if (includedRows.length === 0) {
      setReviewError("กรุณาเลือกอย่างน้อย 1 รายการที่จะบันทึก");
      return;
    }
    setSavingReview(true);
    setReviewError(null);
    try {
      const result = await statementsApi.confirmPreview(
        preview.preview_token,
        reviewRows.map((row) => ({ ...row, reviewed: true })),
      );
      const inserted = result.inserted ?? 0;
      setPreview(null);
      setReviewRows([]);
      setReviewConfirmed(false);
      setPreviewImageError(null);
      replacePreviewImages([]);
      showToast(`บันทึกหลักฐานแล้ว ${inserted} รายการ`);
      await load();
    } catch (err) {
      setReviewError(getApiErrorMessage(err, "บันทึกหลักฐานไม่สำเร็จ กรุณาลองใหม่"));
    } finally {
      setSavingReview(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("ลบ Statement นี้และรายการทั้งหมดที่อยู่ในไฟล์หรือไม่?")) return;
    try {
      await statementsApi.delete(id);
      showToast("ลบ Statement แล้ว");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err, "ลบ Statement ไม่สำเร็จ"));
    }
  };

  const openStatement = (statement: Statement, tab: "transactions" | "review" = "transactions") => {
    navigate(`/statement?tab=${tab}&statement_id=${statement.id}`);
  };

  const openEvidence = (sourceFilename: string) => {
    navigate(`/statement?tab=references&source=${encodeURIComponent(sourceFilename)}`);
  };

  const busy = phase !== "idle";
  const previewWarnings = preview && Array.isArray(preview.statement.warnings)
    ? preview.statement.warnings as string[]
    : [];
  const hasIncludedReviewRows = reviewRows.some((row) => row.include);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <StatementJourney active="upload" />
      <PageHeader
        title="เพิ่มไฟล์เพื่อเริ่มตรวจยอด"
        subtitle="เลือกประเภทไฟล์ให้ถูกฝั่ง เมื่ออ่านเสร็จแล้วสามารถกดชื่อไฟล์เพื่อดูรายการได้ทันที"
      />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p className="whitespace-pre-line text-xs leading-5 text-rose-700">{error}</p>
          </div>
          <button type="button" aria-label="ปิดข้อความ" onClick={() => setError(null)} className="text-rose-400">✕</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <UploadCard
          icon={<FileSpreadsheet className="h-5 w-5" />}
          title="Statement บัตรหรือธนาคาร"
          description="ใช้สำหรับอ่านเงินเข้า เงินออก วันที่ และเลขท้ายบัตร"
          formats="PDF, XLSX หรือ CSV · ครั้งละ 1 ไฟล์"
          actionLabel="เลือกไฟล์ Statement"
          tone="sky"
          active={dragTarget === "statement"}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={() => setDragTarget("statement")}
          onDragLeave={() => setDragTarget(null)}
          onDrop={(files) => { setDragTarget(null); if (files[0]) handleStatementFile(files[0]); }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleStatementFile(file);
            event.target.value = "";
          }}
        />

        <UploadCard
          icon={<ImagePlus className="h-5 w-5" />}
          title="หลักฐานค่าโฆษณา"
          description="ระบบอ่านข้อความในเครื่อง แล้วให้คุณตรวจและแก้ก่อนบันทึกทุกครั้ง"
          formats="รูปภาพไม่เกิน 10 ไฟล์ (ไฟล์ละไม่เกิน 8 MB) หรือ PDF, XLSX, CSV"
          actionLabel="เลือกไฟล์หลักฐาน"
          tone="violet"
          active={dragTarget === "evidence"}
          disabled={busy}
          onClick={() => evidenceInputRef.current?.click()}
          onDragEnter={() => setDragTarget("evidence")}
          onDragLeave={() => setDragTarget(null)}
          onDrop={(files) => { setDragTarget(null); if (files.length) handleEvidenceFiles(files); }}
        />
        <input
          ref={evidenceInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.csv"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) handleEvidenceFiles(files);
            event.target.value = "";
          }}
        />
      </div>

      {busy && (
        <Card className="overflow-hidden border-sky-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{(phase === "processing" && jobMessage) || PHASE_MESSAGE[phase]}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{currentFiles.join(", ")}</p>
                <div className="mt-3 grid grid-cols-3 gap-1 text-[10px]">
                  {["อัปโหลด", "อ่านข้อมูล", "บันทึกรายการ"].map((label, index) => {
                    const current = phase === "uploading" ? 0 : phase === "processing" ? 1 : 2;
                    return <span key={label} className={cn("rounded-full px-2 py-1 text-center", index <= current ? "bg-sky-100 font-semibold text-sky-700" : "bg-muted text-muted-foreground")}>{label}</span>;
                  })}
                </div>
              </div>
              {currentJobToken && phase === "processing" && (
                <button type="button" onClick={cancelCurrentJob} className="shrink-0 rounded-md border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600">ยกเลิก</button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Statement ที่อัปโหลดแล้ว</p>
                <p className="mt-0.5 text-xs text-muted-foreground">กดที่ชื่อไฟล์เพื่อเปิดดูรายการภายใน</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{statements.length} ไฟล์</span>
            </div>
            {loading ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : statements.length === 0 ? (
              <FriendlyEmpty title="ยังไม่มี Statement" description="อัปโหลดไฟล์ด้านบน แล้วไฟล์ล่าสุดจะมาแสดงตรงนี้" icon={<FileText className="h-5 w-5" />} />
            ) : (
              <div className="divide-y">
                {statements.map((statement) => (
                  <div key={statement.id} className={cn("group flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center", lastSavedStatementId === statement.id && "bg-emerald-50/50")}>
                    <button type="button" onClick={() => openStatement(statement)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700"><FileSpreadsheet className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground group-hover:text-sky-700">{statement.original_filename}</span>
                          {lastSavedStatementId === statement.id && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">ไฟล์ล่าสุด</span>}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">{statement.issuer || "ยังไม่ทราบธนาคาร"} · {statement.row_count} รายการ · {formatDate(statement.uploaded_at)}</span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">ตรวจแล้ว {statement.matched_count}</span>
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">รอตรวจ {statement.unmatched_count}</span>
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center justify-end gap-2 sm:pl-0">
                      <button type="button" onClick={() => openStatement(statement, "review")} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted"><FileSearch className="h-3.5 w-3.5" /> ตรวจยอด</button>
                      <button type="button" onClick={() => openStatement(statement)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-2.5 text-xs font-medium text-white hover:bg-sky-700">ดูรายการ <ArrowRight className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label={`ลบ ${statement.original_filename}`} onClick={() => handleDelete(statement.id)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold">หลักฐานล่าสุด</p>
              <p className="mt-0.5 text-xs text-muted-foreground">ไฟล์ที่ใช้เทียบกับยอดจากบัตร</p>
            </div>
            {loading ? (
              <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : evidenceSources.length === 0 ? (
              <FriendlyEmpty title="ยังไม่มีหลักฐาน" description="เพิ่มรูปภาพหรือเอกสารหลักฐานจากช่องอัปโหลดด้านบน" icon={<FileImage className="h-5 w-5" />} />
            ) : (
              <div className="divide-y">
                {evidenceSources.slice(0, 5).map((source) => (
                  <button key={source.source_filename} type="button" onClick={() => openEvidence(source.source_filename)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/20">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><FileImage className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{source.source_filename}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{source.total} รายการ · ตรวจแล้ว {source.matched}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => { if (!open && !savingReview) void closeEvidenceReview(); }}>
        <DialogContent className="flex max-h-[92vh] max-w-7xl flex-col overflow-hidden">
          <DialogHeader className="border-b pb-4 pr-12">
            <DialogTitle>ตรวจข้อมูลจากรูปก่อนบันทึก</DialogTitle>
            <DialogDescription>ข้อมูลด้านขวาเป็นผลที่ระบบอ่านได้และแก้ไขไม่ได้ หากข้อมูลไม่ถูกต้องให้ยกเลิกแล้วใช้รูปที่ชัดขึ้น</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,.9fr)_minmax(520px,1.1fr)]">
            <section className="min-h-0 overflow-auto border-b bg-slate-50 p-4 lg:border-b-0 lg:border-r">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">รูปหลักฐาน</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{previewImages[selectedPreviewImage]?.name ?? "ไม่พบรูป Preview"}</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 shadow-sm">{previewImages.length} รูป</span>
              </div>
              {previewImages.length > 0 ? (
                <>
                  <div className="grid min-h-[340px] place-items-center overflow-hidden rounded-xl border bg-white p-2">
                    <img
                      src={previewImages[selectedPreviewImage]?.url}
                      alt={previewImages[selectedPreviewImage]?.name ?? "รูปหลักฐาน"}
                      className="max-h-[55vh] w-full object-contain"
                      onError={() => setPreviewImageError("เปิดรูปหลักฐานไม่ได้ กรุณายกเลิกแล้วอัปโหลดใหม่")}
                    />
                  </div>
                  {previewImages.length > 1 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {previewImages.map((image, index) => (
                        <button key={image.url} type="button" onClick={() => setSelectedPreviewImage(index)} className={cn("h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-white", selectedPreviewImage === index ? "border-violet-500" : "border-transparent")}>
                          <img src={image.url} alt={image.name} className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                  {previewImageError && (
                    <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{previewImageError}</p>
                  )}
                </>
              ) : (
                <FriendlyEmpty title="เปิดรูปหลักฐานไม่ได้" description={previewImageError || "กรุณายกเลิกแล้วอัปโหลดรูปใหม่"} icon={<FileImage className="h-5 w-5" />} />
              )}
            </section>

            <section className="min-h-0 overflow-auto p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold">รายการที่ระบบอ่านได้</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">แสดงตามข้อมูลจากรูปเท่านั้น ไม่สามารถแก้ไขข้อความหรือตัวเลขได้</p>
              </div>

              {previewWarnings.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {previewWarnings.map((warning) => <p key={warning}>• {warning}</p>)}
                </div>
              )}

              {reviewRows.length === 0 ? (
                <FriendlyEmpty
                  title="ระบบยังอ่านรายการไม่ได้"
                  description="ไม่มีข้อมูลให้บันทึก กรุณายกเลิกแล้วอัปโหลดรูปที่ชัดขึ้น"
                  icon={<FileSearch className="h-5 w-5" />}
                />
              ) : (
                <div className="space-y-3">
                  {reviewRows.map((row, index) => {
                    const amount = row.amount.trim() && Number.isFinite(Number(row.amount))
                      ? formatCurrency(Number(row.amount))
                      : "อ่านไม่พบ";
                    return (
                      <article key={index} className={cn("rounded-xl border p-3 transition", row.include ? "bg-white" : "bg-muted/30 opacity-60")}>
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">รายการที่ {index + 1}</span>
                            {row.warnings.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">กรุณาตรวจ</span>}
                          </div>
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <input type="checkbox" checked={row.include} onChange={(event) => setReviewRowIncluded(index, event.target.checked)} />
                            บันทึกรายการนี้
                          </label>
                        </div>
                        {row.warnings.length > 0 && <p className="mb-3 text-[11px] leading-5 text-amber-700">{row.warnings.join(" · ")}</p>}
                        <dl className="grid gap-3 sm:grid-cols-2">
                          <EvidenceValue label="วันที่" value={row.transaction_date ? formatDate(row.transaction_date) : "อ่านไม่พบ"} />
                          <EvidenceValue label="ยอดเงิน" value={amount} emphasize />
                          <EvidenceValue label="รายละเอียด" value={row.description || "อ่านไม่พบ"} wide />
                          <EvidenceValue label="เลขอ้างอิง" value={row.tr_code || "อ่านไม่พบ"} />
                          <EvidenceValue label="เลขท้ายบัตร" value={row.card_last4 ? `•••• ${row.card_last4}` : "อ่านไม่พบ"} />
                          <EvidenceValue label="มาจากรูป" value={row.channel || "ไม่ทราบชื่อไฟล์"} wide />
                        </dl>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {reviewError && <div className="mx-6 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{reviewError}</div>}
          <DialogFooter className="flex-col border-t sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} disabled={!hasIncludedReviewRows} className="mt-0.5" />
              ฉันตรวจแล้วและยืนยันให้บันทึกตามข้อมูลที่ระบบอ่านได้ข้างต้น
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => void closeEvidenceReview()} disabled={savingReview} className="h-10 rounded-md border bg-background px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50">ยกเลิก</button>
              <button type="button" onClick={saveEvidenceReview} disabled={!reviewConfirmed || !hasIncludedReviewRows || savingReview} className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                {savingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}ยืนยันและบันทึก
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] flex max-w-sm items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>
          <p className="text-xs font-semibold leading-5 text-slate-700">{toast}</p>
        </div>
      )}
    </div>
  );
}

function EvidenceValue({
  label,
  value,
  emphasize = false,
  wide = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn("rounded-lg bg-slate-50 px-3 py-2.5", wide && "sm:col-span-2")}>
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 break-words text-sm text-foreground", emphasize && "font-semibold tabular-nums")}>{value}</dd>
    </div>
  );
}

function UploadCard({
  icon, title, description, formats, actionLabel, tone, active, disabled,
  onClick, onDrop, onDragEnter, onDragLeave,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  formats: string;
  actionLabel: string;
  tone: "sky" | "violet";
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  onDrop: (files: File[]) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
}) {
  return (
    <Card className={cn("overflow-hidden transition", active && (tone === "sky" ? "border-sky-400 ring-2 ring-sky-100" : "border-violet-400 ring-2 ring-violet-100"))}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "sky" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700")}>{icon}</span>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          onDragEnter={(event) => { event.preventDefault(); onDragEnter(); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { event.preventDefault(); onDragLeave(); }}
          onDrop={(event) => { event.preventDefault(); onDrop(Array.from(event.dataTransfer.files)); }}
          className={cn(
            "mt-4 flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-5 py-6 text-center transition disabled:cursor-not-allowed disabled:opacity-50",
            tone === "sky" ? "border-sky-300 bg-sky-50/50 text-sky-700 hover:bg-sky-50" : "border-violet-300 bg-violet-50/50 text-violet-700 hover:bg-violet-50",
          )}
        >
          <UploadCloud className="h-6 w-6" />
          <span className="text-xs font-semibold">ลากไฟล์มาวาง หรือ{actionLabel}</span>
          <span className="text-[11px] opacity-75">{formats}</span>
        </button>
      </CardContent>
    </Card>
  );
}
