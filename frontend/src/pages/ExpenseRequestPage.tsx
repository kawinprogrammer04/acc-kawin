import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Eye, FileCheck2,
  FileText, Loader2, LockKeyhole, Pencil, Plus, RefreshCw, Save, Send, Trash2, Upload, UploadCloud,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/layout/PageHeader";
import { api, getApiErrorMessage } from "@/api/client";
import {
  positionsApi, expenseTypesApi, approvalRoutesApi, expenseRequestsApi, expenseSettingsApi,
} from "@/api/approvals";
import type {
  Position, ExpenseType, RoutePreview, ExpenseRequest, ExpenseRequestAttachment, AttachmentRequirement,
  ExpenseRequestDetail, ExpenseRequestItem,
} from "@/api/approvals";
import { formatCurrency, formatDate, today } from "@/lib/format";
import { formatCompanyLabel } from "@/lib/companyPresentation";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";

const STATUS_LABEL: Record<string, string> = {
  draft: "ร่าง", pending: "รออนุมัติ", pending_approval: "รออนุมัติ", approved: "อนุมัติแล้ว",
  ready_to_pay: "พร้อมจ่าย", partially_paid: "จ่ายบางส่วน", settlement_due: "รอเคลียร์เงิน", settlement_review: "รอตรวจเคลียร์",
  completed: "เสร็จสิ้น", returned_for_correction: "ส่งกลับให้แก้ไข",
  pending_adjustment_approval: "รออนุมัติส่วนต่าง", rejected: "ถูกปฏิเสธ", cancelled: "ยกเลิก",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700", rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
  ready_to_pay: "bg-sky-100 text-sky-700", partially_paid: "bg-teal-100 text-teal-700",
  settlement_due: "bg-orange-100 text-orange-700",
  settlement_review: "bg-violet-100 text-violet-700", completed: "bg-emerald-100 text-emerald-700",
  returned_for_correction: "bg-amber-100 text-amber-700", pending_approval: "bg-amber-100 text-amber-700",
  pending_adjustment_approval: "bg-amber-100 text-amber-700",
};

const STATUS_FILTER_OPTIONS = [
  ["draft", "ร่าง"],
  ["pending_approval", "รออนุมัติ"],
  ["approved", "อนุมัติแล้ว"],
  ["ready_to_pay", "พร้อมจ่าย"],
  ["partially_paid", "จ่ายบางส่วน"],
  ["settlement_due", "รอเคลียร์เงิน"],
  ["settlement_review", "รอตรวจเคลียร์"],
  ["pending_adjustment_approval", "รออนุมัติส่วนต่าง"],
  ["completed", "เสร็จสิ้น"],
  ["returned_for_correction", "ส่งกลับให้แก้ไข"],
  ["rejected", "ถูกปฏิเสธ"],
  ["cancelled", "ยกเลิก"],
] as const;

const REQUEST_FORMAT_LABEL: Record<string, string> = {
  reimbursement: "เบิกค่าใช้จ่าย", advance: "สำรองจ่าย", direct_payment: "ชำระตรงให้ผู้ขาย",
};

const RECIPIENT_TYPE_LABEL: Record<string, string> = {
  employee: "พนักงาน", individual: "บุคคลภายนอก", company: "นิติบุคคล",
};

