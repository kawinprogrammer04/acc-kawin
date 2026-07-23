import { useEffect, useState, useCallback } from "react";
import { Loader2, Building2, Plus, Pencil, Users, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api } from "@/api/client";

interface Company {
  id: number;
  code: string;
  name_th: string;
  name_en?: string;
  tax_id?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  fiscal_year_start_month: number;
  default_currency: string;
  vat_rate: number;
  is_active: boolean;
}

interface CompanyUser {
  user_id: number;
  username: string;
  full_name?: string;
  role: string;
}

const emptyForm = {
  code: "", name_th: "", name_en: "", tax_id: "", address: "",
  phone: "", email: "", website: "", fiscal_year_start_month: 1,
  default_currency: "THB", vat_rate: 7,
};

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [companyUsers, setCompanyUsers] = useState<Record<number, CompanyUser[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/companies");
      setCompanies(res.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadUsers(companyId: number) {
    if (companyUsers[companyId]) return;
    try {
      const res = await api.get(`/companies/${companyId}/users`);
      setCompanyUsers(u => ({ ...u, [companyId]: res.data }));
    } catch {}
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEdit(c: Company) {
    setEditing(c);
    setForm({
      code: c.code, name_th: c.name_th, name_en: c.name_en ?? "",
      tax_id: c.tax_id ?? "", address: c.address ?? "",
      phone: c.phone ?? "", email: c.email ?? "", website: c.website ?? "",
      fiscal_year_start_month: c.fiscal_year_start_month,
      default_currency: c.default_currency, vat_rate: Number(c.vat_rate),
    });
    setError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.code || !form.name_th) { setError("กรุณากรอก Code และชื่อบริษัท"); return; }
    setSaving(true); setError("");
    try {
      if (editing) {
        await api.patch(`/companies/${editing.id}`, form);
      } else {
        await api.post("/companies", form);
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "เกิดข้อผิดพลาด");
    } finally { setSaving(false); }
  }

  function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      loadUsers(id);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="บริษัท" subtitle="จัดการบริษัทและสิทธิ์ผู้ใช้งานต่อบริษัท">
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> เพิ่มบริษัท
        </button>
      </PageHeader>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-semibold mb-4">{editing ? "แก้ไขบริษัท" : "เพิ่มบริษัท"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Code *</label>
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-muted"
                    value={form.code}
                    disabled={!!editing}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="COMPANY_CODE"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">สกุลเงิน</label>
                  <select
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={form.default_currency}
                    onChange={e => setForm(f => ({ ...f, default_currency: e.target.value }))}
                  >
                    <option value="THB">THB</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ชื่อบริษัท (ไทย) *</label>
                <input className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={form.name_th}
                  onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} placeholder="บริษัท ..." />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ชื่อบริษัท (อังกฤษ)</label>
                <input className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={form.name_en}
                  onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} placeholder="Company Name Co., Ltd." />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">เลขนิติบุคคล</label>
                <input className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={form.tax_id}
                  onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="0000000000000" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ที่อยู่</label>
                <textarea className="mt-1 w-full rounded-md border px-3 py-2 text-sm" rows={2} value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">โทรศัพท์</label>
                  <input className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">VAT (%)</label>
                  <input type="number" className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={form.vat_rate}
                    onChange={e => setForm(f => ({ ...f, vat_rate: Number(e.target.value) }))} min={0} max={100} />
                </div>
              </div>
              {error && <p className="text-xs text-rose-600">{error}</p>}
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          companies.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{c.name_th}</p>
                      {c.name_en && <p className="text-xs text-muted-foreground">{c.name_en}</p>}
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {c.tax_id && <span>เลขนิติบุคคล: {c.tax_id}</span>}
                        {c.phone && <span>โทร: {c.phone}</span>}
                        <span className="font-mono bg-muted px-1 rounded">{c.code}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(c)} className="rounded p-1.5 hover:bg-muted" title="แก้ไข">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => toggleExpand(c.id)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted text-muted-foreground"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {expandedId === c.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {expandedId === c.id && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">ผู้ใช้ที่มีสิทธิ์</p>
                    {companyUsers[c.id] ? (
                      <div className="flex flex-wrap gap-2">
                        {companyUsers[c.id].map(u => (
                          <span key={u.user_id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                            {u.full_name || u.username}
                            <span className="text-muted-foreground">({u.role})</span>
                          </span>
                        ))}
                        {companyUsers[c.id].length === 0 && (
                          <p className="text-xs text-muted-foreground">ยังไม่มีผู้ใช้ (Admin มีสิทธิ์อัตโนมัติ)</p>
                        )}
                      </div>
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
