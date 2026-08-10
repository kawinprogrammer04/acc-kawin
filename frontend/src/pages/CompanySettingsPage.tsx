import { useEffect, useState } from "react";
import { Building2, KeyRound, Loader2, Plug, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api, getApiErrorMessage } from "@/api/client";

interface CompanySettings {
  company_name: string;
  company_name_en?: string;
  tax_id?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_url?: string;
  fiscal_year_start_month: number;
  default_currency: string;
  vat_rate: number;
  crm_kawin_is_active: boolean;
  crm_kawin_base_url?: string;
  crm_kawin_orders_path?: string;
  crm_kawin_api_token?: string;
  crm_kawin_api_token_configured?: boolean;
  crm_kawin_external_company_id?: string;
}

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน",
  "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
  "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

export function CompanySettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<CompanySettings>({
    company_name: "",
    company_name_en: "",
    tax_id: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    logo_url: "",
    fiscal_year_start_month: 1,
    default_currency: "THB",
    vat_rate: 7,
    crm_kawin_is_active: false,
    crm_kawin_base_url: "",
    crm_kawin_orders_path: "/api/accounting/get_list_order.php",
    crm_kawin_api_token: "",
    crm_kawin_api_token_configured: false,
    crm_kawin_external_company_id: "",
  });

  useEffect(() => {
    api.get("/settings")
      .then(res => {
        if (res.data) {
          const d = res.data;
          setForm(f => ({
            ...f,
            ...d,
            fiscal_year_start_month: d.fiscal_year_start_month ? Number(d.fiscal_year_start_month) : f.fiscal_year_start_month,
            vat_rate: d.vat_rate ? Number(d.vat_rate) : f.vat_rate,
            crm_kawin_is_active: Boolean(d.crm_kawin_is_active),
            crm_kawin_base_url: d.crm_kawin_base_url ?? "",
            crm_kawin_orders_path: d.crm_kawin_orders_path || "/api/accounting/get_list_order.php",
            crm_kawin_api_token: "",
            crm_kawin_api_token_configured: Boolean(d.crm_kawin_api_token_configured),
            crm_kawin_external_company_id: d.crm_kawin_external_company_id ?? "",
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(key: keyof CompanySettings, val: string | number | boolean) {
    setForm(f => ({ ...f, [key]: val }));
    setSaved(false);
  }

  async function handleSave() {
    if (!form.company_name) { setError("กรุณากรอกชื่อบริษัท"); return; }
    setSaving(true); setError("");
    try {
      const res = await api.patch("/settings", form);
      const d = res.data;
      setForm(f => ({
        ...f,
        ...d,
        fiscal_year_start_month: d.fiscal_year_start_month ? Number(d.fiscal_year_start_month) : f.fiscal_year_start_month,
        vat_rate: d.vat_rate ? Number(d.vat_rate) : f.vat_rate,
        crm_kawin_api_token: "",
        crm_kawin_api_token_configured: Boolean(d.crm_kawin_api_token_configured),
      }));
      setSaved(true);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="ตั้งค่าบริษัท" subtitle="ข้อมูลบริษัทและการตั้งค่าทั่วไปของระบบ">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          บันทึก
        </button>
      </PageHeader>

      {saved && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-700">
          บันทึกข้อมูลเรียบร้อยแล้ว
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Company Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4" /> ข้อมูลบริษัท
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="ชื่อบริษัท (ภาษาไทย) *">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={form.company_name}
                onChange={e => update("company_name", e.target.value)}
                placeholder="บริษัท ..."
              />
            </Field>
            <Field label="ชื่อบริษัท (ภาษาอังกฤษ)">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={form.company_name_en ?? ""}
                onChange={e => update("company_name_en", e.target.value)}
                placeholder="Company Name Co., Ltd."
              />
            </Field>
            <Field label="เลขประจำตัวผู้เสียภาษี">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={form.tax_id ?? ""}
                onChange={e => update("tax_id", e.target.value)}
                placeholder="0000000000000"
              />
            </Field>
            <Field label="ที่อยู่">
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm"
                rows={3}
                value={form.address ?? ""}
                onChange={e => update("address", e.target.value)}
                placeholder="ที่อยู่บริษัท..."
              />
            </Field>
          </CardContent>
        </Card>

        {/* Contact & System */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">ติดต่อ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="โทรศัพท์">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.phone ?? ""}
                  onChange={e => update("phone", e.target.value)}
                  placeholder="02-xxx-xxxx"
                />
              </Field>
              <Field label="อีเมล">
                <input
                  type="email"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.email ?? ""}
                  onChange={e => update("email", e.target.value)}
                  placeholder="contact@company.com"
                />
              </Field>
              <Field label="เว็บไซต์">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.website ?? ""}
                  onChange={e => update("website", e.target.value)}
                  placeholder="https://www.company.com"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">การตั้งค่าบัญชี</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="รอบปีบัญชีเริ่มต้น">
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.fiscal_year_start_month}
                  onChange={e => update("fiscal_year_start_month", Number(e.target.value))}
                >
                  {MONTHS.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="สกุลเงินหลัก">
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.default_currency}
                  onChange={e => update("default_currency", e.target.value)}
                >
                  <option value="THB">THB — บาทไทย</option>
                  <option value="USD">USD — ดอลลาร์สหรัฐ</option>
                  <option value="EUR">EUR — ยูโร</option>
                </select>
              </Field>
              <Field label="อัตราภาษีมูลค่าเพิ่ม (%)">
                <input
                  type="number"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.vat_rate}
                  onChange={e => update("vat_rate", Number(e.target.value))}
                  min={0} max={100} step={0.1}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Plug className="h-4 w-4" /> เชื่อมต่อ CRM Kawin
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border"
                  checked={form.crm_kawin_is_active}
                  onChange={e => update("crm_kawin_is_active", e.target.checked)}
                />
                เปิดใช้การดึงออเดอร์จาก CRM ของบริษัทนี้
              </label>
              <Field label="CRM Base URL">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.crm_kawin_base_url ?? ""}
                  onChange={e => update("crm_kawin_base_url", e.target.value)}
                  placeholder="https://crm.kawinbrothers.com"
                />
              </Field>
              <Field label="Orders API Path">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.crm_kawin_orders_path ?? ""}
                  onChange={e => update("crm_kawin_orders_path", e.target.value)}
                  placeholder="/api/accounting/get_list_order.php"
                />
              </Field>
              <Field label="รหัสบริษัทใน CRM (comp_id)">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.crm_kawin_external_company_id ?? ""}
                  onChange={e => update("crm_kawin_external_company_id", e.target.value)}
                  placeholder="เช่น 1"
                />
              </Field>
              <Field label={form.crm_kawin_api_token_configured ? "API Token (ตั้งค่าแล้ว ใส่ใหม่เมื่อต้องการเปลี่ยน)" : "API Token"}>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="password"
                    className="w-full rounded-md border px-9 py-2 text-sm"
                    value={form.crm_kawin_api_token ?? ""}
                    onChange={e => update("crm_kawin_api_token", e.target.value)}
                    placeholder={form.crm_kawin_api_token_configured ? "เว้นว่างไว้เพื่อใช้ token เดิม" : "ใส่ token ที่ตรงกับ ACCOUNTING_API_TOKEN ฝั่ง CRM"}
                  />
                </div>
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
