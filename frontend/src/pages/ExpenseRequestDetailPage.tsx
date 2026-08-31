import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Clock3, Download, Eye, FileText, Loader2, Pencil,
  Receipt, RotateCcw, Send, Trash2, Upload, XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { authApi, getApiErrorMessage } from "@/api/client";
import { approvalInboxApi, expenseRequestsApi } from "@/api/approvals";
import { expenseAccountingApi } from "@/api/approvals";
import type {
  ApprovalStepTimeline, ExpenseHistory, ExpensePaymentRecord, ExpenseRequestDetail,
  ExpenseSettlement, ExpenseWithholdingCertificate,
} from "@/api/approvals";
import { SignaturePad } from "@/components/expense/SignaturePad";
import { PdfSignatureWorkspace, initialPlacement } from "@/components/expense/PdfSignatureWorkspace";
import type { SignaturePlacement } from "@/components/expense/PdfSignatureWorkspace";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { formatCurrency, formatDate, formatDateTime, formatNumber, today } from "@/lib/format";

const fileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(String(reader.result).split(",", 2)[1]); reader.readAsDataURL(file);
});

const statusLabel: Record<string, string> = {
  draft: "แบบร่าง", pending: "รออนุมัติ", pending_approval: "รออนุมัติ", approved: "อนุมัติแล้ว",
  ready_to_pay: "พร้อมจ่าย", partially_paid: "จ่ายบางส่วน", settlement_due: "รอเคลียร์เงิน", settlement_review: "รอตรวจเคลียร์",
  completed: "เสร็จสิ้น", returned_for_correction: "ส่งกลับให้แก้ไข", pending_adjustment_approval: "รออนุมัติส่วนต่าง",
  rejected: "ไม่อนุมัติ", cancelled: "ยกเลิกแล้ว", accounting_review: "บัญชีตรวจรายการเดิม", paid: "จ่ายแล้ว",
};

const statusColor: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700", rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
  ready_to_pay: "bg-sky-100 text-sky-700", partially_paid: "bg-teal-100 text-teal-700",
  settlement_due: "bg-orange-100 text-orange-700",
  settlement_review: "bg-violet-100 text-violet-700", completed: "bg-emerald-100 text-emerald-700",
  returned_for_correction: "bg-amber-100 text-amber-700", pending_approval: "bg-amber-100 text-amber-700",
  pending_adjustment_approval: "bg-amber-100 text-amber-700", accounting_review: "bg-sky-100 text-sky-700",
};

const requestFormatLabel: Record<string, string> = {
  reimbursement: "เบิกค่าใช้จ่าย", advance: "ขอเงินทดรอง", direct_payment: "ชำระตรงให้ผู้ขาย",
};

const recipientTypeLabel: Record<string, string> = {
  employee: "พนักงาน", individual: "บุคคลภายนอก", company: "นิติบุคคล",
};

const stepStatusLabel: Record<string, string> = {
  waiting: "รอตามลำดับ", active: "กำลังอนุมัติ", pending: "รอพิจารณา", approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ", returned: "ส่งคืนแก้ไข", returned_for_correction: "ส่งคืนแก้ไข", skipped: "ข้ามขั้นตอน",
};

const completedStepStatuses = ["approved", "completed", "skipped"];

const historyEventLabel: Record<string, string> = {
  payment_recorded: "บันทึกจ่ายเงิน",
  payment_proof_replaced: "แก้ไขหลักฐานการโอน",
  wht_certificate_issued: "ออกหนังสือรับรองหัก ณ ที่จ่าย",
  accounting_returned: "ฝ่ายบัญชีส่งคืนให้แก้ไข",
  accounting_cancelled: "ฝ่ายบัญชียกเลิกคำขอ",
  settlement_submitted: "ส่งข้อมูลเคลียร์เงิน",
  settlement_approved: "ตรวจผ่านและปิดรายการ",
  settlement_returned: "ตีกลับข้อมูลเคลียร์เงิน",
};

function getStepApprovers(step: ApprovalStepTimeline) {
  return step.approvers?.length
    ? step.approvers
    : [{ name: step.resolved_approver_name, status: step.status, acted_at: step.decided_at }];
}

