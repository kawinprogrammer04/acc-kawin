import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, Loader2, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { hrExpenseAccountingApi, type HrExpenseSnapshot } from "@/api/approvals";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate, today } from "@/lib/format";


function newKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `acc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-black transition disabled:cursor-wait disabled:opacity-50";
const inputClass = "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm";

export function HrExpenseRequestDetailPage() {
  const { integrationId = "" } = useParams();
  const [item, setItem] = useState<HrExpenseSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [paidDate, setPaidDate] = useState(today());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [settlementNote, setSettlementNote] = useState("");
  const [wht, setWht] = useState({ certificate_number: "", issued_date: today(), tax_base: "", tax_rate: "", tax_amount: "" });

  const load = useCallback(async () => {
    if (!integrationId) return;
    setLoading(true); setError("");
    try {
      const result = await hrExpenseAccountingApi.detail(integrationId);
      setItem(result.item); setStale(result.stale);
    } catch (e) {
      setError(getApiErrorMessage(e, "โหลดคำขอจาก HR ไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, [integrationId]);

  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<{ item?: HrExpenseSnapshot }>, success: string) => {
    setActing(true); setError(""); setNotice("");
    try {
      const result = await action();
      if (result.item) setItem(result.item);
      else await load();
      setStale(false); setNotice(success); setReason("");
    } catch (e) {
      setError(getApiErrorMessage(e, "ระบบ HR ไม่สามารถดำเนินการได้ กรุณาโหลดใหม่แล้วลองอีกครั้ง"));
    } finally {
      setActing(false);
    }
  };

  if (loading && !item) return <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!item) return <div className="space-y-4 p-6"><Link to="/expense-requests/accounting" className="text-primary">กลับหน้าบัญชีจ่ายเงิน</Link>{error && <p className="text-rose-600">{error}</p>}</div>;

  const actions = new Set(item.allowed_actions || []);
  const meta = () => ({ expected_version: item.version, idempotency_key: newKey() });
  const amounts: Partial<Record<"gross" | "vat" | "withholding" | "net" | "remaining", string>> = item.amounts || {};

  return <div className="w-full space-y-6 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link to="/expense-requests/accounting" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />กลับหน้าบัญชีจ่ายเงิน</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="font-mono text-2xl font-black">{item.request_no}</h1><span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-700 dark:bg-blue-950/60 dark:text-blue-200">ข้อมูลจาก HR</span><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-black text-primary">{item.status_label || item.status_code}</span></div>
        <p className="mt-2 text-muted-foreground">{item.request?.title || item.request?.purpose || "-"}</p>
      </div>
      <button type="button" disabled={loading || acting} onClick={load} className={`${buttonClass} border bg-background hover:bg-muted`}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />โหลดข้อมูลล่าสุด</button>
    </div>

    {stale && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">ติดต่อ HR ไม่สำเร็จ ข้อมูลที่เห็นเป็นสำเนาล่าสุดและปิดการทำ action ไว้ชั่วคราว</div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {[
        ["ผู้ขอ", item.requester?.name || "-"], ["ผู้รับเงิน", item.payee?.name || "-"],
        ["ประเภท", item.request?.expense_type || item.request?.kind_label || "-"],
        ["วันที่ต้องการใช้", item.request?.required_date ? formatDate(`${item.request.required_date}T00:00:00`) : "-"],
        ["บริษัท", item.company?.name || "-"], ["แผนก", item.department?.name || "-"],
        ["ธนาคาร", item.payee?.bank_name || "-"], ["เลขบัญชี", item.payee?.bank_account_number || (item.payee?.bank_account_last4 ? `••••${item.payee.bank_account_last4}` : "-")],
      ].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 break-words font-black">{value}</p></CardContent></Card>)}
    </div>

    <Card><CardContent className="p-5"><h2 className="text-lg font-black">ยอดเงิน</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[
      ["ยอดรวม", amounts.gross], ["VAT", amounts.vat], ["หัก ณ ที่จ่าย", amounts.withholding], ["ยอดโอนสุทธิ", amounts.net], ["คงเหลือ", amounts.remaining],
    ].map(([label, value]) => <div key={label}><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 text-lg font-black text-primary">{formatCurrency(Number(value || 0))}</p></div>)}</div></CardContent></Card>

    {item.items && item.items.length > 0 && <Card><CardContent className="p-5"><h2 className="text-lg font-black">รายละเอียดรายการ</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">รายการ</th><th className="p-2 text-right">จำนวน</th><th className="p-2 text-right">ราคาต่อหน่วย</th><th className="p-2 text-right">รวม</th></tr></thead><tbody>{item.items.map((row, index) => <tr key={`${row.description}-${index}`} className="border-b"><td className="p-2">{row.description}</td><td className="p-2 text-right">{row.quantity} {row.unit}</td><td className="p-2 text-right">{formatCurrency(Number(row.unit_price))}</td><td className="p-2 text-right font-bold">{formatCurrency(Number(row.line_total))}</td></tr>)}</tbody></table></div></CardContent></Card>}

    {item.approval_trail && item.approval_trail.length > 0 && <Card><CardContent className="p-5"><h2 className="text-lg font-black">ลำดับการอนุมัติจาก HR</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{item.approval_trail.map(step => <div key={`${step.step}-${step.name}`} className="rounded-xl border p-4"><div className="flex justify-between gap-3"><p className="font-black">{step.step}. {step.name || "ขั้นอนุมัติ"}</p><span className="text-xs font-bold text-muted-foreground">{step.status}</span></div>{step.approvers?.map((approver, index) => <p key={`${approver.name}-${index}`} className="mt-2 text-sm text-muted-foreground">{approver.name || "ผู้อนุมัติ"} · {approver.status}{approver.comment ? ` · ${approver.comment}` : ""}</p>)}</div>)}</div></CardContent></Card>}

    <Card><CardContent className="space-y-4 p-5"><h2 className="text-lg font-black">ดำเนินการใน HR</h2>
      {actions.size === 0 && <p className="text-sm text-muted-foreground">สถานะนี้ไม่มี action สำหรับฝ่ายบัญชี</p>}
      {actions.has("review") && <button disabled={acting || stale} className={`${buttonClass} bg-primary text-primary-foreground`} onClick={() => run(() => hrExpenseAccountingApi.review(integrationId, meta()), "ตรวจสอบและส่งต่อพร้อมจ่ายแล้ว")}>ตรวจสอบและส่งต่อพร้อมจ่าย</button>}
      {(actions.has("return") || actions.has("cancel")) && <div className="space-y-3"><textarea value={reason} onChange={event => setReason(event.target.value)} className={`${inputClass} min-h-24 py-3`} placeholder="ระบุเหตุผลอย่างน้อย 3 ตัวอักษร" /><div className="flex flex-wrap gap-2">{actions.has("return") && <button disabled={acting || stale || reason.trim().length < 3} className={`${buttonClass} bg-amber-500 text-white`} onClick={() => run(() => hrExpenseAccountingApi.returnForCorrection(integrationId, { ...meta(), reason }), "ส่งกลับให้ผู้ขอแก้ไขแล้ว")}>ส่งกลับแก้ไข</button>}{actions.has("cancel") && <button disabled={acting || stale || reason.trim().length < 3} className={`${buttonClass} bg-rose-600 text-white`} onClick={() => run(() => hrExpenseAccountingApi.cancel(integrationId, { ...meta(), reason }), "ยกเลิกรายการแล้ว")}>ยกเลิกรายการ</button>}</div></div>}
      {actions.has("pay") && <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-3"><label className="text-sm font-bold">วันที่จ่าย<input type="date" value={paidDate} onChange={event => setPaidDate(event.target.value)} className={inputClass} /></label><label className="text-sm font-bold">เลขอ้างอิง<input value={referenceNumber} onChange={event => setReferenceNumber(event.target.value)} className={inputClass} /></label><label className="text-sm font-bold">หลักฐานการจ่าย<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => setPaymentProof(event.target.files?.[0] || null)} className={`${inputClass} py-2`} /></label><button disabled={acting || stale || !paidDate} className={`${buttonClass} bg-emerald-600 text-white md:col-span-3`} onClick={async () => { const proof = paymentProof ? await fileAsBase64(paymentProof) : undefined; await run(() => hrExpenseAccountingApi.pay(integrationId, { ...meta(), paid_date: paidDate, reference_number: referenceNumber || undefined, proof_file_name: paymentProof?.name, proof_content_base64: proof }), "บันทึกจ่ายเงินใน HR แล้ว"); }}>บันทึกจ่ายเงิน</button></div>}
      {actions.has("settlement_review") && item.settlement && <div className="space-y-3 rounded-xl border p-4"><p className="font-bold">ยอดใช้จริง {formatCurrency(Number(item.settlement.actual_amount))} · ส่วนต่าง {formatCurrency(Number(item.settlement.balance_amount))}</p><textarea className={`${inputClass} min-h-20 py-3`} value={settlementNote} onChange={event => setSettlementNote(event.target.value)} placeholder="หมายเหตุบัญชี" /><div className="flex gap-2"><button disabled={acting || stale} className={`${buttonClass} bg-emerald-600 text-white`} onClick={() => run(() => hrExpenseAccountingApi.reviewSettlement(integrationId, item.settlement!.integration_id, { ...meta(), action: "approve", accounting_note: settlementNote || undefined }), "อนุมัติเคลียร์เงินแล้ว")}>อนุมัติ</button><button disabled={acting || stale} className={`${buttonClass} bg-amber-500 text-white`} onClick={() => run(() => hrExpenseAccountingApi.reviewSettlement(integrationId, item.settlement!.integration_id, { ...meta(), action: "return", accounting_note: settlementNote || undefined }), "ส่งข้อมูลเคลียร์เงินกลับแล้ว")}>ส่งกลับ</button></div></div>}
    </CardContent></Card>

    {Number(amounts.withholding || 0) > 0 && <Card><CardContent className="space-y-4 p-5"><h2 className="text-lg font-black">ใบรับรองหัก ณ ที่จ่าย</h2>{item.withholding_certificates?.map(certificate => <button key={certificate.integration_id} className={`${buttonClass} border bg-background`} onClick={() => hrExpenseAccountingApi.openWht(integrationId, certificate.integration_id)}><FileText className="mr-2 h-4 w-4" />{certificate.certificate_number}</button>)}{!item.withholding_certificates?.length && <div className="grid gap-3 md:grid-cols-5"><input className={inputClass} placeholder="เลขที่ใบรับรอง" value={wht.certificate_number} onChange={event => setWht(current => ({ ...current, certificate_number: event.target.value }))} /><input type="date" className={inputClass} value={wht.issued_date} onChange={event => setWht(current => ({ ...current, issued_date: event.target.value }))} /><input type="number" className={inputClass} placeholder="ฐานภาษี" value={wht.tax_base} onChange={event => setWht(current => ({ ...current, tax_base: event.target.value }))} /><input type="number" className={inputClass} placeholder="อัตรา %" value={wht.tax_rate} onChange={event => setWht(current => ({ ...current, tax_rate: event.target.value }))} /><input type="number" className={inputClass} placeholder="ยอดภาษี" value={wht.tax_amount} onChange={event => setWht(current => ({ ...current, tax_amount: event.target.value }))} /><button disabled={acting || stale || !wht.certificate_number || !wht.tax_base || !wht.tax_rate || !wht.tax_amount} className={`${buttonClass} bg-primary text-primary-foreground md:col-span-5`} onClick={() => run(() => hrExpenseAccountingApi.issueWht(integrationId, { ...meta(), certificate_number: wht.certificate_number, issued_date: wht.issued_date, tax_base: Number(wht.tax_base), tax_rate: Number(wht.tax_rate), tax_amount: Number(wht.tax_amount) }), "ออกใบรับรองหัก ณ ที่จ่ายแล้ว")}>ออกใบรับรอง</button></div>}</CardContent></Card>}

    {item.attachments && item.attachments.length > 0 && <Card><CardContent className="p-5"><h2 className="text-lg font-black">เอกสารแนบ</h2><div className="mt-3 flex flex-wrap gap-2">{item.attachments.map(attachment => <button key={attachment.integration_id} className={`${buttonClass} border bg-background`} onClick={() => hrExpenseAccountingApi.openAttachment(integrationId, attachment.integration_id)}><FileText className="mr-2 h-4 w-4" />{attachment.name}</button>)}</div></CardContent></Card>}

    {item.payments && item.payments.length > 0 && <Card><CardContent className="p-5"><h2 className="text-lg font-black">ประวัติการจ่าย</h2><div className="mt-3 space-y-3">{item.payments.map(payment => <div key={payment.integration_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="font-black">{formatCurrency(Number(payment.net_amount))}</p><p className="text-xs text-muted-foreground">{payment.paid_date || "-"} · {payment.reference_no || "ไม่มีเลขอ้างอิง"}{payment.voided_at ? " · ยกเลิกแล้ว" : ""}</p></div><div className="flex flex-wrap gap-2">{payment.proof?.available && <button className={`${buttonClass} border bg-background`} onClick={() => hrExpenseAccountingApi.openPaymentProof(integrationId, payment.integration_id)}>เปิดสลิป</button>}{!payment.voided_at && <label className={`${buttonClass} cursor-pointer border bg-background`}>เปลี่ยนสลิป<input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={acting || stale} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; const content = await fileAsBase64(file); await run(() => hrExpenseAccountingApi.replacePaymentProof(integrationId, payment.integration_id, { ...meta(), proof_file_name: file.name, proof_content_base64: content, reason: reason || undefined }), "เปลี่ยนหลักฐานการจ่ายแล้ว"); event.target.value = ""; }} /></label>}{!payment.voided_at && <button disabled={acting || stale || reason.trim().length < 3} className={`${buttonClass} bg-rose-600 text-white`} onClick={() => run(() => hrExpenseAccountingApi.voidPayment(integrationId, payment.integration_id, { ...meta(), reason }), "ยกเลิกการจ่ายแล้ว")}>ยกเลิกการจ่าย</button>}</div></div>)}</div></CardContent></Card>}

    {item.histories && item.histories.length > 0 && <Card><CardContent className="p-5"><h2 className="text-lg font-black">ประวัติจาก HR</h2><div className="mt-3 space-y-3">{item.histories.map(history => <div key={history.integration_event_id} className="rounded-xl border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-black">{history.action}</p><p className="text-xs text-muted-foreground">{history.occurred_at ? formatDate(history.occurred_at) : "-"}</p></div><p className="mt-1 text-sm text-muted-foreground">{history.from_status || "-"} → {history.to_status || "-"}{history.actor_employee_id ? ` · ${history.actor_employee_id}` : ""}{history.comments ? ` · ${history.comments}` : ""}</p></div>)}</div></CardContent></Card>}

    {acting && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"><div className="flex items-center gap-3 rounded-xl border bg-card px-6 py-4 font-black shadow-xl"><Loader2 className="h-5 w-5 animate-spin" />กำลังบันทึกที่ระบบ HR…</div></div>}
  </div>;
}
