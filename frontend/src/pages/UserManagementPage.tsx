import { useEffect, useState, useCallback } from "react";
import { Loader2, Users, Plus, Pencil, Check, X, ShieldCheck, ShieldOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api } from "@/api/client";

interface UserOut {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
}

const ROLES = ["admin", "approver", "accountant", "viewer"];

const ROLE_LABELS: Record<string, string> = {
  admin: "ผู้ดูแลระบบ",
  approver: "ผู้อนุมัติ",
  accountant: "นักบัญชี",
  viewer: "ผู้ดู",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700",
  approver: "bg-amber-100 text-amber-700",
  accountant: "bg-blue-100 text-blue-700",
  viewer: "bg-gray-100 text-gray-600",
};

const emptyForm = { username: "", email: "", password: "", full_name: "", role: "accountant" };

export function UserManagementPage() {
  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserOut | null>(null);
  const [form, setForm] = useState<{
    username: string; email: string; password: string; full_name: string; role: string;
  }>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/auth/users");
      setUsers(res.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  }

  function openEdit(u: UserOut) {
    setEditing(u);
    setForm({ username: u.username, email: u.email, password: "", full_name: u.full_name ?? "", role: u.role });
    setError("");
    setShowForm(true);
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
      } else {
        await api.post("/auth/users", form);
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.response?.data?.detail ?? "เกิดข้อผิดพลาด");
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
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> เพิ่มผู้ใช้
        </button>
      </PageHeader>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
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
                <label className="text-xs font-medium text-muted-foreground">บทบาท</label>
                <select
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                >
                  {ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]} ({r})</option>
                  ))}
                </select>
              </div>
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
                    {["ชื่อผู้ใช้", "ชื่อ-นามสกุล", "อีเมล", "บทบาท", "สถานะ", ""].map(h => (
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
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[u.role] || "bg-gray-100 text-gray-600"}`}>
                          {ROLE_LABELS[u.role] || u.role}
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
    </div>
  );
}
