import { useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Check, X, ShieldCheck, ShieldOff } from "lucide-react";
import { getApiErrorMessage } from "@/api/client";
import { rolesApi } from "@/api/roles";
import type { Role } from "@/api/roles";

const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm";

export function RoleManagerContent({ roles, onChanged }: { roles: Role[]; onChanged: () => void }) {
  const [newRole, setNewRole] = useState({ code: "", label: "", level: "1" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ label: "", level: "1" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function addRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRole.code.trim() || !newRole.label.trim()) { setError("กรุณากรอกรหัสและชื่อบทบาท"); return; }
    setSaving(true); setError("");
    try {
      await rolesApi.create({ code: newRole.code.trim(), label: newRole.label.trim(), level: Number(newRole.level) });
      setNewRole({ code: "", label: "", level: "1" });
      onChanged();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  }

  function startEdit(r: Role) {
    setEditingId(r.id);
    setEditDraft({ label: r.label, level: String(r.level) });
    setError("");
  }

  async function saveEdit(r: Role) {
    setSaving(true); setError("");
    try {
      await rolesApi.update(r.id, { label: editDraft.label.trim(), level: Number(editDraft.level) });
      setEditingId(null);
      onChanged();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally { setSaving(false); }
  }

  async function toggleActive(r: Role) {
    setError("");
    try {
      await rolesApi.update(r.id, { is_active: !r.is_active });
      onChanged();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    }
  }

  async function removeRole(r: Role) {
    if (!confirm(`ลบบทบาท "${r.label}" (${r.code})?`)) return;
    setError("");
    try {
      await rolesApi.delete(r.id);
      onChanged();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-y-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              {["รหัส", "ชื่อ", "ระดับ", "สถานะ", ""].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {[...roles].sort((a, b) => b.level - a.level).map(r => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs">
                  {r.code}
                  {r.is_system && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">system</span>}
                </td>
                {editingId === r.id ? (
                  <>
                    <td className="px-3 py-2">
                      <input className={inputCls} value={editDraft.label}
                        onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" className={inputCls + " w-16"} value={editDraft.level}
                        onChange={e => setEditDraft(d => ({ ...d, level: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.is_active ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => saveEdit(r)} disabled={saving} className="rounded p-1 hover:bg-muted text-emerald-600">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded p-1 hover:bg-muted text-muted-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2">{r.level}</td>
                    <td className="px-3 py-2">
                      {r.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> ใช้งาน</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400"><X className="h-3 w-3" /> ปิดใช้งาน</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(r)} className="rounded p-1 hover:bg-muted" title="แก้ไข">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={() => toggleActive(r)} className="rounded p-1 hover:bg-muted"
                          title={r.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                          disabled={r.is_system && r.is_active}
                        >
                          {r.is_active
                            ? <ShieldOff className="h-3.5 w-3.5 text-amber-500" />
                            : <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
                        </button>
                        {!r.is_system && (
                          <button onClick={() => removeRole(r)} className="rounded p-1 hover:bg-muted text-rose-500" title="ลบ">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addRole} className="flex items-end gap-2 rounded-lg border p-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">รหัส (code)</label>
          <input className={inputCls + " w-32"} value={newRole.code} placeholder="เช่น hr_manager"
            onChange={e => setNewRole(f => ({ ...f, code: e.target.value.trim() }))} />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1">ชื่อที่แสดง</label>
          <input className={inputCls} value={newRole.label} placeholder="เช่น ผู้จัดการ HR"
            onChange={e => setNewRole(f => ({ ...f, label: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">ระดับ</label>
          <input type="number" className={inputCls + " w-16"} value={newRole.level}
            onChange={e => setNewRole(f => ({ ...f, level: e.target.value }))} />
        </div>
        <button type="submit" disabled={saving}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} เพิ่มบทบาท
        </button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        "ระดับ" ใช้เทียบสิทธิ์สูง-ต่ำ (เช่น admin=4, viewer=1) — บทบาทที่ระดับสูงกว่าจะผ่านเงื่อนไข "อย่างน้อยต้องเป็น X" ของบทบาทที่ระดับต่ำกว่าโดยอัตโนมัติ
      </p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function RoleManagerModal({
  open, onClose, roles, onChanged,
}: {
  open: boolean; onClose: () => void; roles: Role[]; onChanged: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">จัดการบทบาท (Role)</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted text-muted-foreground">✕</button>
        </div>
        <RoleManagerContent roles={roles} onChanged={onChanged} />
      </div>
    </div>
  );
}
