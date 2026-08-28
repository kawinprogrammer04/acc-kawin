import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle, ArrowRight, CheckCircle2, FileImage, FileSearch, FileSpreadsheet,
  FileText, ImagePlus, Loader2, Trash2, UploadCloud,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import {
  referenceItemsApi, statementsApi, type ReferenceSource, type Statement, type UploadJobStatus,
} from "@/api/statement";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FriendlyEmpty, StatementJourney } from "./StatementUx";

type Phase = "idle" | "uploading" | "processing" | "saving";
type DropTarget = "statement" | "evidence" | null;

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  const saveAutomatically = useCallback(async (previewToken: string) => {
    setPhase("saving");
    try {
      const preview = await statementsApi.getPreview(previewToken);
      const rows = preview.rows.map((row) => ({
        include: row.include,
        reviewed: true,
        transaction_date: row.transaction_date ?? "",
        description: row.description ?? "",
        amount: row.amount != null ? String(row.amount) : "",
        card_last4: row.card_last4 ?? "",
        tr_code: row.tr_code ?? "",
      }));
      const result = await statementsApi.confirmPreview(previewToken, rows);
      if (result.kind === "reference_items") {
        showToast(`อ่านหลักฐานสำเร็จ ${result.inserted ?? 0} รายการ`);
      } else {
        setLastSavedStatementId(result.statement_id ?? null);
        showToast("อัปโหลด Statement สำเร็จแล้ว — กดชื่อไฟล์เพื่อดูรายการได้ทันที");
      }
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "บันทึกข้อมูลจากไฟล์ไม่สำเร็จ"));
      await statementsApi.cancelPreview(previewToken).catch(() => undefined);
    } finally {
      setPhase("idle");
      setCurrentFiles([]);
      setJobMessage("");
    }
  }, [load]);

  const pollJob = useCallback((jobToken: string) => {
    setPhase("processing");
    pollRef.current = window.setInterval(async () => {
      try {
        const status: UploadJobStatus = await statementsApi.jobStatus(jobToken);
        setJobMessage(status.message);
        if (status.status === "complete" && status.preview_token) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          await saveAutomatically(status.preview_token);
        } else if (status.status === "failed" || status.status === "missing") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setError(status.error || "ระบบอ่านไฟล์ไม่สำเร็จ กรุณาตรวจไฟล์แล้วลองอีกครั้ง");
          setPhase("idle");
          setCurrentFiles([]);
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setError(getApiErrorMessage(err, "ตรวจสอบสถานะการอ่านไฟล์ไม่สำเร็จ"));
        setPhase("idle");
        setCurrentFiles([]);
      }
    }, 1500);
  }, [saveAutomatically]);

  const handleStatementFile = async (file: File) => {
    setError(null);
    setLastSavedStatementId(null);
    setCurrentFiles([file.name]);
    setPhase("uploading");
    try {
      const { job_token } = await statementsApi.upload(file);
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
      let documentRows = 0;
      for (const file of documents) {
        const result = await referenceItemsApi.upload(file);
        documentRows += result.inserted;
      }
      if (images.length > 0) {
        const { job_token } = await statementsApi.uploadImages(images);
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
          description="ระบบจะพยายามอ่านช่องทาง ยอด วันที่ เลขอ้างอิง และเลขบัตรจากไฟล์ให้"
          formats="รูปภาพหลายไฟล์ หรือ PDF, XLSX, CSV"
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] flex max-w-sm items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-xl">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>
          <p className="text-xs font-semibold leading-5 text-slate-700">{toast}</p>
        </div>
      )}
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