const BANKS = [
  "ธนาคารกรุงเทพ (BBL)", "ธนาคารกสิกรไทย (KBank)", "ธนาคารกรุงไทย (KTB)",
  "ธนาคารไทยพาณิชย์ (SCB)", "ธนาคารกรุงศรีอยุธยา (Krungsri)", "ธนาคารทหารไทยธนชาต (ttb)",
  "ธนาคารเกียรตินาคินภัทร (KKP)", "ธนาคารซีไอเอ็มบี ไทย (CIMB)", "ธนาคารทิสโก้ (TISCO)",
  "ธนาคารยูโอบี (UOB)", "ธนาคารออมสิน (GSB)", "ธนาคารอาคารสงเคราะห์ (GHB)",
  "ธ.ก.ส. (BAAC)", "ธนาคารอิสลามแห่งประเทศไทย (iBank)",
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
        {item.installment_no && <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">งวด {item.installment_no}</span>}
        {item.installment_chain_status === "in_progress" && <p className="mt-1 text-xs font-medium text-orange-600">แบ่งจ่ายยังไม่ครบ</p>}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(item.created_at)}</td>
      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.amount)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Link to={`/expense-requests/${item.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/10">
            <Eye className="h-3.5 w-3.5" /> ดูรายละเอียด
          </Link>
          {["draft", "returned_for_correction"].includes(item.status) && (
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
  const [statuses, setStatuses] = useState<string[]>([]);
  const [error, setError] = useState("");

  const statusFilter = useMemo(() => statuses.join(","), [statuses]);
  const statusFilterLabel = statuses.length === 0
    ? "ทุกสถานะ"
    : statuses.length === 1
      ? STATUS_LABEL[statuses[0]] || statuses[0]
      : `เลือกแล้ว ${statuses.length} สถานะ`;

  const toggleStatus = (value: string) => {
    setStatuses((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setItems(await expenseRequestsApi.list({
        scope: "mine",
        status: statusFilter || undefined, limit: 100,
      }));
    } catch (e) {
      setError(getApiErrorMessage(e, "โหลดรายการคำขอไม่สำเร็จ"));
    } finally { setLoading(false); }
  }, [statusFilter]);

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
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex h-10 min-w-[220px] max-w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 text-sm hover:bg-muted/40">
              <span className="truncate">สถานะ: {statusFilterLabel}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px] p-2">
            <div className="flex items-center justify-between border-b px-2 pb-2">
              <p className="text-sm font-semibold">เลือกสถานะ</p>
              <button type="button" onClick={() => setStatuses([])} disabled={statuses.length === 0}
                className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                ทุกสถานะ
              </button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto py-2">
              {STATUS_FILTER_OPTIONS.map(([value, label]) => {
                const selected = statuses.includes(value);
                return <button key={value} type="button" onClick={() => toggleStatus(value)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition ${selected ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  <span>{label}</span>
                </button>;
              })}
            </div>
            {statuses.length > 0 && <p className="border-t px-2 pt-2 text-xs text-muted-foreground">เลือกไว้ {statuses.length} สถานะ</p>}
          </PopoverContent>
        </Popover>
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
  request_date: string; required_date: string; title: string; description: string;
  recipient_type: "employee" | "individual" | "company";
  recipient_name: string; bank_name: string; bank_account_name: string; bank_account_number: string;
  installment_enabled: boolean;
};

type PayerCompanyOption = {
  id: number;
  code: string;
  name_th: string;
  name_en?: string;
};

type ItemForm = { description: string; quantity: string; unit: string; unit_price: string };

const blankItem = (): ItemForm => ({ description: "", quantity: "1", unit: "รายการ", unit_price: "" });

function WizardSteps({ step, requestId, editable }: { step: number; requestId?: string; editable: boolean }) {
  const labels = ["คำขอ", "รายการ+ภาษี", "เอกสาร", "ตรวจสอบ"];
  return <ol aria-label="ขั้นตอนสร้างคำขอเบิก" className="grid grid-cols-4 gap-2">
    {labels.map((label, index) => {
      const canOpen = Boolean(requestId) && (editable || index === 3);
      const content = <div className="relative min-w-0 text-center">
        {index > 0 && <span className={`absolute right-1/2 top-6 -z-10 h-0.5 w-full ${index <= step ? "bg-primary" : "bg-muted"}`} />}
        <span className={`relative mx-auto flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold transition-colors ${index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index < step ? <Check className="h-5 w-5" /> : index + 1}</span>
        <span className={`mt-2 block truncate text-xs font-semibold ${index === step ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
      </div>;
      return <li key={label}>{canOpen ? <Link to={`/expense-requests/${requestId}/edit?step=${index}`}>{content}</Link> : content}</li>;
    })}
  </ol>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>;
}

function AttachmentLink({ requestId, attachment }: { requestId: string; attachment: ExpenseRequestAttachment }) {
  return <button type="button" onClick={() => expenseRequestsApi.openAttachment(requestId, attachment.id)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Eye className="h-3.5 w-3.5" /> ดูไฟล์</button>;
}

export function ExpenseRequestWizardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { requestId } = useParams();
  const [searchParams] = useSearchParams();
  const rawStep = Number(searchParams.get("step") || 0);
  const step = Number.isInteger(rawStep) ? Math.min(3, Math.max(0, rawStep)) : 0;
  const { currentCompany } = useCompany();
  const [payerCompanies, setPayerCompanies] = useState<PayerCompanyOption[]>([]);
  const defaultPayerCompanyName = payerCompanies.find((company) => company.code === "KAWIN_BROTHERS")?.name_th
    || currentCompany?.name_th || "";
  const [positions, setPositions] = useState<Position[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [requirements, setRequirements] = useState<AttachmentRequirement[]>([]);
  const [bankPicker, setBankPicker] = useState("");
  const [request, setRequest] = useState<ExpenseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autosaveText, setAutosaveText] = useState("รอเริ่มบันทึกอัตโนมัติ");
  const autosaveTimer = useRef<number | null>(null);
  const lastSavedHeader = useRef("");
  const generatedFor = useRef("");
  const [header, setHeader] = useState<HeaderForm>({
    request_format: "reimbursement", expense_type_id: "", requester_position_id: "",
    payer_company_name: defaultPayerCompanyName, request_date: today(), required_date: "", title: "", description: "",
    recipient_type: "employee", recipient_name: user?.full_name || user?.username || "", bank_name: "",
    bank_account_name: user?.full_name || user?.username || "", bank_account_number: "",
    installment_enabled: false,
  });
  const [items, setItems] = useState<ItemForm[]>([blankItem()]);
  const [tax, setTax] = useState({
    vat_mode: "none" as "none" | "rate" | "amount", vat_rate: "7", vat_amount: "0", vat_actual_total: "",
    withholding_required: false, withholding_mode: "none" as "none" | "rate" | "amount",
    withholding_rate: "3", withholding_amount: "0", taxpayer_name: "", taxpayer_id: "", taxpayer_address: "",
    taxpayer_type: "individual" as "individual" | "juristic", taxpayer_branch: "", service_description: "",
    requester_withholding_status: "not_withheld" as "not_withheld" | "deduct" | "already_withheld",
    requested_net_amount: "", discount_amount: "0",
    price_mode: "exclude_vat" as "exclude_vat" | "include_vat", gross_up_enabled: false,
    installment_payment_amount: "",
  });

  const hydrate = useCallback((detail: ExpenseRequestDetail) => {
    setRequest(detail);
    const hydratedHeader: HeaderForm = {
      request_format: detail.request_format || "reimbursement",
      expense_type_id: String(detail.expense_type_id || ""), requester_position_id: String(detail.requester_position_id || ""),
      payer_company_name: detail.payer_company_name || defaultPayerCompanyName, request_date: detail.request_date || today(), required_date: detail.required_date || "",
      title: detail.title || "", description: detail.description || "", recipient_type: detail.recipient_type || "employee",
      recipient_name: detail.recipient_name || "", bank_name: detail.bank_name || "", bank_account_name: detail.bank_account_name || "",
      bank_account_number: detail.bank_account_number || "",
      installment_enabled: Boolean(detail.installment_enabled),
    };
    setHeader(hydratedHeader);
    setBankPicker(BANKS.includes(hydratedHeader.bank_name) ? hydratedHeader.bank_name : hydratedHeader.bank_name ? "__other__" : "");
    lastSavedHeader.current = JSON.stringify(hydratedHeader);
    setItems(detail.items.length ? detail.items.map((item) => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unit_price: String(item.unit_price) })) : [blankItem()]);
    setTax({
      vat_mode: detail.vat_mode || "none", vat_rate: String(detail.vat_rate || 7), vat_amount: String(detail.vat_amount || 0),
      vat_actual_total: detail.vat_mode === "amount" ? String(Number(detail.price_before_vat || 0) + Number(detail.vat_amount || 0)) : "",
      withholding_required: detail.withholding_required, withholding_mode: detail.withholding_mode || "none",
      withholding_rate: String(detail.withholding_rate || 3), withholding_amount: String(detail.withholding_amount || 0),
      taxpayer_name: detail.taxpayer_name || "", taxpayer_id: detail.taxpayer_id || "", taxpayer_address: detail.taxpayer_address || "",
      taxpayer_type: detail.taxpayer_type || "individual", taxpayer_branch: detail.taxpayer_branch || "",
      service_description: detail.service_description || "",
      requester_withholding_status: (["not_withheld", "deduct", "already_withheld"].includes(detail.requester_withholding_status)
        ? detail.requester_withholding_status : detail.withholding_required ? "deduct" : "not_withheld") as "not_withheld" | "deduct" | "already_withheld",
      requested_net_amount: detail.requested_net_amount ? String(detail.requested_net_amount) : "",
      discount_amount: String(detail.discount_amount || 0), price_mode: detail.price_mode || "exclude_vat", gross_up_enabled: detail.gross_up_enabled,
      installment_payment_amount: detail.installment_payment_amount ? String(detail.installment_payment_amount) : "",
    });
  }, [defaultPayerCompanyName]);

  useEffect(() => {
    if (!requestId && !header.payer_company_name && defaultPayerCompanyName) {
      setHeader((current) => ({ ...current, payer_company_name: defaultPayerCompanyName }));
    }
  }, [requestId, header.payer_company_name, defaultPayerCompanyName]);

  const reload = useCallback(async () => {
    if (!requestId) return;
    const detail = await expenseRequestsApi.get(requestId);
    hydrate(detail);
  }, [requestId, hydrate]);

  useEffect(() => {
    if (!header.expense_type_id) { setRequirements([]); return; }
    expenseSettingsApi.requirements(Number(header.expense_type_id)).then(setRequirements).catch(() => setRequirements([]));
  }, [header.expense_type_id]);

  useEffect(() => {
    const selected = types.find((type) => type.id === Number(header.expense_type_id));
    if (selected && !selected.allowed_kinds.includes(header.request_format)) {
      setHeader((current) => ({ ...current, expense_type_id: "" }));
    }
  }, [header.request_format, header.expense_type_id, types]);

  useEffect(() => {
    setLoading(true); setError("");
    Promise.all([
      positionsApi.mine(),
      expenseTypesApi.list(),
      requestId ? expenseRequestsApi.get(requestId) : Promise.resolve(null),
      api.get<PayerCompanyOption[]>("/companies/payer-options").then((response) => response.data),
    ])
      .then(([pos, expenseTypes, detail, payerOptions]) => {
        setPositions(pos); setTypes(expenseTypes); setPayerCompanies(payerOptions);
        if (detail) hydrate(detail);
        else {
          const preferredPayer = payerOptions.find((company) => company.code === "KAWIN_BROTHERS")?.name_th
            || currentCompany?.name_th || "";
          setHeader(current => ({
            ...current,
            payer_company_name: preferredPayer,
            requester_position_id: pos.length === 1 ? String(pos[0].id) : current.requester_position_id,
          }));
        }
      })
      .catch((e) => setError(getApiErrorMessage(e, "โหลดข้อมูลคำขอไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, [requestId, hydrate, currentCompany?.name_th]);

  const editable = !request || ["draft", "returned_for_correction"].includes(request.status);
  const availableKinds = useMemo(() => {
    const configured = new Set(types.filter((type) => type.is_active).flatMap((type) => type.allowed_kinds || []));
    return (["advance", "reimbursement"] as const).filter((kind) => configured.has(kind));
  }, [types]);
  // ประเภทที่ปิดใช้งานแล้วจะไม่ให้เลือกใหม่ — ยกเว้นเป็นประเภทที่คำขอนี้เลือกไว้อยู่แล้ว
  const visibleTypes = useMemo(
    () =>
      types.filter(
        (type) =>
          type.allowed_kinds.includes(header.request_format) &&
          (type.is_active || type.id === Number(header.expense_type_id)),
      ),
    [types, header.request_format, header.expense_type_id],
  );
  const selectedType = types.find((type) => type.id === Number(header.expense_type_id));
  const payerCompanyIsAvailable = payerCompanies.some((company) => company.name_th === header.payer_company_name);
  const typeMayRequireWithholding = Boolean(selectedType?.may_require_withholding_tax);
  const wantsWithholding = typeMayRequireWithholding && tax.requester_withholding_status === "deduct";
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0), [items]);
  const installmentOverrideActive = header.installment_enabled && Number(tax.installment_payment_amount) > 0;
  const afterDiscount = installmentOverrideActive
    ? (Number(tax.installment_payment_amount) || 0)
    : Math.max(0, subtotal - (Number(tax.discount_amount) || 0));
  const actualVatAmount = tax.vat_mode === "amount" ? Math.max(0, (Number(tax.vat_actual_total) || 0) - afterDiscount) : 0;
  const priceBeforeVat = tax.vat_mode === "rate" && tax.price_mode === "include_vat"
    ? afterDiscount / (1 + (Number(tax.vat_rate) || 0) / 100)
    : afterDiscount;
  const vatAmount = tax.vat_mode === "rate" ? (tax.price_mode === "include_vat" ? afterDiscount - priceBeforeVat : priceBeforeVat * (Number(tax.vat_rate) || 0) / 100) : actualVatAmount;
  const totalWithVat = tax.price_mode === "include_vat" ? afterDiscount : afterDiscount + vatAmount;
  const withholdingAmount = !wantsWithholding ? 0 : tax.withholding_mode === "rate" ? priceBeforeVat * (Number(tax.withholding_rate) || 0) / 100 : Number(tax.withholding_amount) || 0;
  const netAfterWithholding = tax.gross_up_enabled && Number(tax.requested_net_amount) > 0
    ? Number(tax.requested_net_amount) : Math.max(0, totalWithVat - withholdingAmount);

  useEffect(() => {
    // ยอดงวดแทนยอดรวมรายการในการคำนวณภาษีแล้ว ส่วนลดจึงไม่ควรหักซ้ำอีกชั้น
    if (installmentOverrideActive && tax.discount_amount !== "0") setTax((f) => ({ ...f, discount_amount: "0" }));
  }, [installmentOverrideActive, tax.discount_amount]);

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
    // สายอนุมัติต้องดูยอดเบิกจริงทั้งก้อน (ยอดรวมรายการ) ไม่ใช่ยอดที่แบ่งจ่ายงวดนี้
    const routingAmount = request.installment_target_amount ?? request.amount;
    approvalRoutesApi.preview({ requester_position_id: request.requester_position_id, expense_type_id: request.expense_type_id, amount: routingAmount, request_kind: request.request_format })
      .then(setPreview).catch(() => setPreview(null));
  }, [step, request?.id, request?.amount, request?.installment_target_amount, request?.requester_position_id, request?.expense_type_id]);

  const go = (nextStep: number, id = requestId) => navigate(`/expense-requests/${id}/edit?step=${nextStep}`);

  const headerReady = Boolean(header.requester_position_id && header.expense_type_id && header.payer_company_name.trim() && header.title.trim()
    && header.recipient_name.trim() && header.bank_name.trim() && header.bank_account_name.trim()
    && header.bank_account_number.trim());

  const persistHeader = async () => {
    const payload = {
      ...header,
      required_date: header.required_date || undefined,
      requester_position_id: Number(header.requester_position_id), expense_type_id: Number(header.expense_type_id),
      title: header.title.trim(), description: header.description.trim() || undefined, amount: 0, version: request?.version,
    };
    if (requestId) {
      const saved = await expenseRequestsApi.update(requestId, payload);
      setRequest((current) => current ? { ...current, ...saved } : current);
      lastSavedHeader.current = JSON.stringify(header);
      return requestId;
    }
    const created = await expenseRequestsApi.create(payload);
    lastSavedHeader.current = JSON.stringify(header);
    return created.id as string;
  };

  const saveHeader = async (advance: boolean) => {
    if (!headerReady) {
      setError("กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ"); return;
    }
    if (!/^[0-9\s-]{6,30}$/.test(header.bank_account_number)) {
      setError("เลขบัญชีใช้ได้เฉพาะตัวเลข เว้นวรรค และขีด โดยต้องมี 6–30 ตัวอักษร"); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      const savedId = await persistHeader();
      navigate(advance ? `/expense-requests/${savedId}/edit?step=1` : `/expense-requests/${savedId}`, { replace: true });
    } catch (e) { setError(getApiErrorMessage(e, "บันทึกข้อมูลคำขอไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    if (!editable || step !== 0 || !headerReady) return;
    const signature = JSON.stringify(header);
    if (signature === lastSavedHeader.current) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    setAutosaveState("idle"); setAutosaveText("รอบันทึกการเปลี่ยนแปลง…");
    autosaveTimer.current = window.setTimeout(async () => {
      setAutosaveState("saving"); setAutosaveText("กำลังบันทึกอัตโนมัติ…");
      try {
        const savedId = await persistHeader();
        setAutosaveState("saved"); setAutosaveText("บันทึกแบบร่างแล้ว");
        if (!requestId) navigate(`/expense-requests/${savedId}/edit?step=0`, { replace: true });
      } catch (autosaveError) {
        setAutosaveState("error"); setAutosaveText(getApiErrorMessage(autosaveError, "บันทึกอัตโนมัติไม่สำเร็จ"));
      }
    }, 1200);
    return () => { if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current); };
    // Persisting is intentionally driven by the serialized form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, headerReady, editable, step, requestId]);

  const saveItems = async (advance: boolean) => {
    const normalized: ExpenseRequestItem[] = items.map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity), unit: item.unit.trim(), unit_price: Number(item.unit_price) }));
    if (!requestId || normalized.some((item) => !item.description || item.quantity <= 0 || !item.unit || item.unit_price < 0) || subtotal <= 0) {
      setError("กรุณากรอกรายการ รายละเอียด จำนวน หน่วย และราคาให้ถูกต้อง"); return;
    }
    if (typeMayRequireWithholding && !tax.requester_withholding_status) { setError("กรุณาเลือกสถานะการหัก ณ ที่จ่าย"); return; }
    if (wantsWithholding && (!tax.withholding_mode || tax.withholding_mode === "none" || Number(tax.withholding_rate) <= 0 || Number(tax.withholding_rate) >= 100)) { setError("กรุณาระบุอัตราหัก ณ ที่จ่ายมากกว่า 0% แต่น้อยกว่า 100%"); return; }
    if (wantsWithholding && !tax.gross_up_enabled && priceBeforeVat < 1000) { setError("ยอดก่อน VAT ต่ำกว่า 1,000 บาท กรุณาเลือก “ไม่ต้องหัก” แทน"); return; }
    if (wantsWithholding && (!tax.taxpayer_type || !tax.taxpayer_id.trim() || !tax.taxpayer_address.trim())) { setError("กรุณากรอกข้อมูลผู้เสียภาษีให้ครบ"); return; }
    if (wantsWithholding && tax.gross_up_enabled && (!Number(tax.requested_net_amount) || Number(tax.requested_net_amount) > totalWithVat - withholdingAmount)) { setError("ยอดที่ผู้รับเงินต้องได้สุทธิต้องมากกว่า 0 และไม่เกินยอดสุทธิสูงสุดที่วงเงินนี้รองรับ"); return; }
    if (installmentOverrideActive && Number(tax.installment_payment_amount) > subtotal) { setError("ยอดงวดนี้ต้องไม่เกินยอดรวมรายการทั้งหมด"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await expenseRequestsApi.update(requestId, {
        version: request?.version,
        items: normalized, vat_mode: tax.vat_mode, vat_rate: Number(tax.vat_rate), vat_amount: vatAmount,
        discount_amount: Number(tax.discount_amount), price_mode: tax.price_mode,
        installment_payment_amount: installmentOverrideActive ? Number(tax.installment_payment_amount) : null,
        withholding_required: wantsWithholding, withholding_mode: wantsWithholding ? tax.withholding_mode : "none",
        withholding_rate: Number(tax.withholding_rate), withholding_amount: Number(tax.withholding_amount),
        requester_withholding_status: typeMayRequireWithholding ? tax.requester_withholding_status : "not_withheld",
        gross_up_enabled: wantsWithholding && tax.gross_up_enabled,
        requested_net_amount: wantsWithholding && tax.gross_up_enabled ? Number(tax.requested_net_amount) : 0,
        taxpayer_name: header.recipient_name, taxpayer_type: tax.taxpayer_type, taxpayer_branch: tax.taxpayer_branch,
        taxpayer_id: tax.taxpayer_id, taxpayer_address: tax.taxpayer_address,
        recipient_address: tax.taxpayer_address, service_description: tax.service_description,
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

  const uploadFiles = async (files: FileList | null, requirementId?: number) => {
    if (!requestId || !files?.length) return; setUploading(true); setError("");
    try { for (const file of Array.from(files)) await expenseRequestsApi.uploadAttachment(requestId, file, requirementId); await reload(); }
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
  const requiredRequirements = requirements.filter((requirement) => requirement.is_required);
  const assignedRequirementIds = new Set(supporting.map((attachment) => attachment.requirement_id).filter(Boolean));
  const legacyUnassignedCount = supporting.filter((attachment) => !attachment.requirement_id).length;
  const missingRequirementCount = requiredRequirements.filter((requirement) => !assignedRequirementIds.has(requirement.id)).length;
  const completeAttachments = Boolean(primary && missingRequirementCount <= legacyUnassignedCount);

  return <div className="w-full space-y-6 p-6">
    <Link to="/expense-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> กลับไปหน้ารายการ</Link>
    <div className="relative overflow-hidden rounded-[2rem] border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5"><div className="flex h-16 w-16 shrink-0 rotate-3 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white shadow-lg"><Plus className="h-7 w-7" /></div><div><p className="text-sm font-bold text-primary">{request?.request_no || "คำขอเบิกใหม่"}</p><h1 className="text-3xl font-bold">{request ? "แก้ไขคำขอเบิก" : "สร้างคำขอเบิก"}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">ระบบบันทึกแบบร่างให้อัตโนมัติหลังกรอกข้อมูลผู้รับเงินครบ และอัปโหลดเอกสารเข้าร่างทันทีหลังเลือกไฟล์</p></div></div>
        <div className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${autosaveState === "error" ? "bg-rose-50 text-rose-700" : autosaveState === "saved" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{autosaveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : autosaveState === "saved" ? <UploadCloud className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}<span>{autosaveText}</span></div>
      </div>
      {request && <span className={`absolute right-5 top-5 rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLOR[request.status]}`}>{STATUS_LABEL[request.status]}</span>}
    </div>
    <WizardSteps step={step} requestId={requestId} editable={editable} />
    <ErrorNotice message={error} />
    <SuccessNotice message={notice} />

    {step === 0 && <Card><CardContent className="space-y-7 p-6">
      <SectionHeading title="ข้อมูลคำขอ" subtitle="ระบุประเภท วันที่ใช้เงิน และวัตถุประสงค์" />
      <fieldset disabled={!editable} className="space-y-6 disabled:opacity-75">
        <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
          <div><label className={labelCls}>รูปแบบคำขอ *</label><select className={inputCls} value={header.request_format} onChange={(e) => { const format = e.target.value as HeaderForm["request_format"]; setHeader((f) => ({ ...f, request_format: format, installment_enabled: format === "advance" ? false : f.installment_enabled })); }}>{availableKinds.map((kind) => <option key={kind} value={kind}>{REQUEST_FORMAT_LABEL[kind]}</option>)}</select></div>
          <div><label className={labelCls}>ประเภทการเบิก *</label><select className={inputCls} value={header.expense_type_id} onChange={(e) => setHeader((f) => ({ ...f, expense_type_id: e.target.value }))}><option value="">เลือกประเภท</option>{visibleTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>{selectedType?.description && <p className="mt-2 text-xs text-muted-foreground">{selectedType.description}</p>}</div>
          <div><label className={labelCls}>ตำแหน่งที่ใช้ทำรายการ *</label><select className={inputCls} value={header.requester_position_id} onChange={(e) => setHeader((f) => ({ ...f, requester_position_id: e.target.value }))}><option value="">เลือกตำแหน่ง</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">ระบบใช้ตำแหน่งนี้ร่วมกับประเภทและยอดเงินเพื่อเลือกสายอนุมัติ</p></div>
          <div><label className={labelCls}>บริษัทผู้จ่าย *</label><select className={inputCls} value={header.payer_company_name} onChange={(e) => setHeader((f) => ({ ...f, payer_company_name: e.target.value }))}><option value="" disabled>เลือกบริษัทผู้จ่าย</option>{header.payer_company_name && !payerCompanyIsAvailable && <option value={header.payer_company_name}>{header.payer_company_name} (ข้อมูลเดิม)</option>}{payerCompanies.map((company) => <option key={company.id} value={company.name_th}>{formatCompanyLabel(company)}</option>)}</select></div>
          <div><label className={labelCls}>วันที่ต้องการใช้เงิน</label><input type="date" className={inputCls} value={header.required_date} onChange={(e) => setHeader((f) => ({ ...f, required_date: e.target.value }))} /></div>
          <div className="md:col-span-2 2xl:col-span-3"><label className={labelCls}>วัตถุประสงค์ *</label><textarea rows={3} maxLength={3000} className={inputCls} value={header.title} placeholder="เช่น ค่าเดินทางไปพบลูกค้าที่จังหวัดเชียงใหม่" onChange={(e) => setHeader((f) => ({ ...f, title: e.target.value }))} /></div>
        </div>
        <div className="max-w-xl rounded-2xl border p-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={header.installment_enabled}
              disabled={header.request_format === "advance"}
              onChange={(e) => setHeader((f) => ({ ...f, installment_enabled: e.target.checked }))} />
            <span>
              <span className="block text-sm font-semibold">คำขอนี้จ่ายแบบแบ่งงวดได้</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                ฝ่ายบัญชีจะบันทึกจ่ายได้หลายครั้ง ยอดเท่าไหร่ก็ได้ จนกว่าจะครบยอดสุทธิของคำขอนี้ (ใช้ไม่ได้กับคำขอเงินทดรอง)
              </span>
            </span>
          </label>
        </div>
        <div className="border-t pt-6"><SectionHeading title="ผู้รับเงินและบัญชีธนาคาร" subtitle="ข้อมูลนี้เข้ารหัสและเปิดดูได้เฉพาะผู้เกี่ยวข้องกับคำขอ" /><div className="mt-6 grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
          <div><label className={labelCls}>ประเภทผู้รับเงินจริง *</label><select className={inputCls} value={header.recipient_type === "employee" ? "employee" : "external"} onChange={(e) => { const employee = e.target.value === "employee"; setHeader((f) => ({ ...f, recipient_type: employee ? "employee" : "individual", recipient_name: employee ? (user?.full_name || user?.username || "") : "", bank_account_name: employee ? (user?.full_name || user?.username || "") : "" })); }}><option value="employee">พนักงาน</option><option value="external">บุคคลหรือบริษัทภายนอก</option></select></div>
          <div><label className={labelCls}>ชื่อผู้รับเงิน *</label><input className={inputCls} value={header.recipient_name} onChange={(e) => setHeader((f) => ({ ...f, recipient_name: e.target.value }))} /></div>
          <div><label className={labelCls}>ธนาคาร *</label><select className={inputCls} value={bankPicker} onChange={(e) => { const value = e.target.value; setBankPicker(value); setHeader((f) => ({ ...f, bank_name: value === "__other__" ? "" : value })); }}><option value="">เลือกธนาคาร</option>{BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}<option value="__other__">อื่นๆ (ระบุเอง)</option></select>{bankPicker === "__other__" && <input className={`${inputCls} mt-2`} maxLength={100} value={header.bank_name} placeholder="พิมพ์ชื่อธนาคาร" onChange={(e) => setHeader((f) => ({ ...f, bank_name: e.target.value }))} />}</div>
          <div><label className={labelCls}>ชื่อบัญชี *</label><input className={inputCls} value={header.bank_account_name} onChange={(e) => setHeader((f) => ({ ...f, bank_account_name: e.target.value }))} /></div>
          <div className="md:col-span-2 2xl:col-span-3"><label className={labelCls}>เลขบัญชี *</label><input inputMode="numeric" autoComplete="off" maxLength={30} className={inputCls} value={header.bank_account_number} onChange={(e) => setHeader((f) => ({ ...f, bank_account_number: e.target.value }))} /><p className="mt-2 text-xs text-muted-foreground">ตรวจชื่อบัญชีและเลขบัญชีก่อนบันทึกทุกครั้ง</p></div>
          <div className="md:col-span-2 2xl:col-span-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><LockKeyhole className="h-4 w-4" /> จัดเก็บแบบเข้ารหัสและแสดงเฉพาะผู้เกี่ยวข้องกับคำขอ</div>
        </div></div>
      </fieldset>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><span />{editable ? <div className="flex flex-wrap gap-2"><button onClick={() => saveHeader(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกร่างและออก</button><button onClick={() => saveHeader(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} ถัดไป <ChevronRight className="h-4 w-4" /></button></div> : <button onClick={() => go(1)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground">ถัดไป <ChevronRight className="h-4 w-4" /></button>}</div>
    </CardContent></Card>}

    {step === 1 && <Card><CardContent className="space-y-6 p-6">
      <SectionHeading title="รายการค่าใช้จ่าย" subtitle="ยอดรวมคำนวณใหม่ที่เซิร์ฟเวอร์ทุกครั้ง" />
      <fieldset disabled={!editable} className="space-y-5 disabled:opacity-75">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3"><span className="text-sm font-semibold text-muted-foreground">ราคาที่กรอกในตารางเป็นราคา:</span><div className="inline-flex overflow-hidden rounded-lg border"><button type="button" onClick={() => setTax((f) => ({ ...f, price_mode: "exclude_vat" }))} className={`min-h-10 px-3 text-sm font-semibold ${tax.price_mode === "exclude_vat" ? "bg-primary text-primary-foreground" : "bg-background"}`}>ก่อน VAT</button><button type="button" onClick={() => setTax((f) => ({ ...f, price_mode: "include_vat" }))} className={`min-h-10 px-3 text-sm font-semibold ${tax.price_mode === "include_vat" ? "bg-primary text-primary-foreground" : "bg-background"}`}>หลัง VAT</button></div></div>
        {tax.price_mode === "include_vat" && <p className="text-xs text-muted-foreground">ราคาที่กรอกคือราคารวม VAT แล้ว ระบบจะหารด้วยอัตรา VAT ที่เลือกไว้ให้เองก่อนบันทึกยอดจริง</p>}
        <div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[720px] text-sm"><thead className="border-b bg-muted/40"><tr>{["รายละเอียด", "จำนวน", "หน่วย", `ราคาต่อหน่วย (${tax.price_mode === "include_vat" ? "หลัง" : "ก่อน"} VAT)`, `รวม (${tax.price_mode === "include_vat" ? "หลัง" : "ก่อน"} VAT)`, ""].map((h) => <th key={h} className={`px-3 py-3 text-xs font-semibold text-muted-foreground ${h.startsWith("ราคา") || h.startsWith("รวม") ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead><tbody className="divide-y">{items.map((item, index) => <tr key={index}>
          <td className="min-w-[260px] p-2"><input maxLength={200} className={inputCls} value={item.description} placeholder="เช่น ค่าทางด่วน (ไม่เกิน 200 ตัวอักษร ถ้ามีรายละเอียดยาวให้แนบไฟล์)" onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} /></td>
          <td className="w-28 p-2"><input type="number" min="0.001" step="0.001" className={`${inputCls} text-right`} value={item.quantity} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /></td>
          <td className="w-32 p-2"><input className={inputCls} value={item.unit} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, unit: e.target.value } : row))} /></td>
          <td className="w-44 p-2"><input type="number" min="0.0000000001" max="999999999999.99" step="0.0000000001" className={`${inputCls} text-right`} value={item.unit_price} onChange={(e) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, unit_price: e.target.value } : row))} /></td>
          <td className="w-36 px-3 py-2 text-right font-semibold">{formatCurrency((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}</td>
          <td className="w-20 p-2 text-center"><button type="button" disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))} className="rounded-md p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td>
        </tr>)}</tbody></table></div>
        <button type="button" onClick={() => setItems((rows) => [...rows, blankItem()])} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/5"><Plus className="h-4 w-4" /> เพิ่มรายการ</button>
        <div className="flex justify-end"><div className="w-full max-w-sm space-y-3 rounded-2xl border p-4">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">ยอดรวมรายการ</span><b>{formatCurrency(subtotal)}</b></div>
          {header.installment_enabled && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <label className="mb-1.5 block text-sm font-semibold text-amber-800">ยอดที่จะจ่ายงวดนี้ (บาท) *</label>
            <input type="number" min="0.01" max={subtotal} step="0.01" className={inputCls}
              value={tax.installment_payment_amount}
              onChange={(e) => setTax((f) => ({ ...f, installment_payment_amount: e.target.value }))} />
            <p className="mt-1 text-xs text-amber-700">ยอดนี้แทนยอดรวมรายการในการคำนวณ VAT และหัก ณ ที่จ่าย (ยอดเต็มของคำขอ {formatCurrency(subtotal)} บาท) หากยังไม่ทราบยอดงวดแรก เว้นว่างไว้ก่อนได้</p>
          </div>}
          {!installmentOverrideActive && <div><label className="mb-1.5 block text-sm text-muted-foreground">ส่วนลดรวม (บาท)</label><input type="number" min="0" max={subtotal} step="0.01" className={`${inputCls} text-right`} value={tax.discount_amount} onChange={(e) => setTax((f) => ({ ...f, discount_amount: e.target.value }))} /></div>}
          {!installmentOverrideActive && Number(tax.discount_amount) > 0 && <div className="flex justify-between text-sm text-rose-600"><span>ส่วนลด</span><b>−{formatCurrency(Number(tax.discount_amount))}</b></div>}
          <div className="flex justify-between border-t pt-3 text-sm"><span className="text-muted-foreground">ยอดรวมก่อนภาษี</span><b className="text-lg text-emerald-600">{formatCurrency(priceBeforeVat)}</b></div>
          <div><label className="mb-1.5 block text-sm text-muted-foreground">ภาษีมูลค่าเพิ่ม VAT</label><select className={inputCls} value={tax.vat_mode === "none" ? "0" : tax.vat_mode === "amount" ? "actual" : (tax.vat_rate === "7" ? "7" : "custom")} onChange={(e) => { const value = e.target.value; setTax((f) => ({ ...f, vat_mode: value === "0" ? "none" : value === "actual" ? "amount" : "rate", vat_rate: value === "7" ? "7" : value === "custom" ? "" : f.vat_rate, price_mode: value === "actual" ? "exclude_vat" : f.price_mode })); }}><option value="0">ไม่มี</option><option value="7">7% (มาตรฐาน)</option><option value="custom">ระบุอัตราเอง</option><option value="actual">กรอกยอดตามใบกำกับภาษีจริง</option></select></div>
          {tax.vat_mode === "rate" && tax.vat_rate !== "7" && <input type="number" min="0" max="100" step="0.01" className={`${inputCls} text-right`} placeholder="ระบุอัตรา VAT (%)" value={tax.vat_rate} onChange={(e) => setTax((f) => ({ ...f, vat_rate: e.target.value }))} />}
          {tax.vat_mode === "amount" && <><input type="number" min={afterDiscount} step="0.01" className={`${inputCls} text-right`} placeholder="ยอดรวมหลังบวก VAT" value={tax.vat_actual_total} onChange={(e) => setTax((f) => ({ ...f, vat_actual_total: e.target.value }))} /><p className="text-xs text-muted-foreground">กรอกยอดรวมทั้งหมดที่บวก VAT แล้วจากใบกำกับภาษีจริง (ไม่ใช่แค่ยอด VAT) ระบบจะคำนวณ VAT จากส่วนต่างให้เอง</p></>}
          {vatAmount > 0 && <div className="flex justify-between text-sm text-emerald-600"><span>VAT {tax.vat_mode === "amount" ? "ตามใบกำกับภาษีจริง" : "โดยประมาณ"}</span><b>+{formatCurrency(vatAmount)}</b></div>}
          <div className="flex justify-between border-t pt-3"><span className="text-sm font-semibold">ยอดรวมพร้อม VAT โดยประมาณ</span><b className="text-lg text-primary">{formatCurrency(totalWithVat)}</b></div>
          <div className="border-t pt-3">{typeMayRequireWithholding ? <><p className="text-xs text-muted-foreground">ประเภทการเบิกนี้อาจต้องหัก ณ ที่จ่าย — ระบุสถานะและอัตราที่ใช้กับรายการนี้ด้วยตนเอง</p><label className="mt-2 block text-sm text-muted-foreground">รายการนี้ต้องหัก ณ ที่จ่ายไหม *</label><select className={`${inputCls} mt-1.5`} value={tax.requester_withholding_status} onChange={(e) => setTax((f) => ({ ...f, requester_withholding_status: e.target.value as typeof f.requester_withholding_status, withholding_mode: e.target.value === "deduct" ? "rate" : "none", gross_up_enabled: e.target.value === "deduct" ? f.gross_up_enabled : false }))}><option value="not_withheld">ไม่ต้องหัก</option><option value="deduct">ต้องหัก</option><option value="already_withheld">หักและนำส่งเองแล้ว</option></select>{wantsWithholding && <div className="mt-3"><label className="text-sm text-muted-foreground">อัตราที่ใช้</label><select className={`${inputCls} mt-1`} value={["1", "2", "3", "5"].includes(tax.withholding_rate) ? tax.withholding_rate : "custom"} onChange={(e) => setTax((f) => ({ ...f, withholding_rate: e.target.value === "custom" ? "" : e.target.value }))}><option value="">เลือกอัตรา</option><option value="1">1%</option><option value="2">2%</option><option value="3">3%</option><option value="5">5%</option><option value="custom">ระบุเอง</option></select>{!["1", "2", "3", "5"].includes(tax.withholding_rate) && <input type="number" min="0.01" max="99.99" step="0.01" className={`${inputCls} mt-2 text-right`} placeholder="%" value={tax.withholding_rate} onChange={(e) => setTax((f) => ({ ...f, withholding_rate: e.target.value }))} />}</div>}<p className="mt-2 text-xs text-muted-foreground">ข้อมูลนี้ใช้คำนวณยอดหักและยอดโอนสุทธิ บัญชีจะตรวจหลักฐานและบันทึกการจ่ายตามข้อมูลที่ผู้ขอระบุ</p></> : <p className="text-xs text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />ประเภทการเบิกที่เลือกไม่เข้าเงื่อนไขหัก ณ ที่จ่าย</p>}</div>
          {wantsWithholding && <><div className="flex justify-between text-sm text-rose-600"><span>หัก ณ ที่จ่าย</span><b>−{formatCurrency(withholdingAmount)}</b></div><div className="flex justify-between border-t pt-3"><span className="text-sm font-semibold">ยอดที่จะได้รับสุทธิ</span><b className="text-lg text-emerald-600">{formatCurrency(netAfterWithholding)}</b></div></>}
          <p className="text-xs text-muted-foreground">* ระบบใช้ข้อมูล VAT และหัก ณ ที่จ่ายชุดนี้คำนวณยอดโอน</p>
        </div></div>
        <div className="border-t pt-6"><SectionHeading title="ข้อมูลภาษีสำหรับฝ่ายบัญชี" subtitle="ระบุสถานะและอัตราหัก ณ ที่จ่ายไว้ที่กล่องสรุปยอดด้านบนแล้ว — กรอกข้อมูลผู้เสียภาษีที่จำเป็นเมื่อเลือก “ต้องหัก”" />{wantsWithholding && <><div className="mt-6 grid gap-6 md:grid-cols-2 2xl:grid-cols-3"><div><label className={labelCls}>ประเภทผู้เสียภาษี *</label><select className={inputCls} value={tax.taxpayer_type} onChange={(e) => setTax((f) => ({ ...f, taxpayer_type: e.target.value as typeof f.taxpayer_type }))}><option value="individual">บุคคลธรรมดา</option><option value="juristic">นิติบุคคล</option></select></div><div><label className={labelCls}>เลขประจำตัวผู้เสียภาษี *</label><input maxLength={30} className={inputCls} value={tax.taxpayer_id} onChange={(e) => setTax((f) => ({ ...f, taxpayer_id: e.target.value }))} /></div><div><label className={labelCls}>สาขา</label><input className={inputCls} placeholder="สำนักงานใหญ่ หรือสาขา 00001" value={tax.taxpayer_branch} onChange={(e) => setTax((f) => ({ ...f, taxpayer_branch: e.target.value }))} /></div><div className="md:col-span-2 2xl:col-span-3"><label className={labelCls}>ที่อยู่ผู้เสียภาษี *</label><textarea rows={3} className={inputCls} value={tax.taxpayer_address} onChange={(e) => setTax((f) => ({ ...f, taxpayer_address: e.target.value }))} /></div><div className="md:col-span-2 2xl:col-span-3"><label className={labelCls}>รายละเอียดบริการหรือเงินได้</label><textarea rows={3} className={inputCls} value={tax.service_description} onChange={(e) => setTax((f) => ({ ...f, service_description: e.target.value }))} /></div></div><div className="mt-8 max-w-xl rounded-2xl border p-4"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4" checked={tax.gross_up_enabled} onChange={(e) => setTax((f) => ({ ...f, gross_up_enabled: e.target.checked }))} /><span><span className="block text-sm font-semibold">ให้ผู้รับเงินได้สุทธิเต็มจำนวน</span><span className="mt-0.5 block text-xs text-muted-foreground">กรอกยอดสุทธิที่ตกลงจ่าย ระบบคำนวณยอดเบิกเผื่อภาษีให้อัตโนมัติ</span></span></label>{tax.gross_up_enabled && <div className="mt-4 max-w-xs"><label className={labelCls}>ยอดที่ผู้รับเงินต้องได้สุทธิ (บาท) *</label><input type="number" min="0.01" max={Math.max(0, totalWithVat - withholdingAmount)} step="0.01" className={inputCls} placeholder="เช่น 1500" value={tax.requested_net_amount} onChange={(e) => setTax((f) => ({ ...f, requested_net_amount: e.target.value }))} /><p className="mt-2 text-xs text-muted-foreground">ต้องไม่เกินยอดสุทธิสูงสุดที่วงเงินนี้รองรับ {formatCurrency(Math.max(0, totalWithVat - withholdingAmount))}</p></div>}</div></>}</div>
      </fieldset>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button onClick={() => go(0)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm hover:bg-muted"><ChevronLeft className="h-4 w-4" /> ย้อนกลับ</button>{editable ? <div className="flex flex-wrap gap-2"><button onClick={() => saveItems(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกร่างและออก</button><button onClick={() => saveItems(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} ถัดไป <ChevronRight className="h-4 w-4" /></button></div> : <button onClick={() => go(2)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground">ถัดไป <ChevronRight className="h-4 w-4" /></button>}</div>
    </CardContent></Card>}

    {step === 2 && <Card><CardContent className="space-y-7 p-6">
      <SectionHeading title="เอกสารแนบ" />
      <div className="space-y-3"><div><h3 className="font-medium">เอกสารหลักสำหรับอนุมัติ (PDF) <span className="text-rose-600">*</span></h3><p className="mt-1 text-sm text-muted-foreground">ระบบสร้างให้อัตโนมัติจากข้อมูลคำขอ ไม่ต้องอัปโหลดเอง</p></div>
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${primary ? "border-emerald-200 bg-emerald-50" : "border-dashed"}`}>
          <div className="flex items-center gap-3">{saving ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : primary ? <FileCheck2 className="h-7 w-7 text-emerald-600" /> : <FileText className="h-7 w-7 text-muted-foreground" />}<div><p className="font-medium">{primary ? "สร้างเอกสารแล้ว" : saving ? "กำลังสร้างเอกสาร..." : "ยังไม่มีเอกสารหลัก"}</p>{primary && <p className="text-xs text-muted-foreground">{primary.file_name}</p>}</div></div>
          {requestId && primary && <div className="flex items-center gap-3"><AttachmentLink requestId={requestId} attachment={primary} />{editable && <button onClick={regenerate} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium"><RefreshCw className="h-3.5 w-3.5" /> สร้างใหม่</button>}</div>}
        </div>
      </div>
      <div className="space-y-4 border-t pt-6">{(requirements.length ? requirements : [{ id: 0, expense_type_id: Number(header.expense_type_id), code: "supporting", name: "เอกสารประกอบเพิ่มเติม", is_required: true, requires_signature: false, allowed_mime_types: ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], max_file_size: 10 * 1024 * 1024, sort_order: 0, is_active: true }]).map((requirement, requirementIndex) => {
        const files = supporting.filter((attachment) => attachment.requirement_id === requirement.id || (requirementIndex === 0 && !attachment.requirement_id));
        const mimeNames = requirement.allowed_mime_types.map((mime) => ({ "application/pdf": "PDF", "image/jpeg": "JPG/JPEG", "image/png": "PNG", "application/msword": "DOC", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX", "application/vnd.ms-excel": "XLS", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX" }[mime] || mime)).join(", ");
        const accept = requirement.allowed_mime_types.join(",");
        return <div key={requirement.id} className="rounded-2xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div><div><h3 className="font-semibold">{requirement.name} {requirement.is_required && <span className="text-rose-600">*</span>}</h3>{requirement.description && <p className="mt-1 text-xs text-muted-foreground">{requirement.description}</p>}<p className="mt-1 text-xs text-muted-foreground">{requirement.is_required ? "บังคับอย่างน้อย 1 ไฟล์ · " : ""}รองรับ {mimeNames} · สูงสุด {Math.max(1, Math.round(requirement.max_file_size / 1024 / 1024))} MB</p></div></div>{requirement.requires_signature && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">ต้องเซ็น</span>}</div>
          {editable && <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 hover:border-primary hover:bg-primary/5"><input type="file" multiple className="hidden" accept={accept} onChange={(e) => { uploadFiles(e.target.files, requirement.id || undefined); e.currentTarget.value = ""; }} /><Upload className="h-6 w-6 text-primary" /><span><span className="block text-sm font-semibold">{uploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}</span><span className="text-xs text-muted-foreground">เลือกหลายไฟล์ได้ ระบบจะอัปโหลดเข้าแบบร่างทันทีและเก็บไว้เมื่อรีเฟรชหน้า (รวมสูงสุด 10 ไฟล์)</span></span></label>}
          {requirement.requires_signature && <p className="mt-2 text-xs text-muted-foreground">ถ่ายรูปแนบได้เลย (JPG/PNG) หรือแนบ PDF — เอกสารนี้จะถูกนำไปใช้ในขั้นตอนลงลายเซ็น</p>}
          {files.length > 0 && <div className="mt-4 rounded-xl border bg-muted/30 p-3"><p className="text-xs font-semibold">ไฟล์ที่บันทึกไว้</p><div className="mt-2 space-y-2">{files.map((attachment) => <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{attachment.file_name}</p><p className="text-xs text-muted-foreground">{Math.ceil(attachment.file_size / 1024)} KB · บันทึกแล้ว</p></div><div className="flex items-center gap-2">{requestId && <AttachmentLink requestId={requestId} attachment={attachment} />}{editable && <button onClick={() => removeAttachment(attachment.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> ยกเลิกไฟล์</button>}</div></div>)}</div></div>}
        </div>;
      })}</div>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button onClick={() => go(1)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm hover:bg-muted"><ChevronLeft className="h-4 w-4" /> ย้อนกลับ</button><div className="flex flex-wrap gap-2">{editable && <button onClick={confirmCurrentDraft} disabled={saving || uploading} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกแบบร่าง</button>}<button onClick={() => go(3)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">ตรวจสอบคำขอ <ChevronRight className="h-4 w-4" /></button></div></div>
    </CardContent></Card>}

    {step === 3 && request && <Card><CardContent className="space-y-6 p-6">
      <SectionHeading title="ตรวจสอบก่อนบันทึก" subtitle="ตรวจผู้รับเงิน เลขบัญชี และยอดรวมให้ถูกต้อง จากนั้นส่งคำขอเพื่ออนุมัติ" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">คำขอและผู้รับเงิน</h3>{editable && <button onClick={() => go(0)} className="text-sm font-medium text-primary">แก้ไข</button>}</div><dl className="grid grid-cols-[145px_1fr] gap-x-3 gap-y-3 text-sm"><dt className="text-muted-foreground">รูปแบบ / ประเภท / ตำแหน่ง</dt><dd className="font-medium">{REQUEST_FORMAT_LABEL[request.request_format]} / {request.expense_type_name} / {request.requester_position_name}</dd><dt className="text-muted-foreground">วันที่ต้องการใช้เงิน</dt><dd className="font-medium">{request.required_date ? formatDate(request.required_date) : "ไม่ระบุ"}</dd><dt className="text-muted-foreground">วัตถุประสงค์</dt><dd className="whitespace-pre-wrap font-medium">{request.title}</dd><dt className="text-muted-foreground">ผู้รับเงิน</dt><dd className="font-medium">{request.recipient_name} ({request.recipient_type === "employee" ? "พนักงาน" : "บุคคลหรือบริษัทภายนอก"})</dd><dt className="text-muted-foreground">บัญชีรับเงิน</dt><dd className="font-medium">{request.bank_name} · {request.bank_account_name} · {request.bank_account_masked}</dd></dl></div>
        <div className="rounded-xl border p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">รายการค่าใช้จ่าย</h3>{editable && <button onClick={() => go(1)} className="text-sm font-medium text-primary">แก้ไข</button>}</div><div className="space-y-3">{request.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm"><span>{item.description} × {item.quantity} {item.unit} @ {formatCurrency(item.unit_price)}</span><b>{formatCurrency(item.line_total || item.quantity * item.unit_price)}</b></div>)}</div>
        {request.installment_enabled && request.installment_payment_amount ? <div className="mt-4 space-y-2 border-t pt-3">
          <div className="flex justify-between text-sm text-muted-foreground"><span>ยอดรวมรายการทั้งหมด</span><span>{formatCurrency(request.subtotal)}</span></div>
          <div className="flex justify-between rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800"><span>จำนวนที่จะจ่ายงวดนี้</span><span>{formatCurrency(request.amount)}</span></div>
        </div> : <div className="mt-4 flex justify-between border-t pt-3 font-semibold"><span>ยอดรวม</span><span className="text-primary">{formatCurrency(request.amount)}</span></div>}</div>
        <div className="rounded-xl border p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">ภาษี</h3>{editable && <button onClick={() => go(1)} className="text-sm font-medium text-primary">แก้ไข</button>}</div><p className="text-sm font-medium">สถานะที่ผู้ขอกำหนด: {request.requester_withholding_status === "deduct" ? `ต้องหัก (${request.withholding_rate}%)` : request.requester_withholding_status === "already_withheld" ? "หักและนำส่งเองแล้ว" : "ไม่ต้องหัก"}</p><div className="mt-3 space-y-2 rounded-xl bg-muted/30 p-3 text-sm">{request.vat_amount > 0 && <div className="flex justify-between text-emerald-700"><span>VAT {request.vat_mode === "amount" ? "ตามใบกำกับภาษีจริง" : `ประมาณ ${request.vat_rate}%`}</span><b>+{formatCurrency(request.vat_amount)}</b></div>}{request.withholding_required && <div className="flex justify-between border-t pt-2 text-rose-700"><span>หัก ณ ที่จ่าย ({request.withholding_rate}%)</span><b>−{formatCurrency(request.withholding_amount)}</b></div>}<div className="flex justify-between border-t pt-2"><span>{request.gross_up_enabled ? "ยอดที่ผู้รับเงินต้องได้สุทธิ (Gross-up)" : "ยอดที่จะได้รับสุทธิ"}</span><b className="text-emerald-600">{formatCurrency(request.net)}</b></div></div></div>
        <div className={`rounded-xl border p-5 ${completeAttachments ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"}`}><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">เอกสารแนบ</h3><p className="mt-1 text-sm text-muted-foreground">ตรวจความครบถ้วนและชื่อไฟล์ก่อนบันทึก</p></div>{editable && <button onClick={() => go(2)} className="text-sm font-medium text-primary">แก้ไข</button>}</div>{completeAttachments ? <div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-emerald-600" /><div><p className="font-medium text-emerald-800">เอกสารครบแล้ว</p><p className="text-sm text-emerald-700">ตรวจพบเอกสาร {request.attachments.length} ไฟล์ พร้อมส่งคำขอ</p></div></div> : <p className="text-sm text-rose-700">ยังขาดเอกสารบังคับ {missingRequirementCount > legacyUnassignedCount ? missingRequirementCount - legacyUnassignedCount : primary ? 0 : 1} รายการ</p>}<div className="mt-4 space-y-2 text-sm">{request.attachments.map((attachment) => <div key={attachment.id} className="flex items-center justify-between"><span>{attachment.file_name}</span><AttachmentLink requestId={request.id} attachment={attachment} /></div>)}</div></div>
      </div>
      {preview && <div className={`rounded-xl border p-4 ${preview.matched ? "border-blue-200 bg-blue-50" : "border-rose-200 bg-rose-50"}`}><p className="text-sm font-medium">สายอนุมัติ</p>{preview.matched ? <div className="mt-3 flex flex-wrap items-center gap-2">{preview.steps.map((approvalStep, index) => <div key={approvalStep.step_no} className="flex items-center gap-2"><div className="rounded-lg border bg-white px-3 py-2 text-xs"><b>{index + 1}. {approvalStep.approver_position_name}</b><p className="mt-0.5 text-muted-foreground">{approvalStep.resolved_approver_name || approvalStep.warning}</p></div>{index < preview.steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}</div>)}</div> : <p className="mt-2 text-sm text-rose-700">{preview.message}</p>}</div>}
      {editable ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span className="text-sm font-medium">ฉันตรวจสอบชื่อผู้รับเงิน เลขบัญชี ยอดเงิน และเอกสารแล้ว</span></label> : <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">คำขอนี้ถูกส่งแล้ว จึงเปิดดูได้อย่างเดียว</div>}
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><button onClick={() => go(2)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm hover:bg-muted"><ChevronLeft className="h-4 w-4" /> ย้อนกลับ</button>{editable && <div className="flex flex-wrap gap-2"><button onClick={confirmCurrentDraft} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" /> บันทึกแบบร่าง</button><button onClick={submitRequest} disabled={!confirmed || !completeAttachments || !preview?.matched || saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} ส่งคำขอเพื่ออนุมัติ</button></div>}</div>
    </CardContent></Card>}
  </div>;
}