function ApprovalPath({ steps, currentStepNo, approvedAt }: { steps: ApprovalStepTimeline[]; currentStepNo?: number; approvedAt?: string }) {
  const orderedSteps = [...steps].sort((left, right) => left.step_no - right.step_no);
  const currentStep = (currentStepNo ? orderedSteps.find((step) => step.step_no === currentStepNo) : undefined)
    || orderedSteps.find((step) => ["pending", "active"].includes(step.status))
    || orderedSteps.find((step) => !completedStepStatuses.includes(step.status) && step.status !== "waiting")
    || orderedSteps.find((step) => !completedStepStatuses.includes(step.status));

  if (orderedSteps.length === 0) {
    return <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{approvedAt ? "อนุมัติครบแล้ว แต่ไม่มีรายละเอียดเส้นทาง" : "ยังไม่ส่งอนุมัติ"}</p>;
  }

  return <div className="space-y-4">
    <div className={`rounded-xl border px-4 py-3 ${currentStep ? "border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30" : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30"}`}>
      {currentStep
        ? <><p className="text-xs font-bold text-amber-700 dark:text-amber-300">กำลังดำเนินการ · ขั้นที่ {currentStep.step_no} จาก {orderedSteps.length}</p><p className="mt-1 font-black">{currentStep.name || currentStep.approver_position_name || `ขั้นตอนที่ ${currentStep.step_no}`}</p><p className="mt-1 text-sm text-muted-foreground">ผู้อนุมัติ: {getStepApprovers(currentStep).filter((approver) => !completedStepStatuses.includes(approver.status)).map((approver) => approver.name).filter(Boolean).join(", ") || "ยังไม่ระบุผู้อนุมัติ"}</p></>
        : <><p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">อนุมัติครบทุกขั้นตอน</p>{approvedAt && <p className="mt-1 text-sm text-muted-foreground">อนุมัติครบเมื่อ {formatDateTime(approvedAt)}</p>}</>}
    </div>
    <ol className="space-y-0">
      {orderedSteps.map((step, index) => {
        const isCompleted = completedStepStatuses.includes(step.status);
        const isCurrent = currentStep?.id === step.id;
        const isRejected = ["rejected", "returned", "returned_for_correction"].includes(step.status);
        const people = getStepApprovers(step);
        return <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < orderedSteps.length - 1 && <span className={`absolute left-[11px] top-7 h-[calc(100%-1.25rem)] w-0.5 ${isCompleted ? "bg-emerald-300" : "bg-border"}`} aria-hidden="true" />}
          <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-black ${isCompleted ? "border-emerald-500 bg-emerald-500 text-white" : isRejected ? "border-rose-500 bg-rose-50 text-rose-600" : isCurrent ? "border-amber-500 bg-amber-100 text-amber-700" : "border-muted-foreground/30 bg-background text-muted-foreground"}`}>
            {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.step_no}
          </span>
          <div className={`min-w-0 flex-1 rounded-xl border px-4 py-3 ${isCurrent ? "border-amber-300 bg-amber-50/50 shadow-sm dark:border-amber-700 dark:bg-amber-950/20" : isCompleted ? "border-emerald-100 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/10" : "bg-background"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold text-muted-foreground">ขั้นที่ {step.step_no} จาก {orderedSteps.length}</p><p className="mt-0.5 font-bold">{step.name || step.approver_position_name || `ขั้นตอนที่ ${step.step_no}`}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${isCompleted ? "bg-emerald-100 text-emerald-700" : isRejected ? "bg-rose-100 text-rose-700" : isCurrent ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>{isCurrent ? "ขั้นตอนปัจจุบัน" : stepStatusLabel[step.status] || step.status}</span></div>
            <div className="mt-2 space-y-1.5">{people.map((approver, approverIndex) => <p key={`${step.id}-${approver.user_id || approverIndex}`} className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{approver.name || "ยังไม่ระบุผู้อนุมัติ"}</span> · {stepStatusLabel[approver.status] || approver.status}{approver.acted_at && <span className="ml-1 text-xs">· {formatDate(approver.acted_at)}</span>}</p>)}</div>
            {step.comment && <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">หมายเหตุ: {step.comment}</p>}
          </div>
        </li>;
      })}
    </ol>
  </div>;
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><div className="mt-1 font-medium">{value || "-"}</div></div>;
}

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return <div><h2 className="text-lg font-semibold">{children}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>;
}

export function ExpenseRequestDetailPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, can } = useAuth();
  const { currentCompany } = useCompany();
  const [request, setRequest] = useState<ExpenseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [rejectComment, setRejectComment] = useState("");
  const [signature, setSignature] = useState<string>();
  const [useSavedSignature, setUseSavedSignature] = useState(false);
  const [saveSignature, setSaveSignature] = useState(false);
  const [placements, setPlacements] = useState<SignaturePlacement[]>([]);
  const [histories, setHistories] = useState<ExpenseHistory[]>([]);
  const [settlements, setSettlements] = useState<ExpenseSettlement[]>([]);
  const [actualAmount, setActualAmount] = useState("");
  const [settlementNote, setSettlementNote] = useState("");
  const [refundProof, setRefundProof] = useState<File | null>(null);
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [nextInstallmentAmount, setNextInstallmentAmount] = useState("");
  const [payments, setPayments] = useState<ExpensePaymentRecord[]>([]);
  const [whtCertificates, setWhtCertificates] = useState<ExpenseWithholdingCertificate[]>([]);
  const [replacementProofs, setReplacementProofs] = useState<Record<string, File | null>>({});
  const [replacingPaymentId, setReplacingPaymentId] = useState<string | null>(null);
  const [issuingWht, setIssuingWht] = useState(false);
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null);
  const [accountingReturnReason, setAccountingReturnReason] = useState("");
  const [accountingCancelReason, setAccountingCancelReason] = useState("");
  const [settlementReviewNote, setSettlementReviewNote] = useState("");

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true); setError("");
    try {
      const detail = await expenseRequestsApi.get(requestId); setRequest(detail);
      setPaymentAmount(String(detail.remaining ?? ""));
      const [historyRows, settlementRows, paymentRows, certificateRows] = await Promise.all([
        expenseAccountingApi.histories(requestId).catch(() => []), expenseAccountingApi.settlements(requestId).catch(() => []),
        expenseAccountingApi.payments(requestId).catch(() => []),
        expenseAccountingApi.whtCertificates(requestId).catch(() => []),
      ]); setHistories(historyRows); setSettlements(settlementRows); setPayments(paymentRows); setWhtCertificates(certificateRows);
    }
    catch (e) { setError(getApiErrorMessage(e, "โหลดรายละเอียดคำขอไม่สำเร็จ")); }
    finally { setLoading(false); }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const pendingStep = useMemo(
    () => request?.steps.find((step) => step.status === "pending" && step.resolved_approver_user_id === user?.id),
    [request, user?.id],
  );
  const signableDocuments = useMemo(
    () => request?.attachments.filter((attachment) =>
      attachment.attachment_type === "primary" || attachment.requires_signature,
    ) || [],
    [request?.attachments],
  );

  // Placing the signature box precisely isn't something an approver should be
  // forced to do — a sensible default position (last page, per-step slot on
  // the primary doc) is filled in automatically the moment the required
  // documents are known, so just drawing/picking a signature is enough to
  // approve. Opening "ตรวจเอกสารและวางตำแหน่งลายเซ็น" to drag it elsewhere
  // still works and overrides these defaults via onChange={setPlacements}.
  useEffect(() => {
    if (!pendingStep || signableDocuments.length === 0) return;
    setPlacements((current) => {
      const byId = new Map(current.map((p) => [p.attachment_id, p]));
      if (signableDocuments.every((doc) => byId.has(doc.id))) return current;
      return signableDocuments.map((doc) => byId.get(doc.id) || initialPlacement(doc, pendingStep.step_no));
    });
  }, [signableDocuments, pendingStep]);

  const [savedSignatureUrl, setSavedSignatureUrl] = useState<string>();
  useEffect(() => {
    if (!pendingStep || !user?.has_saved_signature) { setSavedSignatureUrl(undefined); return; }
    let cancelled = false;
    authApi.mySignature().then((res) => { if (!cancelled) setSavedSignatureUrl(res.signature_data_url); })
      .catch(() => { if (!cancelled) setSavedSignatureUrl(undefined); });
    return () => { cancelled = true; };
  }, [pendingStep, user?.has_saved_signature]);

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

  const decide = async (action: "approve" | "reject" | "return") => {
    if (!pendingStep) return;
    const decisionComment = action === "return" ? returnComment : action === "reject" ? rejectComment : comment;
    if (action !== "approve" && !decisionComment.trim()) { setError("กรุณาระบุเหตุผล"); return; }
    if (action === "approve" && !signature && !useSavedSignature) { setError("กรุณาวาดหรือเลือกใช้ลายเซ็นก่อนอนุมัติ"); return; }
    if (action === "approve" && placements.length !== signableDocuments.length) { setError("กรุณากำหนดตำแหน่งลายเซ็นให้ครบทุกเอกสาร"); return; }
    setSaving(true); setError("");
    try {
      await approvalInboxApi.decide(pendingStep.id, {
        action, comment: decisionComment.trim() || undefined,
        idempotency_key: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${pendingStep.id}-${Date.now()}`,
        signature_data_url: action === "approve" ? signature : undefined,
        use_saved_signature: action === "approve" && useSavedSignature,
        save_signature: action === "approve" && saveSignature,
        placements: action === "approve" ? placements : undefined,
      });
      setComment(""); setReturnComment(""); setRejectComment("");
      if (action === "approve") { navigate("/approvals/inbox"); return; }
      await load();
    } catch (e) { setError(getApiErrorMessage(e, "บันทึกผลการพิจารณาไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const submitSettlement = async () => {
    if (!requestId || !request) return; const actual = Number(actualAmount);
    if (!Number.isFinite(actual) || actual < 0) { setError("กรุณาระบุยอดใช้จริง"); return; }
    if (actual < request.paid && !refundProof) { setError("กรณีมีเงินคืนต้องแนบหลักฐานคืนเงิน"); return; }
    setSaving(true); setError("");
    try {
      let proofBase64: string | undefined;
      if (refundProof) proofBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(",", 2)[1]); reader.readAsDataURL(refundProof); });
      await expenseAccountingApi.submitSettlement(requestId, {
        actual_amount: actual, note: settlementNote || undefined,
        items: [{ description: settlementNote || "สรุปค่าใช้จ่ายเงินทดรอง", quantity: 1, unit: "รายการ", unit_price: actual }],
        refund_proof_file_name: refundProof?.name, refund_proof_content_base64: proofBase64,
      }); setActualAmount(""); setSettlementNote(""); setRefundProof(null); await load();
    } catch (e) { setError(getApiErrorMessage(e, "ส่งเคลียร์เงินไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const reviewLegacy = async () => {
    if (!requestId) return; setSaving(true); setError("");
    try { await expenseAccountingApi.reviewLegacy(requestId); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ส่งต่อรายการพร้อมจ่ายไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const returnByAccounting = async () => {
    if (!requestId || !accountingReturnReason.trim()) { setError("กรุณาระบุเหตุผลที่ส่งคืนให้ผู้ขอแก้ไข"); return; }
    setSaving(true); setError("");
    try { await expenseAccountingApi.returnForCorrection(requestId, accountingReturnReason.trim()); setAccountingReturnReason(""); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ส่งคืนให้ผู้ขอแก้ไขไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const payByAccounting = async () => {
    if (!requestId || !request || !paymentProof) { setError("กรุณาแนบหลักฐานการโอน"); return; }
    const freeFormInstallment = request.installment_enabled && !request.installment_chain_root_id;
    const amount = freeFormInstallment ? Number(paymentAmount) : request.remaining;
    if (!(amount > 0) || amount > request.remaining) { setError("ยอดจ่ายต้องมากกว่า 0 และไม่เกินยอดคงเหลือ"); return; }
    setSaving(true); setError("");
    try {
      await expenseAccountingApi.pay(requestId, {
        amount, paid_at: new Date(`${paymentDate}T12:00:00`).toISOString(),
        method: "bank_transfer", reference_no: paymentReference.trim() || undefined,
        idempotency_key: crypto.randomUUID(), proof_file_name: paymentProof.name,
        proof_content_base64: await fileAsBase64(paymentProof),
      });
      setPaymentProof(null); setPaymentReference(""); await load();
    } catch (e) { setError(getApiErrorMessage(e, "บันทึกการจ่ายไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const createNextInstallment = async () => {
    if (!requestId) return;
    const amount = Number(nextInstallmentAmount);
    if (!(amount > 0)) { setError("กรุณาระบุยอดที่จะจ่ายงวดนี้"); return; }
    setSaving(true); setError("");
    try {
      const created = await expenseRequestsApi.createNextInstallment(requestId, { installment_payment_amount: amount });
      navigate(`/expense-requests/${created.id}/edit?step=1`);
    } catch (e) { setError(getApiErrorMessage(e, "สร้างงวดถัดไปไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const voidPaymentRow = async (paymentId: string) => {
    const reason = window.prompt("ระบุเหตุผลที่ยกเลิกรายการจ่ายนี้");
    if (!reason || !reason.trim()) return;
    setVoidingPaymentId(paymentId); setError("");
    try { await expenseAccountingApi.voidPayment(paymentId, reason.trim()); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ยกเลิกรายการจ่ายไม่สำเร็จ")); }
    finally { setVoidingPaymentId(null); }
  };

  const replacePaymentProof = async (paymentId: string) => {
    const file = replacementProofs[paymentId];
    if (!file) { setError("กรุณาเลือกไฟล์หลักฐานการโอนใหม่"); return; }
    setReplacingPaymentId(paymentId); setError("");
    try {
      await expenseAccountingApi.replacePaymentProof(paymentId, {
        proof_file_name: file.name,
        proof_content_base64: await fileAsBase64(file),
        reason: "แก้ไขหลักฐานการโอนจากหน้ารายการ",
      });
      setReplacementProofs(current => ({ ...current, [paymentId]: null }));
      await load();
    } catch (e) { setError(getApiErrorMessage(e, "แก้ไขหลักฐานการโอนไม่สำเร็จ")); }
    finally { setReplacingPaymentId(null); }
  };

  const issueWhtCertificate = async () => {
    if (!requestId) return;
    setIssuingWht(true); setError("");
    try { await expenseAccountingApi.issueWht(requestId); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ออกหนังสือรับรองหัก ณ ที่จ่ายไม่สำเร็จ")); }
    finally { setIssuingWht(false); }
  };

  const cancelByAccounting = async () => {
    if (!requestId || !accountingCancelReason.trim()) { setError("กรุณาระบุเหตุผลที่ยกเลิกคำขอ"); return; }
    if (!window.confirm(`ยืนยันยกเลิกคำขอ ${request?.request_no || "นี้"}? การกระทำนี้ย้อนกลับไม่ได้`)) return;
    setSaving(true); setError("");
    try { await expenseAccountingApi.cancel(requestId, accountingCancelReason.trim()); setAccountingCancelReason(""); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ยกเลิกคำขอโดยฝ่ายบัญชีไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const reviewSettlement = async (action: "approve" | "return") => {
    const settlement = settlements[settlements.length - 1];
    if (!settlement) return;
    setSaving(true); setError("");
    try { await expenseAccountingApi.reviewSettlement(settlement.id, action, settlementReviewNote.trim() || undefined); setSettlementReviewNote(""); await load(); }
    catch (e) { setError(getApiErrorMessage(e, action === "approve" ? "ตรวจเคลียร์เงินไม่สำเร็จ" : "ตีกลับข้อมูลเคลียร์เงินไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!request) return <div className="p-6"><Link to="/expense-requests" className="text-primary hover:underline">กลับไปหน้ารายการ</Link><p className="mt-4 text-rose-600">{error || "ไม่พบคำขอ"}</p></div>;

  const isOwner = request.requester_user_id === user?.id;
  const canEdit = isOwner && ["draft", "returned_for_correction"].includes(request.status);
  const canDelete = isOwner && ["draft", "cancelled"].includes(request.status);
  const hasAccountingRole = Boolean(user?.is_platform_admin || ["accountant", "admin", "super_admin"].includes(currentCompany?.role || ""));
  const canAccountingView = can("expense_accounting", "view");
  const canAccountingUpdate = hasAccountingRole && can("expense_accounting", "update");
  const canAccountingCancel = hasAccountingRole && can("expense_accounting", "delete");
  const canAccountingApprove = hasAccountingRole && can("expense_accounting", "approve");
  const activePayments = payments.filter((p) => !p.voided_at);
  const latestActivePaymentId = activePayments[activePayments.length - 1]?.id;
  const primary = request.attachments.filter((item) => item.attachment_type === "primary");
  const supporting = request.attachments.filter((item) => item.attachment_type === "supporting");
  const showFinancialDocuments = payments.length > 0
    || whtCertificates.length > 0
    || (canAccountingView && request.withholding_amount > 0);
  const backToAccounting = (location.state as { from?: string } | null)?.from === "accounting";

  return <div className="mx-auto max-w-6xl space-y-5 p-6">
    <Link to={backToAccounting ? "/expense-requests/accounting" : "/expense-requests"} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> {backToAccounting ? "กลับไปหน้าบัญชีจ่ายเงิน" : "กลับไปแสดงรายการที่ขอเบิกทั้งหมด"}
    </Link>

    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{request.request_no || "คำขอเบิกค่าใช้จ่าย"}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor[request.status] || "bg-muted"}`}>{statusLabel[request.status] || request.status}</span>
          {request.installment_no && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">งวดที่ {request.installment_no}</span>}
          {request.installment_chain_status === "in_progress" && <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">แบ่งจ่ายยังไม่ครบ (คงเหลือ {formatCurrency(request.installment_chain_remaining || 0)})</span>}
          {request.installment_chain_status === "fully_disbursed" && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">แบ่งจ่ายครบแล้ว</span>}
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
          <div className="flex min-w-0 items-center gap-3"><FileText className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><p className="truncate font-medium">{file.file_name}</p><p className="text-xs text-muted-foreground">{file.attachment_type === "primary" ? "ระบบสร้าง" : "บันทึกแล้ว"} · {file.has_signed_file ? "มีฉบับลงนามแล้ว · " : ""}{Math.max(1, Math.round(file.file_size / 1024))} KB</p></div></div>
          <button onClick={() => expenseRequestsApi.openAttachment(request.id, file.id)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Eye className="h-4 w-4" /> {file.has_signed_file ? "ดูฉบับลงนาม" : "ดูไฟล์"}</button>
        </div>)}{group.files.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">ยังไม่มีเอกสาร</p>}</div>
      </div>)}
    </CardContent></Card>

    {request.installment_chain_root_id && <Card><CardContent className="space-y-5 p-6">
      <SectionTitle description="คำขอนี้แบ่งจ่ายเป็นหลายงวด แต่ละงวดเป็นเอกสารแยกที่ต้องผ่านการอนุมัติของตัวเอง">งวดในชุดเดียวกัน</SectionTitle>
      <div className="space-y-2">
        {[...request.installment_siblings].sort((a, b) => (a.installment_no || 0) - (b.installment_no || 0)).map((sibling) => (
          <Link key={sibling.id} to={`/expense-requests/${sibling.id}`}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-muted/30 ${sibling.id === request.id ? "border-primary/40 bg-primary/5" : ""}`}>
            <div><p className="font-medium">งวดที่ {sibling.installment_no} · {sibling.request_no}</p><p className="text-xs text-muted-foreground">{statusLabel[sibling.status] || sibling.status}</p></div>
            <div className="text-right"><p className="font-semibold">{formatCurrency(sibling.amount)}</p><p className="text-xs text-muted-foreground">จ่ายแล้ว {formatCurrency(sibling.paid_amount)}</p></div>
          </Link>
        ))}
      </div>
      {isOwner && request.status === "completed" && request.installment_chain_status === "in_progress"
        && request.installment_no === Math.max(...request.installment_siblings.map((s) => s.installment_no || 0)) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">สร้างงวดถัดไป</p>
          <p className="mt-1 text-xs text-amber-700">คงเหลือที่ยังไม่ได้เบิก {formatCurrency(request.installment_chain_remaining || 0)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="number" min="0.01" max={request.installment_chain_remaining} step="0.01"
              value={nextInstallmentAmount} onChange={(e) => setNextInstallmentAmount(e.target.value)}
              placeholder="ยอดที่จะจ่ายงวดนี้" className="w-48 rounded-lg border bg-background px-3 py-2 text-sm" />
            <button onClick={createNextInstallment} disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              สร้างงวดถัดไป
            </button>
          </div>
        </div>
      )}
    </CardContent></Card>}

    {(canAccountingView || showFinancialDocuments) && <div className={canAccountingView ? "grid gap-5 xl:grid-cols-[1.35fr_0.65fr]" : ""}>
      <div className="space-y-5">
        {request.status === "accounting_review" && canAccountingUpdate && <Card className="border-cyan-200 bg-cyan-50 dark:border-cyan-800 dark:bg-cyan-950/30"><CardContent className="space-y-4 p-6"><SectionTitle description="รายการนี้เป็นข้อมูลจากรอบเดิม ระบบจะใช้สถานะและอัตราหัก ณ ที่จ่ายที่ผู้ขอระบุไว้ ไม่ต้องให้บัญชีเลือกฐานหรืออัตราซ้ำ">ส่งต่อพร้อมจ่าย</SectionTitle><button onClick={reviewLegacy} disabled={saving} className="min-h-12 w-full rounded-xl bg-cyan-700 px-4 text-sm font-black text-white hover:bg-cyan-800 disabled:opacity-60">ใช้ข้อมูลผู้ขอและส่งต่อพร้อมจ่าย</button><div className="border-t border-cyan-200 pt-4"><label className="text-xs font-black text-cyan-800">เหตุผลที่ส่งคืน (ผู้ขอจะเห็นข้อความนี้ในการแจ้งเตือน) *<textarea rows={2} value={accountingReturnReason} onChange={event => setAccountingReturnReason(event.target.value)} placeholder="เช่น ขาดข้อมูลผู้เสียภาษี, ยอดไม่ตรงกับใบเสร็จ, เลขบัญชีผู้รับเงินไม่ถูกต้อง" className="mt-2 w-full rounded-xl border bg-background px-3 py-2 text-sm font-normal text-foreground" /></label><button onClick={returnByAccounting} disabled={saving} className="mt-3 min-h-12 w-full rounded-xl bg-blue-50 px-4 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-60">ส่งคืนให้ผู้ขอแก้ไข</button></div></CardContent></Card>}

        {(request.status === "ready_to_pay" || request.status === "partially_paid") && canAccountingView && <Card className="border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30"><CardContent className="space-y-5 p-6"><div className="flex flex-wrap items-start justify-between gap-4"><SectionTitle description="กรอกรายละเอียดการโอนเพื่อปิดรายการนี้เป็นจ่ายแล้ว">บันทึกการจ่าย</SectionTitle><div className="rounded-md bg-background/70 px-5 py-3 text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">ยอดโอนสุทธิ</p>
          {request.installment_enabled && !request.installment_chain_root_id
            ? <>
                <input type="number" min="0.01" max={request.remaining} step="0.01" value={paymentAmount}
                  onChange={event => setPaymentAmount(event.target.value)}
                  className="mt-1 w-36 rounded-md border bg-background px-3 py-1.5 text-right text-lg font-black text-foreground" />
                <p className="mt-1 text-[10px] font-normal text-indigo-700">จ่ายบางส่วนได้ (คงเหลือ {formatCurrency(request.remaining)})</p>
              </>
            : <p className="text-lg font-black">{formatCurrency(request.remaining)}</p>}
        </div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-black text-indigo-800">วันที่โอนเงิน *<input type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} className="mt-2 h-11 w-full rounded-md border bg-background px-4 text-sm font-normal text-foreground" /></label><label className="text-xs font-black text-indigo-800">เลขอ้างอิงธนาคาร<input value={paymentReference} onChange={event => setPaymentReference(event.target.value)} placeholder="เช่น เลขที่รายการโอน" className="mt-2 h-11 w-full rounded-md border bg-background px-4 text-sm font-normal text-foreground" /></label></div><label className="block text-xs font-black text-indigo-800">หลักฐานการโอน * <span className="font-normal">(บังคับแนบ)</span><span className="mt-2 flex h-11 cursor-pointer items-center rounded-md border border-dashed border-indigo-300 bg-background px-4 text-sm font-normal text-indigo-700"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => setPaymentProof(event.target.files?.[0] || null)} className="w-full" /></span></label><button onClick={payByAccounting} disabled={saving} className="h-11 w-full rounded-md bg-indigo-700 px-8 text-sm font-black text-white hover:bg-indigo-800 disabled:opacity-60">ยืนยันจ่ายเงิน</button>{canAccountingUpdate && <div className="border-t border-indigo-200 pt-4"><p className="mb-2 text-xs text-amber-700">การส่งคืนจากขั้นนี้จะให้ผู้ขอแก้ไขและส่งเข้ากระบวนการอนุมัติใหม่</p><textarea rows={2} value={accountingReturnReason} onChange={event => setAccountingReturnReason(event.target.value)} placeholder="ระบุเหตุผลที่ส่งคืนให้ผู้ขอแก้ไข" className="w-full rounded-md border bg-background px-4 py-2 text-sm" /><button onClick={returnByAccounting} disabled={saving} className="mt-3 h-11 w-full rounded-md bg-blue-50 px-8 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-60">ส่งคืนให้ผู้ขอแก้ไข</button></div>}</CardContent></Card>}

        {showFinancialDocuments && <Card className="border-slate-200"><CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionTitle description="หนังสือรับรอง ภาพสลิป และรายการจ่ายเงินของคำขอนี้">เอกสารการเงิน</SectionTitle>
            {canAccountingUpdate && request.withholding_amount > 0 && whtCertificates.length === 0 && activePayments.length > 0 &&
              <button onClick={issueWhtCertificate} disabled={issuingWht}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-50 px-3 text-xs font-black text-violet-700 hover:bg-violet-100 disabled:opacity-60">
                <Receipt className="h-4 w-4" /> {issuingWht ? "กำลังออกเอกสาร..." : "ออกหนังสือรับรอง"}
              </button>}
          </div>
          <div className="space-y-3">
            {whtCertificates.map(certificate => <div key={certificate.id} className="flex items-stretch gap-1">
              <button onClick={() => expenseAccountingApi.openWhtCertificate(request.id, certificate.id)}
                className="flex flex-1 items-center gap-2 rounded-xl bg-violet-50 px-3 py-3 text-left font-black text-violet-700 hover:bg-violet-100 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-700">
                <Eye className="h-4 w-4 shrink-0" /><span className="min-w-0">หนังสือรับรองหัก ณ ที่จ่าย<span className="block text-xs font-normal opacity-80">{formatCurrency(certificate.tax_amount)} · {formatDate(certificate.issued_at)}</span></span>
              </button>
              <button onClick={() => expenseAccountingApi.downloadWhtCertificate(request.id, certificate.id, `${certificate.certificate_no}.pdf`)}
                className="inline-flex w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-700" title="ดาวน์โหลดเก็บไว้">
                <Download className="h-4 w-4" />
              </button>
            </div>)}
            {[...payments].reverse().map((payment) => <div key={payment.id}
              className={`rounded-xl border p-3 text-sm ${payment.voided_at ? "border-rose-100 bg-rose-50/50 text-muted-foreground" : "border-slate-200 bg-background"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`font-black ${payment.voided_at ? "line-through" : "text-slate-700 dark:text-slate-200"}`}>{payment.payment_type === "adjustment" ? "จ่ายส่วนต่าง" : "จ่ายเงิน"} {formatCurrency(payment.amount)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(payment.paid_at)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">อ้างอิง {payment.reference_no || "-"}</p>
              {!payment.voided_at && payment.proof_file_name && <span className="mt-2 inline-flex items-center gap-2 text-xs font-black">
                <button onClick={() => expenseAccountingApi.openPaymentProof(request.id, payment.id)} className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-300"><Eye className="h-3.5 w-3.5" />ดูหลักฐานโอน</button>
                <button onClick={() => expenseAccountingApi.downloadPaymentProof(request.id, payment.id, payment.proof_file_name || `payment-proof-${payment.id}`)} className="text-slate-500 hover:text-indigo-600" title="ดาวน์โหลดเก็บไว้"><Download className="h-3.5 w-3.5" /></button>
              </span>}
              {!payment.voided_at && canAccountingView && <details className="mt-2">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-amber-700 hover:underline dark:text-amber-300"><Pencil className="h-3.5 w-3.5" />{payment.proof_file_name ? "แนบสลิปผิด? แก้ไขไฟล์" : "แนบหลักฐานการโอน"}</summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => setReplacementProofs(current => ({ ...current, [payment.id]: event.target.files?.[0] || null }))} className="min-w-0 flex-1 text-xs file:mr-2 file:min-h-9 file:rounded-lg file:border-0 file:bg-amber-50 file:px-2 file:text-xs file:font-bold file:text-amber-800 hover:file:bg-amber-100" />
                  <button onClick={() => replacePaymentProof(payment.id)} disabled={!replacementProofs[payment.id] || replacingPaymentId === payment.id} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-60"><Upload className="h-3.5 w-3.5" />{replacingPaymentId === payment.id ? "กำลังบันทึก..." : "บันทึกสลิปนี้"}</button>
                </div>
              </details>}
              <div className="mt-2 flex justify-end">
                {payment.voided_at
                  ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">ยกเลิกแล้ว</span>
                  : canAccountingCancel && payment.id === latestActivePaymentId && <button onClick={() => voidPaymentRow(payment.id)} disabled={voidingPaymentId === payment.id} className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">{voidingPaymentId === payment.id ? "กำลังยกเลิก..." : "ยกเลิกรายการนี้"}</button>}
              </div>
            </div>)}
          </div>
        </CardContent></Card>}

        {request.status === "settlement_review" && canAccountingApprove && settlements.length > 0 && <Card className="border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"><CardContent className="space-y-4 p-6"><SectionTitle description={`ใช้จริง ${formatCurrency(settlements[settlements.length - 1].actual_amount)} · ส่วนต่าง ${formatCurrency(settlements[settlements.length - 1].difference_amount)}`}>ตรวจเคลียร์เงิน</SectionTitle><textarea rows={2} value={settlementReviewNote} onChange={event => setSettlementReviewNote(event.target.value)} placeholder="หมายเหตุ" className="w-full rounded-xl border bg-background px-3 py-2 text-sm" /><button onClick={() => reviewSettlement("approve")} disabled={saving} className="min-h-12 w-full rounded-xl bg-sky-700 px-4 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-60">ตรวจผ่านและปิดรายการ</button><button onClick={() => reviewSettlement("return")} disabled={saving} className="min-h-12 w-full rounded-xl bg-rose-50 px-4 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:opacity-60">ตีกลับให้แก้ไข</button></CardContent></Card>}
      </div>

      {canAccountingCancel && request.status !== "cancelled" && <details className="h-fit rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-800 dark:bg-rose-950/30"><summary className="cursor-pointer font-black text-rose-900 dark:text-rose-100">ยกเลิกคำขอนี้ (ฝ่ายบัญชี)</summary><p className="mt-2 text-sm text-rose-800 dark:text-rose-200">ฝ่ายบัญชียกเลิกได้ทุกสถานะ แม้เสร็จสิ้นหรือจ่ายเงินแล้ว ใช้เมื่อรายการผิดพลาดหรือซ้ำซ้อน และผู้ขอจะเห็นเหตุผลนี้</p><textarea rows={2} value={accountingCancelReason} onChange={event => setAccountingCancelReason(event.target.value)} placeholder="เช่น รายการซ้ำซ้อน, กรอกผิดคน, ผิดพลาดจากระบบ" className="mt-3 w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground" /><button onClick={cancelByAccounting} disabled={saving} className="mt-3 min-h-12 w-full rounded-xl bg-rose-600 px-4 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-60">ยืนยันยกเลิกคำขอ</button></details>}
    </div>}

    <Card><CardContent className="space-y-6 p-6">
      <SectionTitle description="ส่วนนี้เปิดใช้งานเมื่อคำขออยู่ระหว่างรอการพิจารณาจากคุณ">ตรวจ PDF และลงลายเซ็น</SectionTitle>
      {pendingStep ? <div className="space-y-5">
        <div className="rounded-lg border bg-muted/20 p-4"><p className="font-medium">ขั้นตอนที่ {pendingStep.step_no}: {pendingStep.approver_position_name}</p><p className="mt-1 text-sm text-muted-foreground">เปิดเอกสารด้านบนเพื่อตรวจสอบก่อนยืนยันผล</p></div>
        <div className="rounded-xl border p-4">
          <p className="mb-3 text-sm font-semibold"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span>วาดหรือเลือกลายเซ็น</p>
          <SignaturePad onChange={(value) => { setSignature(value); if (value) setUseSavedSignature(false); }} />
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
            <label className={`flex items-center gap-2 ${!savedSignatureUrl ? "text-muted-foreground opacity-60" : ""}`}>
              <input type="checkbox" checked={useSavedSignature} disabled={!savedSignatureUrl}
                onChange={e => { setUseSavedSignature(e.target.checked); if (e.target.checked) setSignature(undefined); }} />
              ใช้ลายเซ็นที่บันทึกไว้{!savedSignatureUrl && " (ยังไม่เคยบันทึกไว้)"}
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={saveSignature} onChange={e => setSaveSignature(e.target.checked)} disabled={!signature} /> บันทึกลายเซ็นที่วาดไว้ใช้ครั้งต่อไป</label>
          </div>
          {useSavedSignature && savedSignatureUrl && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
              <img src={savedSignatureUrl} alt="ลายเซ็นที่บันทึกไว้" className="h-14 w-28 rounded border bg-white object-contain" />
              <div className="text-xs text-muted-foreground">
                <p>นี่คือลายเซ็นที่บันทึกไว้ล่าสุด</p>
                <p>ถ้าเซ็นผิดหรืออยากเปลี่ยน วาดลายเซ็นใหม่ในช่องด้านบนได้เลย ระบบจะใช้อันที่วาดใหม่แทน</p>
              </div>
            </div>
          )}
        </div>
        <div className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span>ตรวจเอกสารและวางตำแหน่งลายเซ็น</p><p className="mt-1 text-xs text-muted-foreground">เปิดดูเอกสารที่แนบมาทั้งหมดได้ในหน้าต่างเดียว — เอกสารที่ต้องเซ็นให้ลากลายเซ็นไปวาง</p></div><PdfSignatureWorkspace requestId={request.id} documents={request.attachments} stepNo={pendingStep.step_no} signaturePreview={signature || (useSavedSignature ? savedSignatureUrl : undefined)} onChange={setPlacements} /></div></div>
        <div><label className="mb-1.5 block text-sm font-medium">หมายเหตุการอนุมัติ (ถ้ามี)</label><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></div>
        <button onClick={() => decide("approve")} disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> ยืนยันอนุมัติและประทับลายเซ็น</button>
        <div className="grid gap-3 border-t pt-5 sm:grid-cols-2"><div><label className="mb-1.5 block text-sm font-medium">เหตุผลที่ส่งคืน *</label><textarea rows={2} value={returnComment} onChange={(event) => setReturnComment(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="ระบุสิ่งที่ต้องแก้ไข" /><button onClick={() => decide("return")} disabled={saving} className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"><RotateCcw className="h-4 w-4" /> ส่งคืนแก้ไข</button></div><div><label className="mb-1.5 block text-sm font-medium">เหตุผลที่ไม่อนุมัติ *</label><textarea rows={2} value={rejectComment} onChange={(event) => setRejectComment(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="ระบุเหตุผลที่ไม่อนุมัติ" /><button onClick={() => decide("reject")} disabled={saving} className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><XCircle className="h-4 w-4" /> ไม่อนุมัติ</button></div></div>
      </div> : <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{request.status === "draft" ? "ยังไม่ส่งอนุมัติ" : "คำขอนี้ไม่ได้อยู่ในขั้นที่รอการพิจารณาจากคุณ"}</div>}
    </CardContent></Card>

    {isOwner && request.request_format === "advance" && request.status === "settlement_due" && <Card><CardContent className="space-y-4 p-6"><SectionTitle description="ใช้เท่ากันส่งตรวจปิด ใช้น้อยกว่าต้องแนบหลักฐานคืนเงิน ใช้มากกว่าจะสร้าง revision ขออนุมัติส่วนต่าง">เคลียร์เงินทดรอง</SectionTitle><div className="grid gap-4 md:grid-cols-2"><Field label="เงินทดรองที่รับ" value={formatCurrency(request.paid)} /><label className="text-sm">ยอดใช้จริง<input type="number" min="0" step="0.01" value={actualAmount} onChange={e => setActualAmount(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2" /></label></div><label className="block text-sm">รายละเอียด<textarea value={settlementNote} onChange={e => setSettlementNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border bg-background px-3 py-2" /></label><label className="block text-sm">หลักฐานคืนเงิน (บังคับเมื่อใช้ต่ำกว่าเงินทดรอง)<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setRefundProof(e.target.files?.[0] || null)} className="mt-1 block w-full" /></label><button onClick={submitSettlement} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">ยืนยันส่งเคลียร์เงิน</button></CardContent></Card>}

    {settlements.length > 0 && <Card><CardContent className="space-y-4 p-6"><SectionTitle>รายการเคลียร์เงิน</SectionTitle>{settlements.map(row => <div key={row.id} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4"><Field label="ประเภท" value={row.settlement_type === "equal" ? "ใช้เท่ากัน" : row.settlement_type === "refund" ? "คืนเงิน" : "ขอส่วนต่างเพิ่ม"} /><Field label="ยอดใช้จริง" value={formatCurrency(row.actual_amount)} /><Field label="ส่วนต่าง" value={formatCurrency(row.difference_amount)} /><Field label="สถานะ" value={row.status} /></div>)}</CardContent></Card>}

    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardContent className="space-y-5 p-6"><SectionTitle description="แสดงขั้นตอนปัจจุบัน ผู้อนุมัติจริง และลำดับที่จะดำเนินการต่อ">เส้นทางอนุมัติ</SectionTitle><ApprovalPath steps={request.steps} currentStepNo={request.current_step_no} approvedAt={request.approved_at} /></CardContent></Card>
      <Card><CardContent className="space-y-5 p-6"><SectionTitle>ประวัติล่าสุด</SectionTitle><ol className="space-y-4">
        <li className="flex gap-3"><Clock3 className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><p className="font-medium">สร้างคำขอ</p><p className="text-sm text-muted-foreground">{formatDate(request.created_at)} · {request.requester_name}</p></div></li>
        {request.submitted_at && <li className="flex gap-3"><Send className="mt-0.5 h-5 w-5 text-amber-600" /><div><p className="font-medium">ส่งอนุมัติ</p><p className="text-sm text-muted-foreground">{formatDate(request.submitted_at)}</p></div></li>}
        {request.steps.filter((step) => step.decided_at).map((step) => <li key={step.id} className="flex gap-3">{step.status === "approved" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <RotateCcw className="mt-0.5 h-5 w-5 text-rose-600" />}<div><p className="font-medium">{stepStatusLabel[step.status]} · ขั้นตอนที่ {step.step_no}</p><p className="text-sm text-muted-foreground">{formatDate(step.decided_at)} · {step.resolved_approver_name}</p></div></li>)}
        {request.approved_at && <li className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /><div><p className="font-medium">อนุมัติครบ</p><p className="text-sm text-muted-foreground">{formatDateTime(request.approved_at)}</p></div></li>}
        {[...histories].filter(row => !["legacy_imported","submitted"].includes(row.event)).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 12).map(row => <li key={`history-${row.id}`} className="flex gap-3"><Clock3 className="mt-0.5 h-5 w-5 text-primary" /><div><p className="font-medium">{historyEventLabel[row.event] || row.event} · revision {row.revision}</p><p className="text-sm text-muted-foreground">{formatDateTime(row.created_at)}{row.note ? ` · ${row.note}` : ""}</p></div></li>)}
      </ol></CardContent></Card>
    </div>
  </div>;
}
