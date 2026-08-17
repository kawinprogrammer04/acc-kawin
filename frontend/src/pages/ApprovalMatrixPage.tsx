import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Trash2, ArrowUp, ArrowDown, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { api, getApiErrorMessage } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import {
  positionsApi, expenseTypesApi, policyVersionsApi, rulesApi,
  primaryApproversApi, delegationsApi, userPositionsApi, expenseSettingsApi,
} from "@/api/approvals";
import type {
  Position, ExpenseType, PolicyVersion, Rule, PrimaryApprover, Delegation, UserPositionRow, Department,
} from "@/api/approvals";
import { formatCurrency, formatDate } from "@/lib/format";
import { UserPositionChecklist } from "@/components/UserPositionChecklist";

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

interface CompanyUser { user_id: number; username: string; full_name: string | null; role: string }

// ── Assign users to positions ────────────────────────────────────────────────
function UserPositionsTab({
  positions, users, userPositions, onChanged,
}: {
  positions: Position[]; users: CompanyUser[]; userPositions: UserPositionRow[]; onChanged: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(users[0]?.user_id ?? null);
  const [togglingPositionId, setTogglingPositionId] = useState<number | null>(null);

  const selectedUserPositions = userPositions.filter(up => up.user_id === selectedUserId);

  const toggle = async (position: Position) => {
    if (!selectedUserId) return;
    setTogglingPositionId(position.id);
    try {
      const existingRow = selectedUserPositions.find(r => r.position_id === position.id);
      if (existingRow) {
        await userPositionsApi.delete(existingRow.id);
      } else {
        await userPositionsApi.create({ user_id: selectedUserId, position_id: position.id });
      }
      onChanged();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "แก้ไขตำแหน่งไม่สำเร็จ"));
    } finally {
      setTogglingPositionId(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        กำหนดว่าพนักงานแต่ละคนอยู่ตำแหน่งไหนในสายอนุมัติ (พนักงาน 1 คนมีได้หลายตำแหน่ง) — ใช้ตอนสร้างคำขอเบิกเงินเพื่อเลือก "ตำแหน่งของฉัน"
        (จุดนี้เป็นจุดเดียวกับที่แก้ไขได้ในหน้า "จัดการผู้ใช้งาน" ด้วย)
      </p>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-lg border">
          <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">พนักงาน</div>
          <div className="max-h-96 space-y-1 overflow-y-auto p-2">
            {users.map(u => (
              <button
                key={u.user_id}
                onClick={() => setSelectedUserId(u.user_id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedUserId === u.user_id ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted"}`}
              >
                {u.full_name || u.username}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            ตำแหน่งของ {users.find(u => u.user_id === selectedUserId)?.full_name || "-"}
          </p>
          <UserPositionChecklist
            positions={positions}
            selectedIds={selectedUserPositions.map(up => up.position_id)}
            togglingId={togglingPositionId}
            immediate
            onToggle={toggle}
          />
        </div>
      </div>
    </div>
  );
}

// ── Positions & primary approvers ────────────────────────────────────────────
function PositionsTab({
  positions, users, primaryApprovers, onChanged,
}: {
  positions: Position[]; users: CompanyUser[]; primaryApprovers: PrimaryApprover[]; onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const approverByPosition = new Map(primaryApprovers.map(p => [p.position_id, p]));

  const addPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await positionsApi.create({ name });
      setName("");
      onChanged();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "เพิ่มตำแหน่งไม่สำเร็จ"));
    } finally { setSaving(false); }
  };

  const setApprover = async (positionId: number, userId: string) => {
    if (!userId) return;
    try {
      await primaryApproversApi.set({ position_id: positionId, user_id: Number(userId) });
      onChanged();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "ตั้งผู้อนุมัติไม่สำเร็จ"));
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={addPosition} className="flex items-end gap-2">
        <div className="flex-1">
          <label className={labelCls}>เพิ่มตำแหน่งใหม่</label>
          <input className={inputCls} required value={name} onChange={e => setName(e.target.value)} placeholder="เช่น Marketing Manager" />
        </div>
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} เพิ่ม
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              {["ตำแหน่ง", "ผู้อนุมัติหลัก"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {positions.map(p => {
              const current = approverByPosition.get(p.id);
              return (
                <tr key={p.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <select className={inputCls} value={current?.user_id ?? ""} onChange={e => setApprover(p.id, e.target.value)}>
                      <option value="">-- ยังไม่ได้กำหนด --</option>
                      {users.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.username}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {positions.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีตำแหน่ง</p>}
      </div>
    </div>
  );
}

// ── Expense types ─────────────────────────────────────────────────────────
function ExpenseTypesTab({ types, onChanged }: { types: ExpenseType[]; onChanged: () => void }) {
  const [form, setForm] = useState({ code: "", name: "" });
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await expenseTypesApi.create(form);
      setForm({ code: "", name: "" });
      onChanged();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "เพิ่มประเภทไม่สำเร็จ"));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex items-end gap-2">
        <div>
          <label className={labelCls}>รหัส</label>
          <input className={inputCls} required value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น travel" />
        </div>
        <div className="flex-1">
          <label className={labelCls}>ชื่อประเภทการเบิก</label>
          <input className={inputCls} required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="เช่น ค่าเดินทาง" />
        </div>
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} เพิ่ม
        </button>
      </form>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>{["รหัส", "ชื่อ"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {types.map(t => (
              <tr key={t.id} className="hover:bg-muted/20">
                <td className="px-4 py-3 font-mono text-xs">{t.code}</td>
                <td className="px-4 py-3">{t.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {types.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีประเภทการเบิก</p>}
      </div>
    </div>
  );
}

// ── Rules editor ──────────────────────────────────────────────────────────
function RuleForm({ positions, types, departments, versionId, onCreated }: {
  positions: Position[]; types: ExpenseType[]; departments: Department[]; versionId: number; onCreated: () => void;
}) {
  const [requesterMode, setRequesterMode] = useState<"position" | "department">("position");
  const [requesterId, setRequesterId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set());
  const [typeId, setTypeId] = useState("");
  const [amountMin, setAmountMin] = useState("0");
  const [amountMax, setAmountMax] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);

  const deptMembers = deptId ? positions.filter(p => p.department_id === Number(deptId)) : [];

  const pickDept = (id: string) => {
    setDeptId(id);
    const members = id ? positions.filter(p => p.department_id === Number(id)) : [];
    setSelectedMemberIds(new Set(members.map(p => p.id))); // ค่าเริ่มต้น: เลือกทุกตำแหน่งในแผนก
  };
  const toggleMember = (id: number) => setSelectedMemberIds(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addStep = () => setSteps(s => [...s, ""]);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) => setSteps(s => {
    const next = [...s];
    const j = i + dir;
    if (j < 0 || j >= next.length) return s;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const setStep = (i: number, value: string) => setSteps(s => s.map((v, idx) => idx === i ? value : v));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const stepIds = steps.filter(Boolean).map(Number);
    if (stepIds.length === 0) { alert("ต้องมีอย่างน้อย 1 ขั้นตอนผู้อนุมัติ"); return; }

    const targetPositionIds = requesterMode === "position"
      ? [Number(requesterId)]
      : [...selectedMemberIds];
    if (requesterMode === "department" && targetPositionIds.length === 0) {
      alert("เลือกอย่างน้อย 1 ตำแหน่งในแผนก"); return;
    }

    setSaving(true);
    try {
      const payload = {
        expense_type_id: Number(typeId),
        amount_min: Number(amountMin),
        amount_max: amountMax ? Number(amountMax) : null,
        steps: stepIds.map((id, idx) => ({ step_no: idx + 1, approver_position_id: id })),
      };
      const results = await Promise.allSettled(
        targetPositionIds.map(pid => rulesApi.create(versionId, { ...payload, requester_position_id: pid }))
      );
      const failed = results
        .map((r, i) => ({ r, pid: targetPositionIds[i] }))
        .filter((x): x is { r: PromiseRejectedResult; pid: number } => x.r.status === "rejected");
      if (failed.length > 0) {
        const positionName = (pid: number) => positions.find(p => p.id === pid)?.name ?? String(pid);
        alert(
          `สร้างสำเร็จ ${targetPositionIds.length - failed.length}/${targetPositionIds.length} ตำแหน่ง\n` +
          failed.map(f => `- ${positionName(f.pid)}: ${getApiErrorMessage(f.r.reason, "ไม่ทราบสาเหตุ")}`).join("\n")
        );
      }
      setRequesterId(""); setDeptId(""); setSelectedMemberIds(new Set());
      setTypeId(""); setAmountMin("0"); setAmountMax(""); setSteps([""]);
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <div>
        <label className={labelCls}>ผู้เบิก *</label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={requesterMode === "position"} onChange={() => setRequesterMode("position")} /> ตำแหน่งเดียว
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={requesterMode === "department"} onChange={() => setRequesterMode("department")} /> ทั้งแผนก (เลือกได้หลายตำแหน่ง)
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {requesterMode === "position" ? (
          <div>
            <label className={labelCls}>ตำแหน่งผู้เบิก *</label>
            <select className={inputCls} required value={requesterId} onChange={e => setRequesterId(e.target.value)}>
              <option value="">-- เลือก --</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelCls}>แผนกผู้เบิก *</label>
            <select className={inputCls} required value={deptId} onChange={e => pickDept(e.target.value)}>
              <option value="">-- เลือก --</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls}>ประเภทการเบิก *</label>
          <select className={inputCls} required value={typeId} onChange={e => setTypeId(e.target.value)}>
            <option value="">-- เลือก --</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {requesterMode === "department" && deptId && (
        <div className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className={labelCls + " mb-0"}>ตำแหน่งในแผนกนี้ (ติ๊กออกได้ถ้าไม่ต้องการรวมบางตำแหน่ง)</span>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setSelectedMemberIds(new Set(deptMembers.map(p => p.id)))}>เลือกทั้งหมด</button>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setSelectedMemberIds(new Set())}>ไม่เลือกเลย</button>
            </div>
          </div>
          {deptMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">แผนกนี้ยังไม่มีตำแหน่งอยู่เลย</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {deptMembers.map(p => (
                <label key={p.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
                  <input type="checkbox" checked={selectedMemberIds.has(p.id)} onChange={() => toggleMember(p.id)} /> {p.name}
                </label>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            ถ้าเลือกครบทุกตำแหน่งในแผนก จะแสดงรวมเป็นแถวเดียว เช่น "แผนก {departments.find(d => String(d.id) === deptId)?.name} (ทุกตำแหน่ง — ...)"
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>ยอดเงินต่ำสุด (บาท) *</label>
          <input type="number" className={inputCls} required min="0" step="0.01" value={amountMin} onChange={e => setAmountMin(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>ยอดเงินสูงสุด (บาท, เว้นว่าง = ไม่จำกัด)</label>
          <input type="number" className={inputCls} min="0" step="0.01" value={amountMax} onChange={e => setAmountMax(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelCls}>ขั้นตอนผู้อนุมัติ (เรียงตามลำดับ) *</label>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
              <select className={inputCls} required value={s} onChange={e => setStep(i, e.target.value)}>
                <option value="">-- เลือกตำแหน่งผู้อนุมัติ --</option>
                {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-1.5 rounded-md border hover:bg-accent disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="p-1.5 rounded-md border hover:bg-accent disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => removeStep(i)} disabled={steps.length === 1} className="p-1.5 rounded-md border hover:bg-accent disabled:opacity-30 text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addStep} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
          <Plus className="h-3 w-3" /> เพิ่มขั้นตอน (ไม่จำกัดจำนวน)
        </button>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} เพิ่มกฎนี้
        </button>
      </div>
    </form>
  );
}

// จัดกลุ่ม rule ที่มีเงื่อนไข (ประเภท/ช่วงยอดเงิน/ขั้นตอนอนุมัติ) เหมือนกันทุกอย่าง
// และตำแหน่งผู้เบิกครอบคลุม "ทุกตำแหน่งในแผนกเดียวกัน" พอดี ให้แสดงเป็นแถวเดียวระดับแผนก
// แทนที่จะแสดงแยกทีละตำแหน่ง (เช่น สายอนุมัติของแผนก CRM/IT ที่ผูกไว้ทุกตำแหน่งในแผนก)
type DisplayRow =
  | { kind: "department"; key: string; department: Department; memberNames: string[]; rule: Rule }
  | { kind: "rule"; key: string; rule: Rule };

function groupRulesByDepartment(rules: Rule[], positions: Position[], departments: Department[]): DisplayRow[] {
  const positionById = new Map(positions.map(p => [p.id, p]));
  const memberIdsByDept = new Map<number, number[]>();
  for (const p of positions) {
    if (p.department_id == null) continue;
    const list = memberIdsByDept.get(p.department_id) ?? [];
    list.push(p.id);
    memberIdsByDept.set(p.department_id, list);
  }

  const signature = (r: Rule) =>
    `${r.expense_type_id}|${r.amount_min}|${r.amount_max ?? ""}|${r.steps.map(s => s.approver_position_id).join(",")}`;

  // จับกลุ่ม "ทีละแผนก" (ไม่ใช่จับกลุ่มด้วย signature รวมทุกแผนกพร้อมกัน) เพราะสอง
  // แผนกที่ต่างกันอาจบังเอิญมีเนื้อหา rule เหมือนกันเป๊ะ (เช่น CRM กับ IT ที่ต่างก็ใช้
  // COO เป็นผู้อนุมัติขั้นตอนเดียวในช่วงยอดเดียวกัน) ถ้าจับกลุ่มด้วย signature อย่างเดียว
  // ก่อน จะรวมกันเป็นกลุ่มผสมข้ามแผนกที่ไม่ตรงกับสมาชิกของแผนกไหนเป๊ะสักแผนก แล้ว
  // "หลุด" กลับไปแสดงแยกทีละตำแหน่งทั้งหมดโดยไม่มีการ error ให้เห็น
  const consumed = new Set<number>();
  const rows: DisplayRow[] = [];

  for (const dept of departments) {
    const memberIds = memberIdsByDept.get(dept.id);
    if (!memberIds || memberIds.length < 2) continue; // แผนกที่มีตำแหน่งเดียวไม่คุ้มจะรวมแถว
    const memberIdSet = new Set(memberIds);

    const bySig = new Map<string, Rule[]>();
    for (const r of rules) {
      if (!memberIdSet.has(r.requester_position_id)) continue;
      const sig = signature(r);
      const list = bySig.get(sig) ?? [];
      list.push(r);
      bySig.set(sig, list);
    }
    for (const [sig, group] of bySig) {
      const requesterIds = new Set(group.map(r => r.requester_position_id));
      if (requesterIds.size === memberIds.length && memberIds.every(id => requesterIds.has(id))) {
        rows.push({
          kind: "department",
          key: `dept-${dept.id}-${sig}`,
          department: dept,
          memberNames: group.map(r => positionById.get(r.requester_position_id)?.name ?? r.requester_position_name ?? "-"),
          rule: group[0],
        });
        for (const r of group) consumed.add(r.id);
      }
    }
  }

  for (const r of rules) {
    if (consumed.has(r.id)) continue;
    rows.push({ kind: "rule", key: `rule-${r.id}`, rule: r });
  }
  return rows;
}

function RulesTab({ positions, types, departments }: { positions: Position[]; types: ExpenseType[]; departments: Department[] }) {
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const displayRows = useMemo(() => groupRulesByDepartment(rules, positions, departments), [rules, positions, departments]);

  const loadVersions = useCallback(async () => {
    const v = await policyVersionsApi.list();
    setVersions(v);
    if (v.length && versionId === null) setVersionId(v[0].id);
  }, [versionId]);

  const loadRules = useCallback(async (vid: number) => {
    setLoading(true);
    try { setRules(await rulesApi.list(vid)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadVersions(); }, [loadVersions]);
  useEffect(() => { if (versionId) loadRules(versionId); }, [versionId, loadRules]);

  const createVersion = async () => {
    const v = await policyVersionsApi.create({ notes: "สร้างใหม่จากหน้าเว็บ" });
    await loadVersions();
    setVersionId(v.id);
  };

  const activate = async () => {
    if (!versionId) return;
    if (!confirm("ยืนยันเปิดใช้งานเวอร์ชันนี้? เวอร์ชันที่ใช้งานอยู่เดิมจะถูกปิด")) return;
    try {
      await policyVersionsApi.activate(versionId);
      await loadVersions();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "เปิดใช้งานไม่สำเร็จ"));
    }
  };

  const currentVersion = versions.find(v => v.id === versionId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select className={inputCls + " max-w-xs"} value={versionId ?? ""} onChange={e => setVersionId(Number(e.target.value))}>
          {versions.map(v => (
            <option key={v.id} value={v.id}>เวอร์ชัน {v.version_no} ({v.status === "active" ? "ใช้งานอยู่" : v.status === "draft" ? "ร่าง" : "ปิดใช้งาน"})</option>
          ))}
        </select>
        <button onClick={createVersion} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          <Plus className="h-3.5 w-3.5" /> สร้างเวอร์ชันใหม่
        </button>
        {currentVersion && currentVersion.status === "draft" && (
          <button onClick={activate} className="flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> เปิดใช้งาน (Activate)
          </button>
        )}
        {currentVersion && currentVersion.status === "active" && (
          <span className="text-xs text-emerald-700 bg-emerald-100 rounded-full px-2.5 py-1">กำลังใช้งาน</span>
        )}
      </div>

      {!versions.length && (
        <p className="text-sm text-muted-foreground">ยังไม่มีเวอร์ชันสายอนุมัติ กด "สร้างเวอร์ชันใหม่" เพื่อเริ่มต้น</p>
      )}

      {versionId && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  {["ตำแหน่งผู้เบิก", "ประเภท", "ช่วงยอดเงิน", "ขั้นตอนผู้อนุมัติ"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={4} className="p-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" /></td></tr>
                ) : displayRows.map(row => {
                  const r = row.rule;
                  return (
                    <tr key={row.key} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        {row.kind === "department" ? (
                          <span title={row.memberNames.join(", ")}>
                            แผนก {row.department.name} <span className="font-normal text-xs text-muted-foreground">(ทุกตำแหน่ง — {row.memberNames.join(", ")})</span>
                          </span>
                        ) : (
                          r.requester_position_name
                        )}
                      </td>
                      <td className="px-4 py-3">{r.expense_type_name}</td>
                      <td className="px-4 py-3">{formatCurrency(r.amount_min)} – {r.amount_max != null ? formatCurrency(r.amount_max) : "ไม่จำกัด"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.steps.map((s, i) => (
                            <span key={s.step_no} className="rounded-full bg-muted px-2 py-0.5 text-xs">{i + 1}. {s.approver_position_name}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && rules.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีกฎในเวอร์ชันนี้</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 text-sm text-primary hover:underline">
              <Plus className="h-4 w-4" /> เพิ่มกฎใหม่ในเวอร์ชันนี้
            </button>
          ) : (
            <RuleForm positions={positions} types={types} departments={departments} versionId={versionId} onCreated={() => { setShowForm(false); loadRules(versionId); }} />
          )}
        </>
      )}
    </div>
  );
}

// ── Delegations ───────────────────────────────────────────────────────────
function DelegationsTab({ positions, users, delegations, onChanged }: {
  positions: Position[]; users: CompanyUser[]; delegations: Delegation[]; onChanged: () => void;
}) {
  const [form, setForm] = useState({ position_id: "", delegate_user_id: "", starts_at: "", ends_at: "", reason: "" });
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await delegationsApi.create({
        position_id: Number(form.position_id),
        delegate_user_id: Number(form.delegate_user_id),
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        reason: form.reason || undefined,
      });
      setForm({ position_id: "", delegate_user_id: "", starts_at: "", ends_at: "", reason: "" });
      onChanged();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "เพิ่มผู้แทนไม่สำเร็จ"));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-3 rounded-lg border p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>ตำแหน่งที่จะมอบหมาย *</label>
            <select className={inputCls} required value={form.position_id} onChange={e => setForm(f => ({ ...f, position_id: e.target.value }))}>
              <option value="">-- เลือก --</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ผู้รับมอบหมาย (ผู้แทน) *</label>
            <select className={inputCls} required value={form.delegate_user_id} onChange={e => setForm(f => ({ ...f, delegate_user_id: e.target.value }))}>
              <option value="">-- เลือก --</option>
              {users.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.username}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>เริ่ม *</label>
            <input type="datetime-local" className={inputCls} required value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>สิ้นสุด *</label>
            <input type="datetime-local" className={inputCls} required value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className={labelCls}>เหตุผล</label>
          <input className={inputCls} value={form.reason} placeholder="เช่น ลาพักร้อน" onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} เพิ่มผู้แทน
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>{["ตำแหน่ง", "ผู้แทน", "ช่วงเวลา", "เหตุผล"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {delegations.map(d => (
              <tr key={d.id} className="hover:bg-muted/20">
                <td className="px-4 py-3 font-medium">{d.position_name}</td>
                <td className="px-4 py-3">{d.delegate_full_name}</td>
                <td className="px-4 py-3 text-xs">{formatDate(d.starts_at)} – {formatDate(d.ends_at)}</td>
                <td className="px-4 py-3 text-muted-foreground">{d.reason || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {delegations.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีการมอบหมายงาน</p>}
      </div>
    </div>
  );
}

export function ApprovalMatrixPage() {
  const { currentCompany } = useCompany();
  const [positions, setPositions] = useState<Position[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentCompany) return;
    setLoading(true);
    try {
      const [pos, t, deps, dele, companyUsers] = await Promise.all([
        positionsApi.list(),
        expenseTypesApi.list(),
        expenseSettingsApi.departments(),
        delegationsApi.list(),
        api.get(`/companies/${currentCompany.id}/users`).then(r => r.data),
      ]);
      setPositions(pos); setTypes(t); setDepartments(deps); setDelegations(dele); setUsers(companyUsers);
    } finally { setLoading(false); }
  }, [currentCompany]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="สายอนุมัติ" subtitle="จัดการประเภท กฎการอนุมัติ และผู้รับมอบหมาย โดยข้อมูลพนักงานและแผนกจัดการที่หน้าผู้ใช้งาน" />

      <Card>
        <CardContent className="p-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <Tabs defaultValue="rules">
              <TabsList>
                <TabsTrigger value="types">ประเภทการเบิก</TabsTrigger>
                <TabsTrigger value="rules">กฎการอนุมัติ</TabsTrigger>
                <TabsTrigger value="delegations">ผู้รับมอบหมาย</TabsTrigger>
              </TabsList>
              <TabsContent value="types">
                <ExpenseTypesTab types={types} onChanged={load} />
              </TabsContent>
              <TabsContent value="rules">
                <RulesTab positions={positions} types={types} departments={departments} />
              </TabsContent>
              <TabsContent value="delegations">
                <DelegationsTab positions={positions} users={users} delegations={delegations} onChanged={load} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
