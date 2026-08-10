import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileCheck2, FileText,
  Loader2, Printer, RefreshCw, Search,
} from "lucide-react";

import { api, getApiErrorMessage } from "@/api/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type CopyType = "customer" | "company" | "accounting" | "all";
type PaymentMethod = "cash" | "credit" | "transfer" | "other";
type StepKey = "copy" | "orders" | "review";
type ExportKind = "xlsx" | "pdf";

interface TaxInvoiceLine {
  order_number?: string;
  product_code: string;
  description: string;
  quantity: number | string;
  unit: string;
  unit_price: number | string;
}

interface TaxInvoiceDocument {
  invoice_number: string;
  invoice_date: string;
  order_numbers: string[];
  customer: { name: string; address: string; tax_id: string; branch: string };
  payment_method: PaymentMethod;
  credit_days: number;
  lines: TaxInvoiceLine[];
  discount_amount: number | string;
  vat_rate: number | string;
  notes: string;
}

interface LookupResponse {
  source: "crm" | "mock";
  warning?: string;
  document: TaxInvoiceDocument;
}

const steps: Array<{ key: StepKey; label: string }> = [
  { key: "copy", label: "เลือกชุดเอกสาร" },
  { key: "orders", label: "กรอกเลขออเดอร์" },
  { key: "review", label: "ตรวจสอบและแก้ไขข้อมูล" },
];

const copyOptions: Array<{
  key: CopyType;
  label: string;
  detail: string;
  color: string;
  disabled?: boolean;
}> = [
  { key: "customer", label: "ต้นฉบับสำหรับลูกค้า", detail: "แถบสีแดง", color: "border-red-500 bg-red-50 text-red-700" },
  { key: "company", label: "สำเนาสำหรับบริษัท", detail: "แถบสีส้ม", color: "border-orange-500 bg-orange-50 text-orange-700" },
  { key: "accounting", label: "สำเนาสำหรับบัญชี", detail: "แถบสีน้ำเงิน", color: "border-blue-500 bg-blue-50 text-blue-700" },
  { key: "all", label: "ครบทั้ง 3 ฉบับ", detail: "ต้นฉบับและสำเนาทั้งหมด", color: "border-slate-500 bg-slate-50 text-slate-700" },
];

const money = (value: number) =>
  new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const quantityText = (value: number | string) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 4 }).format(Number(value) || 0);

const thaiDateText = (value: string) => {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value || "-";
};

const normalizeTaxInvoiceDocument = (document: TaxInvoiceDocument): TaxInvoiceDocument => {
  const orderNotes = document.order_numbers.join(", ");
  const notes = document.notes.replace(/^อ้างอิงออเดอร์:\s*/u, "").trim();
  return {
    ...document,
    notes: notes === orderNotes ? "" : notes,
  };
};

