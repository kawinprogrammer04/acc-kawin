import { useEffect, useState, useCallback, useMemo } from "react";
import { Building2, Loader2, Users, Plus, Pencil, Check, X, ShieldCheck, ShieldOff, Settings } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api, getApiErrorMessage } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import type { Department, Position, UserPositionRow } from "@/api/approvals";
import { rolesApi } from "@/api/roles";
import type { Role } from "@/api/roles";
import { RoleManagerModal } from "@/components/RoleManager";
import { UserPositionChecklist } from "@/components/UserPositionChecklist";
import { OrganizationStructureManager } from "@/components/OrganizationStructureManager";

interface UserOut {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
}

interface UserCompanyMembership {
  company_id: number;
  code: string;
  name_th: string;
  role: string;
  department_id?: number;
  department_name?: string;
  position_ids?: number[];
  position_names?: string[];
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700",
  approver: "bg-amber-100 text-amber-700",
  accountant: "bg-blue-100 text-blue-700",
  viewer: "bg-gray-100 text-gray-600",
};

const emptyForm = { username: "", email: "", password: "", full_name: "", role: "accountant", company_id: "", department_id: "" };

export function UserManagementPage() {
  const { companies, currentCompany } = useCompany();
  const currentCompanyId = currentCompany?.id;
  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserOut | null>(null);
  const [form, setForm] = useState<{
    username: string; email: string; password: string; full_name: string; role: string; company_id: string; department_id: string;
  }>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedPositionIds, setSelectedPositionIds] = useState<number[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [userCompanies, setUserCompanies] = useState<UserCompanyMembership[]>([]);
  const [companyRoleDraft, setCompanyRoleDraft] = useState("viewer");
  const [listPositionRows, setListPositionRows] = useState<UserPositionRow[]>([]);
  const [savingCompanyAccess, setSavingCompanyAccess] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [showRoleManager, setShowRoleManager] = useState(false);
  const [showOrganizationManager, setShowOrganizationManager] = useState(false);
  const [organizationRevision, setOrganizationRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/auth/users");
      setUsers(res.data);
      if (currentCompanyId) {
        try {
          const positionRes = await api.get("/user-positions", {
            headers: { "X-Company-Id": currentCompanyId },
          });
          setListPositionRows(positionRes.data);
        } catch {
          setListPositionRows([]);
        }
      } else {
        setListPositionRows([]);
      }
    } finally { setLoading(false); }
  }, [currentCompanyId]);

  const listPositionsByUser = useMemo(() => {
    const grouped = new Map<number, UserPositionRow[]>();
    for (const row of listPositionRows) {
      if (!row.is_active) continue;
      grouped.set(row.user_id, [...(grouped.get(row.user_id) ?? []), row]);
    }
    return grouped;
  }, [listPositionRows]);

  const loadRoles = useCallback(async () => {
    setRoles(await rolesApi.list());
  }, []);

  useEffect(() => { load(); loadRoles(); }, [load, loadRoles]);

  useEffect(() => {
    if (!form.company_id) {
      setPositions([]);
      setDepartments([]);
      setSelectedPositionIds([]);
      return;
    }
    let cancelled = false;
    setLoadingPositions(true);
    api.get("/positions", { headers: { "X-Company-Id": form.company_id } })
      .then(res => { if (!cancelled) setPositions(res.data); })
      .catch(() => { if (!cancelled) setPositions([]); })
      .finally(() => { if (!cancelled) setLoadingPositions(false); });
    api.get("/expense-settings/departments", { headers: { "X-Company-Id": form.company_id } })
      .then(res => { if (!cancelled) setDepartments(res.data.filter((row: Department) => row.is_active)); })
      .catch(() => { if (!cancelled) setDepartments([]); });

    if (editing) {
      api.get("/user-positions", { params: { user_id: editing.id }, headers: { "X-Company-Id": form.company_id } })
        .then(res => {
          if (!cancelled) {
            setSelectedPositionIds(res.data.filter((row: UserPositionRow) => row.is_active).map((row: UserPositionRow) => row.position_id));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSelectedPositionIds([]);
          }
        });
      const membership = userCompanies.find(c => c.company_id === Number(form.company_id));
      setCompanyRoleDraft(membership?.role ?? "viewer");
      setForm(current => ({
        ...current,
        department_id: membership?.department_id ? String(membership.department_id) : "",
      }));
    } else {
      setSelectedPositionIds([]);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.company_id, editing, organizationRevision]);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, company_id: currentCompany ? String(currentCompany.id) : "" });
    setSelectedPositionIds([]);
    setUserCompanies([]);
    setError("");
    setShowForm(true);
  }

  async function openEdit(u: UserOut) {
    setEditing(u);
    setForm({ username: u.username, email: u.email, password: "", full_name: u.full_name ?? "", role: u.role, company_id: "", department_id: "" });
    setSelectedPositionIds([]);
    setError("");
    setShowForm(true);
    try {
      const res = await api.get(`/auth/users/${u.id}/companies`);
      const memberships: UserCompanyMembership[] = res.data;
      setUserCompanies(memberships);
      const defaultCompanyId = memberships.some(m => m.company_id === currentCompany?.id)
        ? currentCompany!.id
        : memberships[0]?.company_id;
      setForm(f => ({ ...f, company_id: defaultCompanyId ? String(defaultCompanyId) : "" }));
    } catch {
      setUserCompanies([]);
    }
  }

  function togglePosition(id: number) {
    setSelectedPositionIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  async function saveCompanyAccess() {
    if (!editing || !form.company_id) return;
    setSavingCompanyAccess(true); setError("");
    try {
      await api.post(`/companies/${form.company_id}/users`, {
        user_id: editing.id,
        role: companyRoleDraft,
        department_id: form.department_id ? Number(form.department_id) : null,
        position_ids: selectedPositionIds,
      });
      const res = await api.get(`/auth/users/${editing.id}/companies`);
      setUserCompanies(res.data);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setSavingCompanyAccess(false);
    }
  }

  async function revokeCompanyAccess() {
    if (!editing || !form.company_id) return;
    if (!confirm("ยกเลิกสิทธิ์ผู้ใช้นี้ออกจากบริษัทนี้?")) return;
    setSavingCompanyAccess(true); setError("");
    try {
      await api.delete(`/companies/${form.company_id}/users/${editing.id}`);
      const res = await api.get(`/auth/users/${editing.id}/companies`);
      setUserCompanies(res.data);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setSavingCompanyAccess(false);
    }
  }

  async function handleSave() {
    if (!form.username || !form.email) { setError("กรุณากรอกข้อมูลให้ครบ"); return; }
    if (!editing && !form.password) { setError("กรุณากรอกรหัสผ่าน"); return; }
    setSaving(true); setError("");
    try {
      if (editing) {
        const payload: Record<string, string | undefined> = { full_name: form.full_name, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/auth/users/${editing.id}`, payload);
        if (form.company_id) {
          await api.post(`/companies/${form.company_id}/users`, {
            user_id: editing.id,
            role: companyRoleDraft,
            department_id: form.department_id ? Number(form.department_id) : null,
            position_ids: selectedPositionIds,
          });
        }
      } else {
        const { company_id, department_id, ...rest } = form;
        await api.post("/auth/users", {
          ...rest,
          company_id: company_id ? Number(company_id) : undefined,
          department_id: department_id ? Number(department_id) : undefined,
          position_ids: company_id ? selectedPositionIds : [],
        });
      }
      setShowForm(false);
      load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  }

  async function toggleActive(u: UserOut) {
    try {
      await api.patch(`/auth/users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch {}
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="จัดการผู้ใช้งาน" subtitle="เพิ่ม แก้ไข และกำหนดสิทธิ์ผู้ใช้งานในระบบ">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowOrganizationManager(true)}
            className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <Building2 className="h-4 w-4" /> จัดการแผนกและตำแหน่ง
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> เพิ่มผู้ใช้
          </button>
        </div>
      </PageHeader>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold mb-4">{editing ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้ใหม่"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">ชื่อผู้ใช้ (Username)</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-muted"
                  value={form.username}
                  disabled={!!editing}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="username"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">อีเมล</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-muted"
                  value={form.email}
                  disabled={!!editing}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ชื่อ-นามสกุล</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="ชื่อ-นามสกุล"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {editing ? "รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)" : "รหัสผ่าน"}
                </label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editing ? "(ไม่เปลี่ยน)" : "รหัสผ่าน"}
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">บทบาท</label>
                  <button type="button" onClick={() => setShowRoleManager(true)}
                    className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <Settings className="h-3 w-3" /> จัดการบทบาท
                  </button>
                </div>
                <select
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.role}
                  onChange={e => {
                    const nextRole = e.target.value;
                    setForm(f => ({ ...f, role: nextRole }));
                    // Keep the per-company role (the one that actually gates permissions,
                    // see user_companies.role) in sync with this selector — otherwise saving
                    // re-posts the old company role and the picked role never takes effect.
                    setCompanyRoleDraft(nextRole);
                  }}
                >
                  {roles.filter(r => r.is_active).map(r => (
                    <option key={r.code} value={r.code}>{r.label} ({r.code})</option>
                  ))}
                </select>
                {editing && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    บทบาทนี้จะถูกใช้เป็นสิทธิ์ในบริษัทด้านล่างด้วย — ปรับแยกได้ในช่อง "จัดการสิทธิ์ต่อบริษัท"
                  </p>
                )}
              </div>
              <div className="border-t pt-3">
                <label className="text-xs font-medium text-muted-foreground">
                  {editing ? "จัดการสิทธิ์ต่อบริษัท" : "บริษัท (จะได้สิทธิ์เข้าใช้งานทันที)"}
                </label>
                <select
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.company_id}
                  onChange={e => { setForm(f => ({ ...f, company_id: e.target.value, department_id: "" })); setSelectedPositionIds([]); }}
                >
                  {!editing && <option value="">-- ไม่กำหนด (เพิ่มสิทธิ์ทีหลังที่หน้า "บริษัท") --</option>}
                  {editing && companies.filter(c => !userCompanies.some(m => m.company_id === c.id)).length > 0 && (
                    <option value="">-- เลือกบริษัท --</option>
                  )}
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name_th}{userCompanies.some(m => m.company_id === c.id) ? " (เป็นสมาชิกอยู่แล้ว)" : ""}
                    </option>
                  ))}
                </select>
                {!editing && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    ตั้งค่าเริ่มต้นเป็นบริษัทที่คุณกำลังใช้งานอยู่ ({currentCompany?.name_th ?? "-"}) เปลี่ยนเองได้
                  </p>
                )}
              </div>

              {form.company_id && (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">แผนกของพนักงาน</label>
                    <button type="button" onClick={() => setShowOrganizationManager(true)} className="text-[11px] text-primary hover:underline">
                      จัดการแผนก
                    </button>
                  </div>
                  <select
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={form.department_id}
                    onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                  >
                    <option value="">-- ไม่มีแผนก (เช่น ผู้บริหาร) --</option>
                    {departments.map(department => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">ไม่บังคับสำหรับผู้บริหารหรือพนักงานระดับบริษัท ระบบเบิกจะบันทึกแผนกเป็น snapshot เมื่อมีการกำหนด</p>
                </div>
              )}

              {editing && form.company_id && (
                <div className="rounded-md bg-muted/30 p-3 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    บทบาทในบริษัทนี้ (ใช้กำหนดสิทธิ์การใช้งานจริง)
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 rounded-md border px-3 py-1.5 text-sm"
                      value={companyRoleDraft}
                      onChange={e => setCompanyRoleDraft(e.target.value)}
                    >
                      {roles.filter(r => r.is_active).map(r => (
                        <option key={r.code} value={r.code}>{r.label} ({r.code})</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setShowRoleManager(true)}
                      className="rounded-md border p-1.5 hover:bg-accent" title="จัดการบทบาท">
                      <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={saveCompanyAccess}
                      disabled={savingCompanyAccess}
                      className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingCompanyAccess && <Loader2 className="h-3 w-3 animate-spin" />}
                      {userCompanies.some(m => m.company_id === Number(form.company_id)) ? "บันทึกสิทธิ์และแผนก" : "เพิ่มสิทธิ์และแผนก"}
                    </button>
                  </div>
                  {userCompanies.some(m => m.company_id === Number(form.company_id)) && (
                    <button
                      type="button"
                      onClick={revokeCompanyAccess}
                      disabled={savingCompanyAccess}
                      className="text-xs text-rose-600 hover:underline disabled:opacity-50"
                    >
                      ลบสิทธิ์ออกจากบริษัทนี้
                    </button>
                  )}
                </div>
              )}

              {form.company_id && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    ตำแหน่ง (เลือกได้หลายตำแหน่ง)
                  </label>
                  <div className="mt-1">
                    <UserPositionChecklist
                      positions={positions}
                      loading={loadingPositions}
                      selectedIds={selectedPositionIds}
                      onToggle={p => togglePosition(p.id)}
                    />
                    {editing && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        เลือกได้มากกว่า 1 ตำแหน่ง การเปลี่ยนแปลงจะมีผลเมื่อกด “บันทึก”
                      </p>
                    )}
                  </div>
                </div>
              )}
              {error && <p className="text-xs text-rose-600">{error}</p>}
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mb-2" />
              <p>ยังไม่มีผู้ใช้งาน</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["ชื่อผู้ใช้", "ชื่อ-นามสกุล", "อีเมล", "ตำแหน่ง", "บทบาท", "สถานะ", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{u.username}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{u.full_name || "-"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{u.email}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {(listPositionsByUser.get(u.id)?.length ?? 0) > 0 ? (
                            listPositionsByUser.get(u.id)!
                              .map(row => (
                                <span key={row.id} className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                                  {row.position_name || `ตำแหน่ง #${row.position_id}`}
                                </span>
                              ))
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[u.role] || "bg-gray-100 text-gray-600"}`}>
                          {roles.find(r => r.code === u.role)?.label || u.role}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <Check className="h-3 w-3" /> ใช้งาน
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <X className="h-3 w-3" /> ระงับ
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(u)}
                            className="rounded p-1.5 hover:bg-muted"
                            title="แก้ไข"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => toggleActive(u)}
                            className="rounded p-1.5 hover:bg-muted"
                            title={u.is_active ? "ระงับ" : "เปิดใช้งาน"}
                          >
                            {u.is_active
                              ? <ShieldOff className="h-3.5 w-3.5 text-amber-500" />
                              : <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <RoleManagerModal
        open={showRoleManager}
        onClose={() => setShowRoleManager(false)}
        roles={roles}
        onChanged={loadRoles}
      />
      <OrganizationStructureManager
        open={showOrganizationManager}
        onClose={() => setShowOrganizationManager(false)}
        companies={companies}
        initialCompanyId={form.company_id ? Number(form.company_id) : currentCompany?.id}
        onChanged={() => setOrganizationRevision((revision) => revision + 1)}
      />
    </div>
  );
}
