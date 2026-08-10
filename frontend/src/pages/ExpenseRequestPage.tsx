import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Check, CheckCircle2, ChevronLeft, ChevronRight, Eye, FileCheck2,
  FileText, Loader2, Pencil, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import {
  positionsApi, expenseTypesApi, approvalRoutesApi, expenseRequestsApi,
} from "@/api/approvals";
import type {
  Position, ExpenseType, RoutePreview, ExpenseRequest, ExpenseRequestAttachment,
  ExpenseRequestDetail, ExpenseRequestItem,
} from "@/api/approvals";
import { formatCurrency, formatDate, today } from "@/lib/format";
import { useCompany } from "@/context/CompanyContext";

const STATUS_LABEL: Record<string, string> = {
  draft: "ร่าง", pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
  rejected: "ถูกปฏิเสธ", cancelled: "ยกเลิก",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700", rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const REQUEST_FORMAT_LABEL: Record<string, string> = {
  reimbursement: "เบิกค่าใช้จ่าย", advance: "ขอเงินทดรอง", direct_payment: "ชำระตรงให้ผู้ขาย",
};

const RECIPIENT_TYPE_LABEL: Record<string, string> = {
  employee: "พนักงาน", individual: "บุคคลภายนอก", company: "นิติบุคคล",
};

const BANKS = [
  "ธนาคารกรุงเทพ (BBL)", "ธนาคารกสิกรไทย (KBANK)", "ธนาคารกรุงไทย (KTB)",
  "ธนาคารไทยพาณิชย์ (SCB)", "ธนาคารกรุงศรีอยุธยา (BAY)", "ธนาคารทหารไทยธนชาต (TTB)",
  "ธนาคารออมสิน (GSB)", "อื่น ๆ",
];

const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const labelCls = "mb-1.5 block text-sm font-medium text-foreground";

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>;
}

function SuccessNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>;
}