export function TaxInvoicePage() {
  const [step, setStep] = useState<StepKey>("copy");
  const [copyType, setCopyType] = useState<CopyType>("customer");
  const [orderText, setOrderText] = useState("");
  const [document, setDocument] = useState<TaxInvoiceDocument | null>(null);
  const [source, setSource] = useState<"crm" | "mock" | null>(null);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const currentStepIndex = steps.findIndex((item) => item.key === step);

  const totals = useMemo(() => {
    if (!document) return { subtotal: 0, afterDiscount: 0, vat: 0, grandTotal: 0 };
    const subtotal = document.lines.reduce(
      (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0),
      0,
    );
    const afterDiscount = Math.max(0, subtotal - (Number(document.discount_amount) || 0));
    const vat = afterDiscount * (Number(document.vat_rate) || 0) / 100;
    return { subtotal, afterDiscount, vat, grandTotal: afterDiscount + vat };
  }, [document]);

  const orderNumbers = () =>
    Array.from(new Set(
      orderText.split(/[\n,\s]+/).map((value) => value.trim()).filter(Boolean),
    ));

  const isHeadOffice = !document?.customer.branch || document.customer.branch === "สำนักงานใหญ่";
  const branchNumber = document?.customer.branch.startsWith("สาขาที่")
    ? document.customer.branch.replace(/^สาขาที่\s*/, "")
    : "";

  const goToCopy = () => {
    setError("");
    setNotice("");
    setStep("copy");
  };

  const goToOrders = () => {
    setError("");
    setNotice("");
    setStep("orders");
  };

  const lookupOrders = async () => {
    const orders = orderNumbers();
    if (!orders.length) {
      setError("กรุณากรอกเลขออเดอร์อย่างน้อย 1 รายการ");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    setWarning("");
    try {
      const response = await api.post<LookupResponse>("/tax-invoices/crm-orders/lookup", {
        order_numbers: orders,
      });
      setDocument(normalizeTaxInvoiceDocument(response.data.document));
      setSource(response.data.source);
      setWarning(response.data.warning ?? "");
      setStep("review");
    } catch (caught) {
      setError(getApiErrorMessage(caught, "ดึงข้อมูลออเดอร์ไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  };

  const updateDocument = <K extends keyof TaxInvoiceDocument>(
    key: K,
    value: TaxInvoiceDocument[K],
  ) => setDocument((current) => current ? { ...current, [key]: value } : current);

  const updateCustomer = (key: keyof TaxInvoiceDocument["customer"], value: string) =>
    setDocument((current) => current
      ? { ...current, customer: { ...current.customer, [key]: value } }
      : current);

  const updateLine = (index: number, key: keyof TaxInvoiceLine, value: string | number) =>
    setDocument((current) => current
      ? {
          ...current,
          lines: current.lines.map((line, lineIndex) =>
            lineIndex === index ? { ...line, [key]: value } : line),
        }
      : current);

  const exportPayload = () => ({
    copy_type: copyType,
    source,
    document: document ? { ...document, credit_days: 0 } : document,
  });

  const downloadXlsx = async () => {
    if (!document) return;
    setExporting("xlsx");
    setError("");
    setNotice("");
    try {
      const response = await api.post(
        "/tax-invoices/export.xlsx",
        exportPayload(),
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `tax-invoice-${document.invoice_number.replace(/\//g, "-")}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("บันทึกข้อมูลใบกำกับภาษีลงฐานข้อมูลและส่งออก Excel แล้ว");
    } catch (caught) {
      setError(getApiErrorMessage(caught, "บันทึกข้อมูลหรือส่งออก Excel ไม่สำเร็จ"));
    } finally {
      setExporting(null);
    }
  };

  const openPdfForPrint = async () => {
    if (!document) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("เบราว์เซอร์บล็อกหน้าต่าง PDF กรุณาอนุญาต pop-up สำหรับเว็บไซต์นี้");
      return;
    }
    printWindow.opener = null;
    printWindow.document.title = "กำลังสร้างใบกำกับภาษี";
    printWindow.document.body.innerHTML = `
      <div style="font-family: sans-serif; padding: 32px; text-align: center;">
        กำลังสร้าง PDF สำหรับดูและสั่งพิมพ์...
      </div>
    `;
    setExporting("pdf");
    setError("");
    setNotice("");
    try {
      const response = await api.post(
        "/tax-invoices/export.pdf",
        exportPayload(),
        { responseType: "blob" },
      );
      const pdfBlob = new Blob([response.data], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      printWindow.location.replace(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      setNotice("บันทึกข้อมูลใบกำกับภาษีลงฐานข้อมูลและเปิด PDF แล้ว");
    } catch (caught) {
      printWindow.close();
      setError(getApiErrorMessage(caught, "บันทึกข้อมูลหรือสร้าง PDF ไม่สำเร็จ"));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="min-h-full bg-slate-50">
      <PageHeader
        title="ใบกำกับภาษีจากออเดอร์"
        subtitle="ดึงข้อมูลจาก crm-kawin แก้ไขก่อนออกเอกสาร และบันทึกข้อมูลหลังส่งออก"
      />

      <div className="mx-auto max-w-[1320px] space-y-5 p-6">
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="grid gap-3 md:grid-cols-3">
              {steps.map((item, index) => {
                const active = item.key === step;
                const complete = index < currentStepIndex;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-4 py-3",
                      active && "border-primary bg-primary/5",
                      complete && "border-emerald-200 bg-emerald-50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                        active && "border-primary bg-primary text-primary-foreground",
                        complete && "border-emerald-600 bg-emerald-600 text-white",
                      )}
                    >
                      {complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </div>
                    <div className="min-w-0">
                      {/* <p className="text-xs text-muted-foreground">เฟส {index + 1}</p> */}
                      <p className="truncate text-sm font-medium">{item.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}
        {warning && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> {source === "mock" ? "ข้อมูลจำลอง" : "ตรวจสอบออเดอร์"}
            </div>
            {warning}
          </div>
        )}

        {step === "copy" && (
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                เลือกชุดเอกสาร
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {copyOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      if (!option.disabled) setCopyType(option.key);
                    }}
                    disabled={option.disabled}
                    className={cn(
                      "flex min-h-24 items-center justify-between rounded-md border-l-4 border-y border-r px-4 py-3 text-left transition",
                      copyType === option.key ? option.color : "border-l-slate-200 bg-white hover:bg-slate-50",
                      option.disabled && "cursor-not-allowed border-slate-200 bg-slate-100 text-muted-foreground opacity-60",
                    )}
                  >
                    <span>
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-1 block text-xs opacity-70">{option.detail}</span>
                    </span>
                    {copyType === option.key && <FileCheck2 className="h-4 w-4" />}
                  </button>
                ))}
              </div>

              <div className="flex justify-end">
                <Button onClick={goToOrders}>
                  ถัดไป
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "orders" && (
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-primary" />
                กรอกเลขออเดอร์
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label htmlFor="order-numbers">เลขออเดอร์</Label>
                <textarea
                  id="order-numbers"
                  rows={8}
                  value={orderText}
                  onChange={(event) => setOrderText(event.target.value)}
                  placeholder={"เช่น\n KWB0000000000"}
                  className="mt-1.5 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground"></p>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" onClick={goToCopy}>
                  <ArrowLeft className="h-4 w-4" />
                  กลับ
                </Button>
                <Button onClick={lookupOrders} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  ถัดไป
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "review" && (
          !document ? (
            <Card className="flex min-h-[360px] items-center justify-center rounded-lg border-dashed">
              <div className="max-w-sm text-center">
                <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <h2 className="font-semibold">ยังไม่มีข้อมูลใบกำกับภาษี</h2>
                <p className="mt-1 text-sm text-muted-foreground">กลับไปกรอกเลขออเดอร์เพื่อดึงข้อมูล</p>
                <Button className="mt-4" variant="outline" onClick={goToOrders}>
                  <ArrowLeft className="h-4 w-4" />
                  กลับ
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="rounded-lg">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">ตรวจสอบและแก้ไขข้อมูล</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="เลขที่ใบกำกับภาษี">
                    <Input value={document.invoice_number} onChange={(event) => updateDocument("invoice_number", event.target.value)} />
                  </Field>
                  <Field label="วันที่">
                    <ReadOnlyValue value={thaiDateText(document.invoice_date)} />
                  </Field>
                  <Field label="ชื่อลูกค้า">
                    <ReadOnlyValue value={document.customer.name} />
                  </Field>
                  <Field label="เลขผู้เสียภาษี">
                    <Input value={document.customer.tax_id} onChange={(event) => updateCustomer("tax_id", event.target.value)} />
                  </Field>
                  <Field label="สาขา">
                    <div className="flex min-h-10 flex-wrap items-center gap-4 rounded-md border bg-white px-3 py-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={isHeadOffice}
                          onChange={() => updateCustomer("branch", "สำนักงานใหญ่")}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        สำนักงานใหญ่
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!isHeadOffice}
                          onChange={() => updateCustomer("branch", `สาขาที่ ${branchNumber}`.trim())}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        สาขาที่
                      </label>
                      {!isHeadOffice && (
                        <Input
                          value={branchNumber}
                          onChange={(event) => updateCustomer("branch", `สาขาที่ ${event.target.value}`.trim())}
                          placeholder="เลขสาขา"
                          className="h-8 w-28"
                        />
                      )}
                    </div>
                  </Field>
                  <Field label="ที่อยู่" className="md:col-span-2 xl:col-span-4">
                    <ReadOnlyValue value={document.customer.address} multiline />
                  </Field>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="bg-slate-50 text-xs text-muted-foreground">
                      <tr>
                        <th className="w-12 p-2 text-center">#</th>
                        <th className="w-32 p-2 text-left">ออเดอร์</th>
                        <th className="w-32 p-2 text-left">รหัส</th>
                        <th className="p-2 text-left">รายการ</th>
                        <th className="w-24 p-2 text-right">จำนวน</th>
                        <th className="w-24 p-2 text-left">หน่วย</th>
                        <th className="w-36 p-2 text-right">ราคา/หน่วย</th>
                        <th className="w-36 p-2 text-right">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {document.lines.map((line, index) => (
                        <tr key={`${index}-${line.order_number ?? "manual"}`} className="border-t">
                          <td className="p-2 text-center text-muted-foreground">{index + 1}</td>
                          <td className="p-2 font-mono text-xs">{line.order_number || "-"}</td>
                          <td className="p-2 font-mono text-xs">{line.product_code || "-"}</td>
                          <td className="p-2">{line.description}</td>
                          <td className="p-2 text-right font-mono">{quantityText(line.quantity)}</td>
                          <td className="p-1">
                            <Input
                              value={line.unit}
                              onChange={(event) => updateLine(index, "unit", event.target.value)}
                              placeholder="ใส่หน่วย"
                            />
                          </td>
                          <td className="p-2 text-right font-mono">{money(Number(line.unit_price) || 0)}</td>
                          <td className="p-2 text-right font-mono">{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_320px]">
                  <Field label="หมายเหตุ">
                    <textarea
                      rows={4}
                      value={document.notes}
                      onChange={(event) => updateDocument("notes", event.target.value)}
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                    />
                  </Field>
                  <div className="space-y-3 rounded-md bg-slate-50 p-4">
                    <MoneyRow label="รวมเงิน" value={totals.subtotal} />
                    <div className="flex items-center justify-between gap-3">
                      <Label className="shrink-0">ส่วนลด</Label>
                      <Input className="w-32 text-right" type="number" min="0" step="0.01" value={document.discount_amount} onChange={(event) => updateDocument("discount_amount", event.target.value)} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label className="shrink-0">VAT (%)</Label>
                      <Input className="w-32 text-right" type="number" min="0" step="0.01" value={document.vat_rate} onChange={(event) => updateDocument("vat_rate", event.target.value)} />
                    </div>
                    <MoneyRow label="ภาษีมูลค่าเพิ่ม" value={totals.vat} />
                    <div className="border-t pt-3">
                      <MoneyRow label="ยอดสุทธิ" value={totals.grandTotal} strong />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <Button variant="outline" onClick={goToOrders}>
                    <ArrowLeft className="h-4 w-4" />
                    กลับ
                  </Button>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={downloadXlsx} disabled={!!exporting}>
                      {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Export Excel
                    </Button>
                    <Button onClick={openPdfForPrint} disabled={!!exporting}>
                      {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      PDF / พิมพ์
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ReadOnlyValue({ value, multiline = false }: { value: string; multiline?: boolean }) {
  return (
    <div
      className={cn(
        "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700",
        multiline ? "min-h-[66px] whitespace-pre-wrap" : "flex h-10 items-center",
      )}
    >
      {value || "-"}
    </div>
  );
}

function MoneyRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between text-sm", strong && "text-base font-bold text-primary")}>
      <span>{label}</span><span className="font-mono">{money(value)}</span>
    </div>
  );
}
