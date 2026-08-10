import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Clock3, Eye, FileText, Loader2, Pencil,
  RotateCcw, Send, Trash2, XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getApiErrorMessage } from "@/api/client";
import { approvalInboxApi, expenseRequestsApi } from "@/api/approvals";
import type { ExpenseRequestDetail } from "@/api/approvals";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";

const statusLabel: Record<string, string> = {
  draft: "แบบร่าง", pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ", cancelled: "ยกเลิกแล้ว",
};

const statusColor: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700", rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const requestFormatLabel: Record<string, string> = {
  reimbursement: "เบิกค่าใช้จ่าย", advance: "ขอเงินทดรอง", direct_payment: "ชำระตรงให้ผู้ขาย",
};

const recipientTypeLabel: Record<string, string> = {
  employee: "พนักงาน", individual: "บุคคลภายนอก", company: "นิติบุคคล",
};

const stepStatusLabel: Record<string, string> = {
  waiting: "รอตามลำดับ", pending: "รอพิจารณา", approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ", skipped: "ข้ามขั้นตอน",
};

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><div className="mt-1 font-medium">{value || "-"}</div></div>;
}

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return <div><h2 className="text-lg font-semibold">{children}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>;
}

export function ExpenseRequestDetailPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [request, setRequest] = useState<ExpenseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true); setError("");
    try { setRequest(await expenseRequestsApi.get(requestId)); }
    catch (e) { setError(getApiErrorMessage(e, "โหลดรายละเอียดคำขอไม่สำเร็จ")); }
    finally { setLoading(false); }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const pendingStep = useMemo(
    () => request?.steps.find((step) => step.status === "pending" && step.resolved_approver_user_id === user?.id),
    [request, user?.id],
  );

  const submit = async () => {
    if (!requestId) return;
    setSaving(true); setError("");
    try { await expenseRequestsApi.submit(requestId); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ส่งคำขอเพื่ออนุมัติไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!requestId || !window.confirm("ยืนยันยกเลิกคำขอแบบร่างนี้หรือไม่?")) return;
    setSaving(true); setError("");
    try { await expenseRequestsApi.cancel(requestId); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ยกเลิกคำขอไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!requestId || !window.confirm("ลบทิ้งถาวรหรือไม่? ข้อมูลและเอกสารทั้งหมดของคำขอนี้จะกู้คืนไม่ได้")) return;
    setSaving(true); setError("");
    try { await expenseRequestsApi.permanentlyDelete(requestId); navigate("/expense-requests", { replace: true }); }
    catch (e) { setError(getApiErrorMessage(e, "ลบทิ้งถาวรไม่สำเร็จ")); setSaving(false); }
  };

  const decide = async (action: "approve" | "reject") => {
    if (!pendingStep) return;
    if (action === "reject" && !comment.trim()) { setError("กรุณาระบุเหตุผลที่ไม่อนุมัติ"); return; }
    setSaving(true); setError("");
    try {
      await approvalInboxApi.decide(pendingStep.id, {
        action, comment: comment.trim() || undefined,
        idempotency_key: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${pendingStep.id}-${Date.now()}`,
      });
      setComment(""); await load();
    } catch (e) { setError(getApiErrorMessage(e, "บันทึกผลการพิจารณาไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!request) return <div className="p-6"><Link to="/expense-requests" className="text-primary hover:underline">กลับไปหน้ารายการ</Link><p className="mt-4 text-rose-600">{error || "ไม่พบคำขอ"}</p></div>;

  const isOwner = request.requester_user_id === user?.id;
  const canEdit = isOwner && request.status === "draft";
  const canDelete = isOwner && ["draft", "cancelled"].includes(request.status);
  const primary = request.attachments.filter((item) => item.attachment_type === "primary");
  const supporting = request.attachments.filter((item) => item.attachment_type === "supporting");

  return <div className="mx-auto max-w-6xl space-y-5 p-6">
    <Link to="/expense-requests" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> กลับไปแสดงรายการที่ขอเบิกทั้งหมด
    </Link>

    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{request.request_no || "คำขอเบิกค่าใช้จ่าย"}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor[request.status]}`}>{statusLabel[request.status]}</span>
        </div>
        <p className="mt-2 text-lg">{request.title}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canEdit && <Link to={`/expense-requests/${request.id}/edit?step=0`} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"><Pencil className="h-4 w-4" /> แก้ไข</Link>}
        {canEdit && <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /> ส่งอนุมัติ</button>}
        {canEdit && <button onClick={cancel} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><XCircle className="h-4 w-4" /> ยกเลิก</button>}
        {canDelete && <button onClick={remove} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /> ลบทิ้งถาวร</button>}
      </div>
    </div>

    {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

    <Card><CardContent className="space-y-6 p-6">
      <SectionTitle>ข้อมูลคำขอ</SectionTitle>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="ผู้ขอ" value={request.requester_name} />
        <Field label="รูปแบบ" value={requestFormatLabel[request.request_format]} />
        <Field label="ประเภท" value={request.expense_type_name} />
        <Field label="ตำแหน่ง" value={request.requester_position_name} />
        <Field label="วันที่ต้องการใช้" value={formatDate(`${request.request_date}T00:00:00`)} />
        <Field label="บริษัทผู้จ่าย" value={request.payer_company_name} />
        <div className="sm:col-span-2"><Field label="วัตถุประสงค์" value={request.description || request.title} /></div>
      </div>
    </CardContent></Card>

    <Card><CardContent className="space-y-5 p-6">
      <SectionTitle>รายการค่าใช้จ่าย</SectionTitle>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/30"><tr>{["รายการ", "จำนวน", "หน่วย", "ราคา/หน่วย", "รวม"].map((heading) => <th key={heading} className={`px-4 py-3 text-xs font-medium text-muted-foreground ${["จำนวน", "ราคา/หน่วย", "รวม"].includes(heading) ? "text-right" : "text-left"}`}>{heading}</th>)}</tr></thead>
          <tbody className="divide-y">{request.items.map((item, index) => <tr key={item.id || index}>
            <td className="px-4 py-3 font-medium">{item.description}</td><td className="px-4 py-3 text-right">{formatNumber(item.quantity)}</td><td className="px-4 py-3">{item.unit}</td><td className="px-4 py-3 text-right">{formatNumber(item.unit_price)}</td><td className="px-4 py-3 text-right font-semibold">{formatNumber(item.line_total)}</td>
          </tr>)}</tbody>
          <tfoot className="border-t bg-muted/20"><tr><td colSpan={4} className="px-4 py-4 text-right font-semibold">ยอดอนุมัติรวม</td><td className="px-4 py-4 text-right text-lg font-bold">{formatCurrency(request.payable_total || request.amount)}</td></tr></tfoot>
        </table>
        {request.items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีรายการค่าใช้จ่าย</p>}
      </div>
    </CardContent></Card>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardContent className="space-y-5 p-6">
        <SectionTitle>ข้อมูลรับเงิน</SectionTitle>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="ประเภทผู้รับเงินจริง" value={recipientTypeLabel[request.recipient_type || ""]} />
          <Field label="ผู้รับเงิน" value={request.recipient_name} />
          <Field label="ธนาคาร" value={request.bank_name} />
          <Field label="ชื่อบัญชี" value={request.bank_account_name} />
          <div className="sm:col-span-2"><Field label="เลขบัญชี" value={request.bank_account_number || request.bank_account_masked} /></div>
        </div>
      </CardContent></Card>
      <Card><CardContent className="space-y-5 p-6">
        <SectionTitle>ภาษีหัก ณ ที่จ่าย</SectionTitle>
        {request.withholding_required ? <div className="space-y-4">
          <p className="font-medium text-amber-700">ผู้ขอแจ้งว่ารายการนี้ต้องหัก ณ ที่จ่าย</p>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="อัตราโดยประมาณ" value={request.withholding_mode === "rate" ? `${formatNumber(request.withholding_rate)}%` : formatCurrency(request.withholding_amount)} /><Field label="ยอดจ่ายสุทธิ" value={formatCurrency(request.payable_total)} /><Field label="ชื่อผู้เสียภาษี" value={request.taxpayer_name} /><Field label="เลขประจำตัวผู้เสียภาษี" value={request.taxpayer_id} /></div>
        </div> : <div><p className="font-medium">ผู้ขอยังไม่ได้หักหรือนำส่ง</p><p className="mt-2 text-sm text-muted-foreground">รอฝ่ายบัญชีพิจารณาอัตราจริง</p></div>}
      </CardContent></Card>
    </div>

    <Card><CardContent className="space-y-6 p-6">
      <SectionTitle description="ตรวจสอบความครบถ้วนและชื่อไฟล์ของเอกสารคำขอ">เอกสาร</SectionTitle>
      {[{ title: "เอกสารหลักสำหรับอนุมัติ (PDF)", files: primary }, { title: "เอกสารประกอบเพิ่มเติม", files: supporting }].map((group) => <div key={group.title}>
        <div className="mb-2 flex items-center gap-2"><h3 className="font-medium">{group.title}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{group.files.length} ไฟล์</span></div>
        <div className="space-y-2">{group.files.map((file) => <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3"><FileText className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><p className="truncate font-medium">{file.file_name}</p><p className="text-xs text-muted-foreground">{file.attachment_type === "primary" ? "ระบบสร้าง" : "บันทึกแล้ว"} · {Math.max(1, Math.round(file.file_size / 1024))} KB</p></div></div>
          <button onClick={() => expenseRequestsApi.openAttachment(request.id, file.id)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Eye className="h-4 w-4" /> ดูไฟล์</button>
        </div>)}{group.files.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">ยังไม่มีเอกสาร</p>}</div>
      </div>)}
    </CardContent></Card>

    <Card><CardContent className="space-y-6 p-6">
      <SectionTitle description="ส่วนนี้เปิดใช้งานเมื่อคำขออยู่ระหว่างรอการพิจารณาจากคุณ">ตรวจ PDF และลงลายเซ็น</SectionTitle>
      {pendingStep ? <div className="space-y-4">
        <div className="rounded-lg border bg-muted/20 p-4"><p className="font-medium">ขั้นตอนที่ {pendingStep.step_no}: {pendingStep.approver_position_name}</p><p className="mt-1 text-sm text-muted-foreground">เปิดเอกสารด้านบนเพื่อตรวจสอบก่อนยืนยันผล</p></div>
        <div><label className="mb-1.5 block text-sm font-medium">หมายเหตุ (ถ้ามี)</label><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => decide("approve")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> ยืนยันอนุมัติ</button><button onClick={() => decide("reject")} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><XCircle className="h-4 w-4" /> ไม่อนุมัติ</button></div>
      </div> : <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{request.status === "draft" ? "ยังไม่ส่งอนุมัติ" : "คำขอนี้ไม่ได้อยู่ในขั้นที่รอการพิจารณาจากคุณ"}</div>}
    </CardContent></Card>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardContent className="space-y-5 p-6"><SectionTitle>เส้นทางอนุมัติ</SectionTitle>{request.steps.length ? <ol className="space-y-3">{request.steps.map((step) => <li key={step.id} className="flex gap-3 rounded-lg border p-4"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{step.step_no}</div><div><p className="font-medium">{step.approver_position_name || `ขั้นตอนที่ ${step.step_no}`}</p><p className="text-sm text-muted-foreground">{step.resolved_approver_name || "ยังไม่ระบุผู้อนุมัติ"} · {stepStatusLabel[step.status]}</p>{step.comment && <p className="mt-1 text-sm">{step.comment}</p>}</div></li>)}</ol> : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">ยังไม่ส่งอนุมัติ</p>}</CardContent></Card>
      <Card><CardContent className="space-y-5 p-6"><SectionTitle>ประวัติล่าสุด</SectionTitle><ol className="space-y-4">
        <li className="flex gap-3"><Clock3 className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><p className="font-medium">สร้างคำขอ</p><p className="text-sm text-muted-foreground">{formatDate(request.created_at)} · {request.requester_name}</p></div></li>
        {request.submitted_at && <li className="flex gap-3"><Send className="mt-0.5 h-5 w-5 text-amber-600" /><div><p className="font-medium">ส่งอนุมัติ</p><p className="text-sm text-muted-foreground">{formatDate(request.submitted_at)}</p></div></li>}
        {request.steps.filter((step) => step.decided_at).map((step) => <li key={step.id} className="flex gap-3">{step.status === "approved" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <RotateCcw className="mt-0.5 h-5 w-5 text-rose-600" />}<div><p className="font-medium">{stepStatusLabel[step.status]} · ขั้นตอนที่ {step.step_no}</p><p className="text-sm text-muted-foreground">{formatDate(step.decided_at)} · {step.resolved_approver_name}</p></div></li>)}
      </ol></CardContent></Card>
    </div>
  </div>;
}