function RequestTableRow({ item, onCancel }: { item: ExpenseRequest; onCancel: (item: ExpenseRequest) => void }) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3 font-medium">{item.request_no || item.id.slice(0, 8)}</td>
      <td className="px-4 py-3">
        <p>{item.expense_type_name || "-"}</p>
        <p className="text-xs text-muted-foreground">{REQUEST_FORMAT_LABEL[item.request_format] || item.request_format}</p>
      </td>
      <td className="max-w-[280px] px-4 py-3"><p className="truncate">{item.title}</p></td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[item.status] || "bg-muted"}`}>
          {STATUS_LABEL[item.status] || item.status}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(item.created_at)}</td>
      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.amount)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Link to={`/expense-requests/${item.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/10">
            <Eye className="h-3.5 w-3.5" /> ดูรายละเอียด
          </Link>
          {item.status === "draft" && (
            <>
              <Link to={`/expense-requests/${item.id}/edit?step=0`}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/10">
                <Pencil className="h-3.5 w-3.5" /> แก้ไข
              </Link>
              <button onClick={() => onCancel(item)} title="ยกเลิกแบบร่าง"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export function ExpenseRequestPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setItems(await expenseRequestsApi.list({ scope: "mine", status: status || undefined, limit: 100 }));
    } catch (e) {
      setError(getApiErrorMessage(e, "โหลดรายการคำขอไม่สำเร็จ"));
    } finally { setLoading(false); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const cancelDraft = async (item: ExpenseRequest) => {
    if (!window.confirm(`ต้องการยกเลิกแบบร่าง ${item.request_no || "นี้"} หรือไม่?`)) return;
    try { await expenseRequestsApi.cancel(item.id); await load(); }
    catch (e) { setError(getApiErrorMessage(e, "ยกเลิกแบบร่างไม่สำเร็จ")); }
  };

  return (
    <div className="space-y-5 p-6">
      <PageHeader title="คำขอเบิกค่าใช้จ่าย" subtitle="สร้างคำขอ ติดตามสถานะ และตรวจสอบเอกสาร">
        <button onClick={() => navigate("/expense-requests/create?step=0")}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> สร้างคำขอ
        </button>
      </PageHeader>
      <ErrorNotice message={error} />
      <div className="flex items-center justify-between gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} max-w-[220px]`}>
          <option value="">ทุกสถานะ</option>
          <option value="draft">ร่าง</option><option value="pending">รออนุมัติ</option>
          <option value="approved">อนุมัติแล้ว</option><option value="rejected">ถูกปฏิเสธ</option>
          <option value="cancelled">ยกเลิก</option>
        </select>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
          <RefreshCw className="h-4 w-4" /> รีเฟรช
        </button>
      </div>
      <Card><CardContent className="p-0">
        {loading ? <div className="flex h-44 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b bg-muted/30"><tr>
                {["เลขที่คำขอ", "ประเภท", "วัตถุประสงค์", "สถานะ", "วันที่สร้าง", "ยอดเบิก", "ดำเนินการ"].map((h) => (
                  <th key={h} className={`px-4 py-3 text-xs font-medium text-muted-foreground ${["ยอดเบิก", "ดำเนินการ"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y">{items.map((item) => <RequestTableRow key={item.id} item={item} onCancel={cancelDraft} />)}</tbody>
            </table>
            {items.length === 0 && <div className="flex flex-col items-center justify-center py-14 text-muted-foreground"><FileText className="mb-2 h-9 w-9" /><p className="text-sm">ยังไม่มีคำขอเบิกค่าใช้จ่าย</p></div>}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}

type HeaderForm = {
  request_format: "reimbursement" | "advance" | "direct_payment";
  expense_type_id: string; requester_position_id: string; payer_company_name: string;
  request_date: string; title: string; description: string;
  recipient_type: "employee" | "individual" | "company";
  recipient_name: string; bank_name: string; bank_account_name: string; bank_account_number: string;
};

type ItemForm = { description: string; quantity: string; unit: string; unit_price: string };

const blankItem = (): ItemForm => ({ description: "", quantity: "1", unit: "รายการ", unit_price: "" });

function WizardSteps({ step, requestId, editable }: { step: number; requestId?: string; editable: boolean }) {
  const labels = ["ข้อมูลคำขอ", "รายการค่าใช้จ่าย", "เอกสารแนบ", "ตรวจสอบก่อนบันทึก"];
  return <div className="grid grid-cols-4 gap-2">
    {labels.map((label, index) => {
      const canOpen = Boolean(requestId) && (editable || index === 3);
      const content = <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${index === step ? "border-primary bg-primary/5 text-primary" : index < step ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-muted-foreground"}`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${index === step ? "bg-primary text-primary-foreground" : index < step ? "bg-emerald-600 text-white" : "bg-muted"}`}>{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
        <span className="hidden text-xs font-medium md:block">{label}</span>
      </div>;
      return canOpen ? <Link key={label} to={`/expense-requests/${requestId}/edit?step=${index}`}>{content}</Link> : <div key={label}>{content}</div>;
    })}
  </div>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>;
}

function AttachmentLink({ requestId, attachment }: { requestId: string; attachment: ExpenseRequestAttachment }) {
  return <button type="button" onClick={() => expenseRequestsApi.openAttachment(requestId, attachment.id)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Eye className="h-3.5 w-3.5" /> ดูไฟล์</button>;
}

export function ExpenseRequestWizardPage() {
  const navigate = useNavigate();
  const { requestId } = useParams();
  const [searchParams] = useSearchParams();
  const rawStep = Number(searchParams.get("step") || 0);
  const step = Number.isInteger(rawStep) ? Math.min(3, Math.max(0, rawStep)) : 0;
  const { currentCompany } = useCompany();
  const [positions, setPositions] = useState<Position[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [request, setRequest] = useState<ExpenseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const generatedFor = useRef("");
  const [header, setHeader] = useState<HeaderForm>({
    request_format: "reimbursement", expense_type_id: "", requester_position_id: "",
    payer_company_name: currentCompany?.name_th || "", request_date: today(), title: "", description: "",
    recipient_type: "employee", recipient_name: "", bank_name: "", bank_account_name: "", bank_account_number: "",
  });
  const [items, setItems] = useState<ItemForm[]>([blankItem()]);
  const [tax, setTax] = useState({
    vat_mode: "none" as "none" | "rate" | "amount", vat_rate: "7", vat_amount: "0",
    withholding_required: false, withholding_mode: "none" as "none" | "rate" | "amount",
    withholding_rate: "3", withholding_amount: "0", taxpayer_name: "", taxpayer_id: "", taxpayer_address: "",
  });

  const hydrate = useCallback((detail: ExpenseRequestDetail) => {
    setRequest(detail);
    setHeader({
      request_format: detail.request_format || "reimbursement",
      expense_type_id: String(detail.expense_type_id || ""), requester_position_id: String(detail.requester_position_id || ""),
      payer_company_name: detail.payer_company_name || currentCompany?.name_th || "", request_date: detail.request_date || today(),
      title: detail.title || "", description: detail.description || "", recipient_type: detail.recipient_type || "employee",
      recipient_name: detail.recipient_name || "", bank_name: detail.bank_name || "", bank_account_name: detail.bank_account_name || "",
      bank_account_number: detail.bank_account_number || "",
    });
    setItems(detail.items.length ? detail.items.map((item) => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unit_price: String(item.unit_price) })) : [blankItem()]);
    setTax({
      vat_mode: detail.vat_mode || "none", vat_rate: String(detail.vat_rate || 7), vat_amount: String(detail.vat_amount || 0),
      withholding_required: detail.withholding_required, withholding_mode: detail.withholding_mode || "none",
      withholding_rate: String(detail.withholding_rate || 3), withholding_amount: String(detail.withholding_amount || 0),
      taxpayer_name: detail.taxpayer_name || "", taxpayer_id: detail.taxpayer_id || "", taxpayer_address: detail.taxpayer_address || "",
    });
  }, [currentCompany?.name_th]);

  const reload = useCallback(async () => {
    if (!requestId) return;
    const detail = await expenseRequestsApi.get(requestId);
    hydrate(detail);
  }, [requestId, hydrate]);

  useEffect(() => {
    setLoading(true); setError("");
    Promise.all([positionsApi.mine(), expenseTypesApi.list(), requestId ? expenseRequestsApi.get(requestId) : Promise.resolve(null)])
      .then(([pos, expenseTypes, detail]) => { setPositions(pos); setTypes(expenseTypes); if (detail) hydrate(detail); })
      .catch((e) => setError(getApiErrorMessage(e, "โหลดข้อมูลคำขอไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, [requestId, hydrate]);

  const editable = !request || request.status === "draft";
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0), [items]);
  const vatAmount = tax.vat_mode === "rate" ? subtotal * (Number(tax.vat_rate) || 0) / 100 : tax.vat_mode === "amount" ? Number(tax.vat_amount) || 0 : 0;
  const totalWithVat = subtotal + vatAmount;
  const withholdingAmount = !tax.withholding_required ? 0 : tax.withholding_mode === "rate" ? subtotal * (Number(tax.withholding_rate) || 0) / 100 : Number(tax.withholding_amount) || 0;

  useEffect(() => {
    if (step !== 2 || !requestId || !request || request.status !== "draft" || request.items.length === 0) return;
    const hasPrimary = request.attachments.some((a) => a.attachment_type === "primary");
    if (hasPrimary || generatedFor.current === requestId) return;
    generatedFor.current = requestId;
    setSaving(true);
    expenseRequestsApi.generatePrimaryDocument(requestId).then(reload)
      .catch((e) => setError(getApiErrorMessage(e, "สร้างเอกสารหลักไม่สำเร็จ")))
      .finally(() => setSaving(false));
  }, [step, requestId, request, reload]);

  useEffect(() => {
    if (step !== 3 || !request || !request.amount) { setPreview(null); return; }
    approvalRoutesApi.preview({ requester_position_id: request.requester_position_id, expense_type_id: request.expense_type_id, amount: request.amount })
      .then(setPreview).catch(() => setPreview(null));
  }, [step, request?.id, request?.amount, request?.requester_position_id, request?.expense_type_id]);

  const go = (nextStep: number, id = requestId) => navigate(`/expense-requests/${id}/edit?step=${nextStep}`);

  const saveHeader = async (advance: boolean) => {
    if (!header.requester_position_id || !header.expense_type_id || !header.title.trim() || !header.request_date || !header.recipient_name.trim() || !header.bank_name || !header.bank_account_name.trim() || !header.bank_account_number.trim()) {
      setError("กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ"); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        ...header, requester_position_id: Number(header.requester_position_id), expense_type_id: Number(header.expense_type_id),
        title: header.title.trim(), description: header.description.trim() || undefined, amount: 0,
      };
      if (requestId) {
        await expenseRequestsApi.update(requestId, payload);
        if (advance) { await reload(); go(1); }
        else navigate(`/expense-requests/${requestId}`, { replace: true });
      } else {
        const created = await expenseRequestsApi.create(payload);
        navigate(advance ? `/expense-requests/${created.id}/edit?step=1` : `/expense-requests/${created.id}`, { replace: true });
      }
    } catch (e) { setError(getApiErrorMessage(e, "บันทึกข้อมูลคำขอไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const saveItems = async (advance: boolean) => {
    const normalized: ExpenseRequestItem[] = items.map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity), unit: item.unit.trim(), unit_price: Number(item.unit_price) }));
    if (!requestId || normalized.some((item) => !item.description || item.quantity <= 0 || !item.unit || item.unit_price < 0) || subtotal <= 0) {
      setError("กรุณากรอกรายการ รายละเอียด จำนวน หน่วย และราคาให้ถูกต้อง"); return;
    }
    if (tax.withholding_required && (!tax.withholding_mode || tax.withholding_mode === "none")) { setError("กรุณาระบุอัตราหรือยอดหัก ณ ที่จ่ายโดยประมาณ"); return; }
    if (tax.withholding_required && (!tax.taxpayer_name.trim() || !tax.taxpayer_id.trim() || !tax.taxpayer_address.trim())) { setError("กรุณากรอกข้อมูลผู้เสียภาษีให้ครบ"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await expenseRequestsApi.update(requestId, {
        items: normalized, vat_mode: tax.vat_mode, vat_rate: Number(tax.vat_rate), vat_amount: Number(tax.vat_amount),
        withholding_required: tax.withholding_required, withholding_mode: tax.withholding_required ? tax.withholding_mode : "none",
        withholding_rate: Number(tax.withholding_rate), withholding_amount: Number(tax.withholding_amount),
        taxpayer_name: tax.taxpayer_name, taxpayer_id: tax.taxpayer_id, taxpayer_address: tax.taxpayer_address,
      });
      generatedFor.current = "";
      if (advance) { await reload(); go(2); }
      else navigate(`/expense-requests/${requestId}`, { replace: true });
    } catch (e) { setError(getApiErrorMessage(e, "บันทึกรายการค่าใช้จ่ายไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const regenerate = async () => {
    if (!requestId) return; setSaving(true); setError("");
    try { await expenseRequestsApi.generatePrimaryDocument(requestId); await reload(); }
    catch (e) { setError(getApiErrorMessage(e, "สร้างเอกสารหลักไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!requestId || !files?.length) return; setUploading(true); setError("");
    try { for (const file of Array.from(files)) await expenseRequestsApi.uploadAttachment(requestId, file); await reload(); }
    catch (e) { setError(getApiErrorMessage(e, "อัปโหลดเอกสารไม่สำเร็จ")); }
    finally { setUploading(false); }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!requestId) return;
    try { await expenseRequestsApi.deleteAttachment(requestId, attachmentId); await reload(); }
    catch (e) { setError(getApiErrorMessage(e, "ลบเอกสารไม่สำเร็จ")); }
  };

  const submitRequest = async () => {
    if (!requestId || !confirmed) return; setSaving(true); setError("");
    try { await expenseRequestsApi.submit(requestId); navigate("/expense-requests", { replace: true }); }
    catch (e) { setError(getApiErrorMessage(e, "ส่งคำขอเพื่ออนุมัติไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const confirmCurrentDraft = async () => {
    if (!requestId) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await expenseRequestsApi.get(requestId);
      navigate(`/expense-requests/${requestId}`, { replace: true });
    } catch (e) {
      setError(getApiErrorMessage(e, "ตรวจสอบการบันทึกแบบร่างไม่สำเร็จ"));
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const primary = request?.attachments.find((a) => a.attachment_type === "primary");
  const supporting = request?.attachments.filter((a) => a.attachment_type === "supporting") || [];
  const completeAttachments = Boolean(primary && supporting.length);

  return <div className="mx-auto max-w-6xl space-y-5 p-6">
    <div className="flex items-start justify-between gap-4">
      <div><Link to="/expense-requests" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> กลับไปหน้ารายการ</Link><h1 className="text-2xl font-bold">{request?.request_no ? `คำขอ ${request.request_no}` : "สร้างคำขอเบิกค่าใช้จ่าย"}</h1><p className="mt-1 text-sm text-muted-foreground">กรอกข้อมูลตามขั้นตอน ระบบจะบันทึกแบบร่างก่อนส่งอนุมัติ</p></div>
      {request && <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLOR[request.status]}`}>{STATUS_LABEL[request.status]}</span>}
    </div>
    <WizardSteps step={step} requestId={requestId} editable={editable} />
    <ErrorNotice message={error} />
    <SuccessNotice message={notice} />

    {step === 0 && <Card><CardContent className="space-y-7 p-6">
      <SectionHeading title="ข้อมูลคำขอ" subtitle="ระบุประเภท วันที่ใช้เงิน และวัตถุประสงค์" />
      <fieldset disabled={!editable} className="space-y-6 disabled:opacity-75">
        <div><h3 className="mb-3 font-medium">รูปแบบคำขอ</h3><div className="grid gap-4 md:grid-cols-3">
          <div><label className={labelCls}>ประเภทการเบิก *</label><select className={inputCls} value={header.expense_type_id} onChange={(e) => setHeader((f) => ({ ...f, expense_type_id: e.target.value }))}><option value="">เลือกประเภท</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div>
          <div><label className={labelCls}>ตำแหน่งที่ใช้ทำรายการ *</label><select className={inputCls} value={header.requester_position_id} onChange={(e) => setHeader((f) => ({ ...f, requester_position_id: e.target.value }))}><option value="">เลือกตำแหน่ง</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">ระบบใช้ตำแหน่งนี้ร่วมกับประเภทและยอดเงินเพื่อเลือกสายอนุมัติ</p></div>
          <div><label className={labelCls}>รูปแบบ</label><select className={inputCls} value={header.request_format} onChange={(e) => setHeader((f) => ({ ...f, request_format: e.target.value as HeaderForm["request_format"] }))}><option value="reimbursement">เบิกค่าใช้จ่าย</option><option value="advance">ขอเงินทดรอง</option><option value="direct_payment">ชำระตรงให้ผู้ขาย</option></select></div>
          <div><label className={labelCls}>บริษัทผู้จ่าย</label><input readOnly className={`${inputCls} bg-muted/40`} value={header.payer_company_name} /></div>
          <div><label className={labelCls}>วันที่ต้องการใช้เงิน *</label><input type="date" className={inputCls} value={header.request_date} onChange={(e) => setHeader((f) => ({ ...f, request_date: e.target.value }))} /></div>
          <div className="md:col-span-3"><label className={labelCls}>วัตถุประสงค์ *</label><input className={inputCls} value={header.title} placeholder="เช่น ค่าเดินทางเข้าพบลูกค้า" onChange={(e) => setHeader((f) => ({ ...f, title: e.target.value }))} /></div>
          <div className="md:col-span-3"><label className={labelCls}>รายละเอียดเพิ่มเติม</label><textarea rows={2} className={inputCls} value={header.description} onChange={(e) => setHeader((f) => ({ ...f, description: e.target.value }))} /></div>
        </div></div>
        <div className="border-t pt-6"><SectionHeading title="ผู้รับเงินและบัญชีธนาคาร" subtitle="ข้อมูลนี้เข้ารหัสและเปิดดูได้เฉพาะผู้เกี่ยวข้องกับคำขอ" /><div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div><label className={labelCls}>ประเภทผู้รับเงินจริง *</label><select className={inputCls} value={header.recipient_type} onChange={(e) => setHeader((f) => ({ ...f, recipient_type: e.target.value as HeaderForm["recipient_type"] }))}><option value="employee">พนักงาน</option><option value="individual">บุคคลภายนอก</option><option value="company">นิติบุคคล</option></select></div>
          <div><label className={labelCls}>ชื่อผู้รับเงิน *</label><input className={inputCls} value={header.recipient_name} onChange={(e) => setHeader((f) => ({ ...f, recipient_name: e.target.value }))} /></div>
          <div><label className={labelCls}>ธนาคาร *</label><select className={inputCls} value={header.bank_name} onChange={(e) => setHeader((f) => ({ ...f, bank_name: e.target.value }))}><option value="">เลือกธนาคาร</option>{BANKS.map((bank) => <option key={bank}>{bank}</option>)}</select></div>
          <div><label className={labelCls}>ชื่อบัญชี *</label><input className={inputCls} value={header.bank_account_name} onChange={(e) => setHeader((f) => ({ ...f, bank_account_name: e.target.value }))} /></div>
          <div><label className={labelCls}>เลขบัญชี *</label><input inputMode="numeric" autoComplete="off" className={inputCls} value={header.bank_account_number} onChange={(e) => setHeader((f) => ({ ...f, bank_account_number: e.target.value }))} /></div>
          <div className="flex items-end"><div className="flex w-full items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><ShieldCheck className="h-4 w-4" /> จัดเก็บแบบเข้ารหัสและแสดงเฉพาะ 4 หลักท้าย</div></div>
        </div></div>
      </fieldset>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><Link to="/expense-requests" className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</Link>{editable ? <div className="flex flex-wrap gap-2"><button onClick={() => saveHeader(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกแบบร่าง</button><button onClick={() => saveHeader(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} บันทึกและถัดไป <ChevronRight className="h-4 w-4" /></button></div> : <button onClick={() => go(1)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground">ถัดไป <ChevronRight className="h-4 w-4" /></button>}</div>
    </CardContent></Card>}

    {step === 1 && <Card><CardContent className="space-y-6 p-6">
      <SectionHeading title="รายการค่าใช้จ่าย" subtitle="ยอดรวมคำนวณใหม่ที่เซิร์ฟเวอร์ทุกครั้ง" />
      <fieldset disabled={!editable} className="space-y-5 disabled:opacity-75">
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/40"><tr>{["รายละเอียด", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "รวม", "จัดการ"].map((h) => <th key={h} className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${["ราคาต่อหน่วย", "รวม"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead><tbody className="divide-y">{items.map((item, index) => <tr key={index}>
          <td className="min-w-[240px] p-2"><input className={inputCls} value={item.description} placeholder="เช่น ค่าทางด่วน" onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} /></td>
          <td className="w-28 p-2"><input type="number" min="0.01" step="0.01" className={inputCls} value={item.quantity} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /></td>
          <td className="w-32 p-2"><input className={inputCls} value={item.unit} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, unit: e.target.value } : row))} /></td>
          <td className="w-44 p-2"><input type="number" min="0" step="0.01" className={`${inputCls} text-right`} value={item.unit_price} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, unit_price: e.target.value } : row))} /></td>
          <td className="w-36 px-3 py-2 text-right font-semibold">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}</td>
          <td className="w-20 p-2 text-center"><button type="button" disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))} className="rounded-md p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td>
        </tr>)}</tbody></table></div>
        <button type="button" onClick={() => setItems((rows) => [...rows, blankItem()])} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"><Plus className="h-4 w-4" /> เพิ่มรายการ</button>
        <div className="grid gap-6 border-t pt-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div><label className={labelCls}>ภาษีมูลค่าเพิ่ม VAT</label><select className={`${inputCls} max-w-sm`} value={tax.vat_mode} onChange={(e) => setTax((f) => ({ ...f, vat_mode: e.target.value as typeof tax.vat_mode }))}><option value="none">ไม่มี</option><option value="rate">ระบุอัตรา %</option><option value="amount">กรอกยอดตามใบกำกับภาษีจริง</option></select></div>
            {tax.vat_mode === "rate" && <div className="max-w-sm"><label className={labelCls}>อัตรา VAT (%)</label><input type="number" min="0" max="100" step="0.01" className={inputCls} value={tax.vat_rate} onChange={(e) => setTax((f) => ({ ...f, vat_rate: e.target.value }))} /></div>}
            {tax.vat_mode === "amount" && <div className="max-w-sm"><label className={labelCls}>ยอด VAT จริง</label><input type="number" min="0" step="0.01" className={inputCls} value={tax.vat_amount} onChange={(e) => setTax((f) => ({ ...f, vat_amount: e.target.value }))} /></div>}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><label className={labelCls}>รายการนี้ต้องหัก ณ ที่จ่ายไหม (ประมาณการ) *</label><select className={`${inputCls} bg-white`} value={tax.withholding_required ? "yes" : "no"} onChange={(e) => setTax((f) => ({ ...f, withholding_required: e.target.value === "yes", withholding_mode: e.target.value === "yes" && f.withholding_mode === "none" ? "rate" : f.withholding_mode }))}><option value="no">ไม่ต้องหัก</option><option value="yes">ต้องหัก</option></select><p className="mt-2 text-xs text-amber-800">เป็นการประมาณการเบื้องต้นของผู้ขอเท่านั้น ฝ่ายบัญชีจะตรวจสอบและยืนยันอัตราจริงอีกครั้งตอนตรวจยอด</p></div>
            {tax.withholding_required && <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelCls}>วิธีระบุ</label><select className={inputCls} value={tax.withholding_mode} onChange={(e) => setTax((f) => ({ ...f, withholding_mode: e.target.value as typeof tax.withholding_mode }))}><option value="rate">อัตรา % โดยประมาณ</option><option value="amount">ยอดเงินจริง</option></select></div><div><label className={labelCls}>{tax.withholding_mode === "amount" ? "ยอดหัก ณ ที่จ่าย" : "อัตราหัก ณ ที่จ่าย (%)"}</label><input type="number" min="0" step="0.01" className={inputCls} value={tax.withholding_mode === "amount" ? tax.withholding_amount : tax.withholding_rate} onChange={(e) => setTax((f) => ({ ...f, [tax.withholding_mode === "amount" ? "withholding_amount" : "withholding_rate"]: e.target.value }))} /></div></div>}
          </div>
          <div className="h-fit rounded-xl border bg-muted/15 p-4"><div className="flex justify-between py-2 text-sm"><span>ยอดรวมก่อนภาษี</span><b>{formatCurrency(subtotal)}</b></div><div className="flex justify-between border-t py-2 text-sm"><span>VAT โดยประมาณ</span><b>{formatCurrency(vatAmount)}</b></div><div className="flex justify-between border-t py-3"><span className="font-medium">ยอดรวมพร้อม VAT โดยประมาณ</span><b className="text-lg text-primary">{formatCurrency(totalWithVat)}</b></div>{tax.withholding_required && <div className="flex justify-between border-t py-2 text-xs text-muted-foreground"><span>หัก ณ ที่จ่ายโดยประมาณ</span><span>-{formatCurrency(withholdingAmount)}</span></div>}</div>
        </div>
        <div className="border-t pt-5"><SectionHeading title="ข้อมูลภาษีสำหรับฝ่ายบัญชี" subtitle="ระบุสถานะและอัตราหัก ณ ที่จ่ายไว้ที่กล่องสรุปยอดด้านบนแล้ว — กรอกข้อมูลผู้เสียภาษีด้านล่างนี้ให้ครบเมื่อเลือก “ต้องหัก”" />{tax.withholding_required && <div className="mt-4 grid gap-4 md:grid-cols-2"><div><label className={labelCls}>ชื่อผู้เสียภาษี *</label><input className={inputCls} value={tax.taxpayer_name} onChange={(e) => setTax((f) => ({ ...f, taxpayer_name: e.target.value }))} /></div><div><label className={labelCls}>เลขประจำตัวผู้เสียภาษี *</label><input className={inputCls} value={tax.taxpayer_id} onChange={(e) => setTax((f) => ({ ...f, taxpayer_id: e.target.value }))} /></div><div className="md:col-span-2"><label className={labelCls}>ที่อยู่ตามทะเบียน *</label><textarea rows={2} className={inputCls} value={tax.taxpayer_address} onChange={(e) => setTax((f) => ({ ...f, taxpayer_address: e.target.value }))} /></div></div>}</div>
      </fieldset>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button onClick={() => go(0)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm hover:bg-muted"><ChevronLeft className="h-4 w-4" /> ย้อนกลับ</button>{editable ? <div className="flex flex-wrap gap-2"><button onClick={() => saveItems(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกแบบร่าง</button><button onClick={() => saveItems(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} บันทึกและถัดไป <ChevronRight className="h-4 w-4" /></button></div> : <button onClick={() => go(2)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground">ถัดไป <ChevronRight className="h-4 w-4" /></button>}</div>
    </CardContent></Card>}

    {step === 2 && <Card><CardContent className="space-y-7 p-6">
      <SectionHeading title="เอกสารแนบ" />
      <div className="space-y-3"><div><h3 className="font-medium">เอกสารหลักสำหรับอนุมัติ (PDF) <span className="text-rose-600">*</span></h3><p className="mt-1 text-sm text-muted-foreground">ระบบสร้างให้อัตโนมัติจากข้อมูลคำขอ ไม่ต้องอัปโหลดเอง</p></div>
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${primary ? "border-emerald-200 bg-emerald-50" : "border-dashed"}`}>
          <div className="flex items-center gap-3">{saving ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : primary ? <FileCheck2 className="h-7 w-7 text-emerald-600" /> : <FileText className="h-7 w-7 text-muted-foreground" />}<div><p className="font-medium">{primary ? "สร้างเอกสารแล้ว" : saving ? "กำลังสร้างเอกสาร..." : "ยังไม่มีเอกสารหลัก"}</p>{primary && <p className="text-xs text-muted-foreground">{primary.file_name}</p>}</div></div>
          {requestId && primary && <div className="flex items-center gap-3"><AttachmentLink requestId={requestId} attachment={primary} />{editable && <button onClick={regenerate} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium"><RefreshCw className="h-3.5 w-3.5" /> สร้างใหม่</button>}</div>}
        </div>
      </div>
      <div className="space-y-3 border-t pt-6"><div><h3 className="font-medium">เอกสารประกอบเพิ่มเติม <span className="text-rose-600">*</span></h3><p className="mt-1 text-sm text-muted-foreground">บังคับอย่างน้อย 1 ไฟล์ · รองรับ PDF, JPG, JPEG, PNG, DOC, DOCX, XLS, XLSX · สูงสุด 10 MB</p></div>
        {editable && <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center hover:border-primary hover:bg-primary/5"><input type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = ""; }} /><Upload className="mb-2 h-7 w-7 text-muted-foreground" /><span className="text-sm font-medium">{uploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}</span><span className="mt-1 text-xs text-muted-foreground">เลือกหลายไฟล์ได้ ระบบจะอัปโหลดเข้าแบบร่างทันทีและเก็บไว้เมื่อรีเฟรชหน้า</span></label>}
        <div className="space-y-2">{supporting.map((attachment) => <div key={attachment.id} className="flex items-center justify-between rounded-lg border px-4 py-3"><div className="flex min-w-0 items-center gap-3"><FileText className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0"><p className="truncate text-sm font-medium">{attachment.file_name}</p><p className="text-xs text-muted-foreground">{Math.ceil(attachment.file_size / 1024)} KB · บันทึกแล้ว</p></div></div><div className="flex items-center gap-2">{requestId && <AttachmentLink requestId={requestId} attachment={attachment} />}{editable && <button onClick={() => removeAttachment(attachment.id)} className="rounded-md p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}</div></div>)}</div>
      </div>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button onClick={() => go(1)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm hover:bg-muted"><ChevronLeft className="h-4 w-4" /> ย้อนกลับ</button><div className="flex flex-wrap gap-2">{editable && <button onClick={confirmCurrentDraft} disabled={saving || uploading} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกแบบร่าง</button>}<button onClick={() => go(3)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">ตรวจสอบคำขอ <ChevronRight className="h-4 w-4" /></button></div></div>
    </CardContent></Card>}

    {step === 3 && request && <Card><CardContent className="space-y-6 p-6">
      <SectionHeading title="ตรวจสอบก่อนบันทึก" subtitle="ตรวจผู้รับเงิน เลขบัญชี และยอดรวมให้ถูกต้อง จากนั้นส่งคำขอเพื่ออนุมัติ" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">คำขอและผู้รับเงิน</h3>{editable && <button onClick={() => go(0)} className="text-sm font-medium text-primary">แก้ไข</button>}</div><dl className="grid grid-cols-[145px_1fr] gap-x-3 gap-y-3 text-sm"><dt className="text-muted-foreground">รูปแบบ / ประเภท / ตำแหน่ง</dt><dd className="font-medium">{REQUEST_FORMAT_LABEL[request.request_format]} / {request.expense_type_name} / {request.requester_position_name}</dd><dt className="text-muted-foreground">วันที่ต้องการใช้เงิน</dt><dd className="font-medium">{formatDate(request.request_date)}</dd><dt className="text-muted-foreground">วัตถุประสงค์</dt><dd className="font-medium">{request.title}</dd><dt className="text-muted-foreground">ผู้รับเงิน</dt><dd className="font-medium">{request.recipient_name} ({RECIPIENT_TYPE_LABEL[request.recipient_type || ""] || "-"})</dd><dt className="text-muted-foreground">บัญชีรับเงิน</dt><dd className="font-medium">{request.bank_name} · {request.bank_account_name} · {request.bank_account_masked}</dd></dl></div>
        <div className="rounded-xl border p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">รายการค่าใช้จ่าย</h3>{editable && <button onClick={() => go(1)} className="text-sm font-medium text-primary">แก้ไข</button>}</div><div className="space-y-3">{request.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm"><span>{item.description} × {item.quantity} {item.unit} @ {formatCurrency(item.unit_price)}</span><b>{formatCurrency(item.line_total || item.quantity * item.unit_price)}</b></div>)}</div><div className="mt-4 flex justify-between border-t pt-3 font-semibold"><span>ยอดรวม</span><span className="text-primary">{formatCurrency(request.amount)}</span></div></div>
        <div className="rounded-xl border p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">ภาษี</h3>{editable && <button onClick={() => go(1)} className="text-sm font-medium text-primary">แก้ไข</button>}</div><p className="text-sm font-medium">สถานะที่ผู้ขอแจ้ง: {request.withholding_required ? `ต้องหัก ${request.withholding_mode === "rate" ? `${request.withholding_rate}%` : formatCurrency(request.withholding_amount)}` : "ไม่ต้องหัก"}</p><p className="mt-2 text-xs text-muted-foreground">เป็นค่าประมาณ ฝ่ายบัญชีจะตรวจสอบและยืนยันอัตราจริงอีกครั้ง</p></div>
        <div className={`rounded-xl border p-5 ${completeAttachments ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"}`}><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">เอกสารแนบ</h3>{editable && <button onClick={() => go(2)} className="text-sm font-medium text-primary">แก้ไข</button>}</div>{completeAttachments ? <div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-emerald-600" /><div><p className="font-medium text-emerald-800">เอกสารครบแล้ว</p><p className="text-sm text-emerald-700">ตรวจพบเอกสาร {request.attachments.length} ไฟล์ พร้อมบันทึกคำขอ</p></div></div> : <p className="text-sm text-rose-700">กรุณาแนบเอกสารหลักและเอกสารประกอบอย่างน้อย 1 ไฟล์</p>}<div className="mt-4 space-y-2 text-sm">{request.attachments.map((attachment) => <div key={attachment.id} className="flex items-center justify-between"><span>{attachment.file_name}</span><AttachmentLink requestId={request.id} attachment={attachment} /></div>)}</div></div>
      </div>
      {preview && <div className={`rounded-xl border p-4 ${preview.matched ? "border-blue-200 bg-blue-50" : "border-rose-200 bg-rose-50"}`}><p className="text-sm font-medium">สายอนุมัติ</p>{preview.matched ? <div className="mt-3 flex flex-wrap items-center gap-2">{preview.steps.map((approvalStep, index) => <div key={approvalStep.step_no} className="flex items-center gap-2"><div className="rounded-lg border bg-white px-3 py-2 text-xs"><b>{index + 1}. {approvalStep.approver_position_name}</b><p className="mt-0.5 text-muted-foreground">{approvalStep.resolved_approver_name || approvalStep.warning}</p></div>{index < preview.steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}</div>)}</div> : <p className="mt-2 text-sm text-rose-700">{preview.message}</p>}</div>}
      {editable ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span className="text-sm font-medium">ฉันตรวจสอบชื่อผู้รับเงิน เลขบัญชี ยอดเงิน และเอกสารแล้ว</span></label> : <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">คำขอนี้ถูกส่งแล้ว จึงเปิดดูได้อย่างเดียว</div>}
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button onClick={() => go(2)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm hover:bg-muted"><ChevronLeft className="h-4 w-4" /> ย้อนกลับ</button>{editable && <div className="flex flex-wrap gap-2"><button onClick={confirmCurrentDraft} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกแบบร่าง</button><button onClick={submitRequest} disabled={!confirmed || !completeAttachments || !preview?.matched || saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} ส่งคำขอเพื่ออนุมัติ</button></div>}</div>
    </CardContent></Card>}
  </div>;
}
