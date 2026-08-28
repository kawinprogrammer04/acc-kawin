import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, getApiErrorMessage } from "@/api/client";
import {
  expenseSettingsApi, expenseTypesApi, policyVersionsApi, positionsApi, rulesApi,
} from "@/api/approvals";
import type { Department, ExpenseType, Position, PolicyVersion, Rule, RuleStep } from "@/api/approvals";
import { useCompany } from "@/context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TargetType = "direct_supervisor" | "position" | "user";
type RequestKind = "" | "reimbursement" | "advance" | "direct_payment" | "ot" | "allowance";
type CompanyUser = { user_id: number; username: string; full_name: string | null; role: string };
type DraftStep = { name: string; target_type: TargetType; target_id: string; approve_mode: "any" | "all" };
type RuleDraft = {
  name: string;
  requester_mode: "position" | "department" | "all";
  requester_position_id: string;
  department_id: string;
  expense_type_id: string;
  request_kind: RequestKind;
  amount_min: string;
  amount_max: string;
  priority: string;
  steps: DraftStep[];
};
type RuleGroup = Rule & { members: Rule[] };
export type ApprovalRuleEditRequest = { ruleId: number; nonce: number };

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const kindLabels: Record<string, string> = {
  reimbursement: "เบิกค่าใช้จ่าย",
  advance: "สำรองจ่าย",
  direct_payment: "ชำระตรง",
  ot: "OT",
  allowance: "เบี้ยเลี้ยง",
};
const targetLabels: Record<TargetType, string> = {
  direct_supervisor: "หัวหน้าของผู้ขอ",
  position: "ตำแหน่ง",
  user: "ระบุผู้ใช้",
};

const blankStep = (order: number): DraftStep => ({
  name: order === 1 ? "หัวหน้าอนุมัติ" : `ขั้นอนุมัติที่ ${order}`,
  target_type: "position",
  target_id: "",
  approve_mode: "any",
});

const blankDraft = (positions: Position[], types: ExpenseType[]): RuleDraft => ({
  name: "",
  requester_mode: "position",
  requester_position_id: positions[0] ? String(positions[0].id) : "",
  department_id: "",
  expense_type_id: types[0] ? String(types[0].id) : "",
  request_kind: "",
  amount_min: "0",
  amount_max: "",
  priority: "100",
  steps: [blankStep(1)],
});

function stepToDraft(step: RuleStep): DraftStep {
  const type = step.target_type === "hr_position" ? "position" : (step.target_type ?? "position");
  return {
    name: step.name ?? step.target_name ?? "",
    target_type: type as TargetType,
    target_id: step.target_id ? String(step.target_id) : "",
    approve_mode: step.approve_mode ?? "any",
  };
}

function ruleToDraft(rule: Rule, departments: Department[]): RuleDraft {
  const sourceDepartment = rule.source_scope?.department_name;
  const department = departments.find((row) => row.name === sourceDepartment);
  const isDepartmentScope = Boolean(
    rule.source_scope && !rule.source_scope.requester_position_name && sourceDepartment,
  );
  const isGlobalRequesterScope = rule.requester_position_id == null
    && !rule.source_scope?.requester_position_name && !sourceDepartment;
  return {
    name: rule.name ?? "",
    requester_mode: isGlobalRequesterScope ? "all" : isDepartmentScope ? "department" : "position",
    requester_position_id: rule.requester_position_id == null ? "" : String(rule.requester_position_id),
    department_id: department ? String(department.id) : (rule.requester_department_id ? String(rule.requester_department_id) : ""),
    expense_type_id: rule.expense_type_id == null ? "" : String(rule.expense_type_id),
    request_kind: (rule.request_kind ?? "") as RequestKind,
    amount_min: String(rule.amount_min),
    amount_max: rule.amount_max == null ? "" : String(rule.amount_max),
    priority: String(rule.priority ?? 100),
    steps: rule.steps.length ? rule.steps.map(stepToDraft) : [blankStep(1)],
  };
}

function StepEditor({
  step, index, totalSteps, positions, users, onChange, onRemove, onMove,
}: {
  step: DraftStep;
  index: number;
  totalSteps: number;
  positions: Position[];
  users: CompanyUser[];
  onChange: (patch: Partial<DraftStep>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">ขั้นที่ {index + 1}</span>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" disabled={index === totalSteps - 1} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" disabled={totalSteps === 1} onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1.1fr,1fr,1fr,auto]">
        <div className="space-y-1">
          <Label className="text-xs">ชื่อขั้นตอน</Label>
          <Input value={step.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="เช่น ผู้จัดการอนุมัติ" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">ผู้อนุมัติ</Label>
          <select className={inputCls} value={step.target_type} onChange={(e) => onChange({ target_type: e.target.value as TargetType, target_id: "" })}>
            {(Object.keys(targetLabels) as TargetType[]).map((type) => <option key={type} value={type}>{targetLabels[type]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">เป้าหมาย</Label>
          {step.target_type === "direct_supervisor" ? (
            <div className={`${inputCls} text-muted-foreground`}>หัวหน้าแผนกของผู้ขอ</div>
          ) : step.target_type === "position" ? (
            <select className={inputCls} value={step.target_id} onChange={(e) => onChange({ target_id: e.target.value })}>
              <option value="">-- เลือกตำแหน่ง --</option>
              {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
            </select>
          ) : (
            <select className={inputCls} value={step.target_id} onChange={(e) => onChange({ target_id: e.target.value })}>
              <option value="">-- เลือกผู้ใช้ --</option>
              {users.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.username}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">การอนุมัติ</Label>
          <select className={inputCls} value={step.approve_mode} onChange={(e) => onChange({ approve_mode: e.target.value as "any" | "all" })}>
            <option value="any">คนใดคนหนึ่ง</option>
            <option value="all">ทุกคน</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function HrStyleApprovalSettings({
  editRuleRequest,
  onRulesChanged,
  refreshKey = 0,
  onEditStarted,
  showList = true,
}: {
  editRuleRequest?: ApprovalRuleEditRequest | null;
  onRulesChanged?: () => void;
  refreshKey?: number;
  onEditStarted?: (ruleId: number) => void;
  showList?: boolean;
}) {
  const { currentCompany } = useCompany();
  const [positions, setPositions] = useState<Position[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [amountFilter, setAmountFilter] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [editingRule, setEditingRule] = useState<RuleGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const handledEditRequest = useRef<number | null>(null);
  const activeVersion = versions.find((version) => version.status === "active") ?? versions[0];

  const load = useCallback(async () => {
    if (!currentCompany) return;
    setLoading(true);
    setError(null);
    try {
      const [positionRows, typeRows, departmentRows, companyUsers, versionRows] = await Promise.all([
        positionsApi.list(), expenseTypesApi.list(), expenseSettingsApi.departments(),
        api.get(`/companies/${currentCompany.id}/users`).then((response) => response.data),
        policyVersionsApi.list(),
      ]);
      setPositions(positionRows); setTypes(typeRows); setDepartments(departmentRows);
      setUsers(companyUsers); setVersions(versionRows);
      const version = versionRows.find((row: PolicyVersion) => row.status === "active") ?? versionRows[0];
      setRules(version ? await rulesApi.list(version.id) : []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "โหลดกฎอนุมัติไม่สำเร็จ"));
    } finally { setLoading(false); }
  }, [currentCompany, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const logicalRules = useMemo<RuleGroup[]>(() => {
    const groups = new Map<string, Rule[]>();
    rules.forEach((rule) => {
      const key = rule.logical_group_key
        || (rule.source_system === "hr" && rule.source_policy_id ? `hr:${rule.source_policy_id}` : `rule:${rule.id}`);
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    });
    return Array.from(groups.values()).map((members) => ({
      ...members[0],
      is_active: members.some((member) => member.is_active),
      members,
    }));
  }, [rules]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    const amount = amountFilter === "" ? null : Number(amountFilter);
    return logicalRules.filter((rule) => {
      if (statusFilter === "active" && !rule.is_active) return false;
      if (statusFilter === "inactive" && rule.is_active) return false;
      if (departmentFilter && rule.source_scope?.department_name && !rule.members.some((member) => String(member.requester_department_id ?? "") === departmentFilter)) return false;
      if (positionFilter && rule.source_scope?.requester_position_name && !rule.members.some((member) => String(member.requester_position_id ?? "") === positionFilter)) return false;
      if (typeFilter && rule.expense_type_id != null && String(rule.expense_type_id) !== typeFilter) return false;
      if (kindFilter && rule.request_kind && rule.request_kind !== kindFilter) return false;
      if (kindFilter === "direct_payment" && rule.source_system === "hr" && !rule.request_kind) return false;
      if ((kindFilter === "ot" || kindFilter === "allowance") && !rule.request_kind) return false;
      if (amount != null && !(rule.amount_min <= amount && (rule.amount_max == null || amount <= rule.amount_max))) return false;
      if (!query) return true;
      const haystack = [
        rule.name, rule.source_scope?.company_name, rule.source_scope?.department_name,
        rule.source_scope?.requester_position_name, rule.source_scope?.expense_type_name,
        rule.requester_position_name, rule.requester_department_name, rule.expense_type_name,
        ...rule.steps.map((step) => `${step.name} ${step.target_name}`),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [amountFilter, departmentFilter, kindFilter, logicalRules, positionFilter, search, statusFilter, typeFilter]);

  const openCreate = () => { setEditingRule(null); setDraft(blankDraft(positions, types)); };
  const openEdit = (rule: RuleGroup, notify = true) => { if (notify) onEditStarted?.(rule.id); setEditingRule(rule); setDraft(ruleToDraft(rule, departments)); };
  const closeDialog = () => { if (!saving) { setDraft(null); setEditingRule(null); } };
  const updateStep = (index: number, patch: Partial<DraftStep>) => setDraft((current) => current ? { ...current, steps: current.steps.map((step, i) => i === index ? { ...step, ...patch } : step) } : current);
  const moveStep = (index: number, direction: -1 | 1) => setDraft((current) => {
    if (!current || !current.steps[index + direction]) return current;
    const steps = [...current.steps]; [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
    return { ...current, steps };
  });

  useEffect(() => {
    if (!editRuleRequest || handledEditRequest.current === editRuleRequest.nonce) return;
    const requestedRule = logicalRules.find((rule) =>
      rule.id === editRuleRequest.ruleId || rule.members.some((member) => member.id === editRuleRequest.ruleId),
    );
    if (!requestedRule) return;
    handledEditRequest.current = editRuleRequest.nonce;
    openEdit(requestedRule, false);
  }, [departments, editRuleRequest, logicalRules]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !activeVersion) return;
    const targetPositions: Array<Position | null> = draft.requester_mode === "all"
      ? [null]
      : draft.requester_mode === "department"
        ? positions.filter((position) => String(position.department_id) === draft.department_id)
        : positions.filter((position) => String(position.id) === draft.requester_position_id);
    if (!targetPositions.length || !draft.steps.length) { setError("กรุณากรอกขอบเขตผู้เบิกและขั้นอนุมัติให้ครบ"); return; }
    if (draft.steps.some((step) => step.target_type !== "direct_supervisor" && !step.target_id)) { setError("กรุณาเลือกเป้าหมายผู้อนุมัติให้ครบทุกขั้น"); return; }
    setSaving(true); setError(null);
    const selectedType = types.find((type) => String(type.id) === draft.expense_type_id);
    const selectedDepartment = departments.find((department) => String(department.id) === draft.department_id);
    const selectedPosition = positions.find((position) => String(position.id) === draft.requester_position_id);
    const selectedExpenseTypeId = selectedType?.id ?? null;
    const sourceScope: NonNullable<Rule["source_scope"]> = {
      company_name: editingRule?.source_scope
        ? editingRule.source_scope.company_name ?? null
        : currentCompany?.name_th ?? null,
      department_name: draft.requester_mode === "all" ? null : draft.requester_mode === "department"
        ? selectedDepartment?.name ?? null
        : departments.find((department) => department.id === selectedPosition?.department_id)?.name ?? null,
      requester_position_name: draft.requester_mode === "position" ? selectedPosition?.name ?? null : null,
      expense_type_code: selectedType?.code ?? null,
      expense_type_name: editingRule?.source_scope && editingRule.expense_type_id === selectedExpenseTypeId
        ? editingRule.source_scope.expense_type_name ?? selectedType?.name ?? null
        : selectedType?.name ?? null,
      request_kind: draft.request_kind || null,
    };
    const logicalGroupKey = editingRule?.logical_group_key || `acc:${crypto.randomUUID()}`;
    const makePayload = (positionId: number | null) => ({
      requester_position_id: positionId,
      expense_type_id: selectedExpenseTypeId,
      amount_min: Number(draft.amount_min || 0),
      amount_max: draft.amount_max === "" ? null : Number(draft.amount_max),
      name: draft.name.trim() || null,
      request_kind: draft.request_kind || null,
      priority: Number(draft.priority || 100),
      source_scope: sourceScope,
      steps: draft.steps.map((step, index) => ({ step_no: index + 1, name: step.name.trim() || undefined, target_type: step.target_type, target_id: step.target_type === "direct_supervisor" ? null : Number(step.target_id), approve_mode: step.approve_mode })),
    });
    try {
      if (editingRule) {
        const memberKey = (positionId: number | null | undefined, expenseTypeId: number | null | undefined) => `${positionId ?? "*"}:${expenseTypeId ?? "*"}`;
        const existingByScope = new Map(editingRule.members.map((member) => [memberKey(member.requester_position_id, member.expense_type_id), member]));
        const desiredKeys = new Set(targetPositions.map((position) => memberKey(position?.id, selectedExpenseTypeId)));
        await Promise.all(targetPositions.map((position) => {
          const positionId = position?.id ?? null;
          const existing = existingByScope.get(memberKey(positionId, selectedExpenseTypeId));
          if (existing) return rulesApi.update(existing.id, { ...makePayload(positionId), is_active: editingRule.is_active });
          return rulesApi.create(activeVersion.id, {
            ...makePayload(positionId),
            source_system: editingRule.source_system === "hr" ? "hr" : "acc",
            source_policy_id: editingRule.source_policy_id,
            logical_group_key: logicalGroupKey,
          });
        }));
        await Promise.all(editingRule.members
          .filter((member) => !desiredKeys.has(memberKey(member.requester_position_id, member.expense_type_id)))
          .map((member) => rulesApi.delete(member.id)));
      } else {
        await Promise.all(targetPositions.map((position) => rulesApi.create(activeVersion.id, {
          ...makePayload(position?.id ?? null),
          source_system: "acc",
          logical_group_key: logicalGroupKey,
        })));
      }
      closeDialog(); await load(); onRulesChanged?.();
    } catch (saveError) { setError(getApiErrorMessage(saveError, "บันทึกกฎไม่สำเร็จ")); }
    finally { setSaving(false); }
  };

  const toggleActive = async (rule: RuleGroup) => {
    try { await Promise.all(rule.members.map((member) => rulesApi.update(member.id, { is_active: !rule.is_active }))); await load(); onRulesChanged?.(); }
    catch (toggleError) { setError(getApiErrorMessage(toggleError, "เปลี่ยนสถานะกฎไม่สำเร็จ")); }
  };
  const remove = async (rule: RuleGroup) => {
    if (!window.confirm(`ลบกฎ “${rule.name || rule.expense_type_name || rule.id}” หรือไม่?`)) return;
    try { await Promise.all(rule.members.map((member) => rulesApi.delete(member.id))); await load(); onRulesChanged?.(); }
    catch (deleteError) { setError(getApiErrorMessage(deleteError, "ลบกฎไม่สำเร็จ")); }
  };

  return (
    <div className={showList ? "space-y-4 p-6" : ""}>
      {showList && <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-xl font-semibold">กฎอนุมัติ</h2><p className="mt-1 text-sm text-muted-foreground">ตั้งค่าขอบเขต วงเงิน ลำดับขั้น และผู้อนุมัติแบบเดียวกับ HR</p></div>
          <Button onClick={openCreate} disabled={!activeVersion}><Plus className="h-4 w-4" /> เพิ่มกฎอนุมัติ</Button>
        </div>
        {activeVersion && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">เวอร์ชัน {activeVersion.version_no} · {logicalRules.filter((rule) => rule.is_active).length} กฎที่เปิดใช้งาน · {rules.filter((rule) => rule.is_active).length} เส้นทางภายใน</div>}
        {!activeVersion && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">ยังไม่มีเวอร์ชันสายอนุมัติที่ใช้งานอยู่</div>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <Card><CardContent className="space-y-4 p-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อกฎ ตำแหน่ง แผนก หรือขั้นอนุมัติ" /></div>
          <select className={inputCls} value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}><option value="">ทุกแผนก</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
          <select className={inputCls} value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}><option value="">ทุกตำแหน่งผู้ขอ</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select>
          <select className={inputCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">ทุกประเภทการเบิก</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
          <select className={inputCls} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="">ทุกรูปแบบคำขอ</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">ทุกสถานะ</option><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select>
          <Input type="number" min="0" step="0.01" value={amountFilter} onChange={(e) => setAmountFilter(e.target.value)} placeholder="ยอดเงินที่ต้องการตรวจ" />
        </div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="border-b bg-muted/30"><tr>{["กฎ / ขอบเขต", "วงเงิน", "ขั้นอนุมัติ", "สถานะ", "จัดการ"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{heading}</th>)}</tr></thead>
          <tbody className="divide-y">{loading ? <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr> : filteredRules.map((rule) => {
            const scope = rule.source_scope;
            const companyLabel = scope ? scope.company_name || "ทุกบริษัท" : currentCompany?.name_th || "บริษัทปัจจุบัน";
            const departmentLabel = scope ? scope.department_name || "ทุกแผนก" : rule.requester_department_name || "ทุกแผนก";
            const positionLabel = scope ? scope.requester_position_name || "ทุกตำแหน่ง" : rule.requester_position_name || "ทุกตำแหน่ง";
            const expenseTypeLabel = scope ? scope.expense_type_name || "ทุกประเภท" : rule.expense_type_name || "ทุกประเภท";
            const requestKind = scope ? scope.request_kind : rule.request_kind;
            const requestKindLabel = requestKind ? kindLabels[requestKind] || requestKind : "ทุกรูปแบบ";
            return <tr key={rule.logical_group_key || rule.id} className="align-top hover:bg-muted/20">
              <td className="px-4 py-3"><div className="font-medium">{rule.name || "กฎอนุมัติไม่มีชื่อ"}</div><div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground"><span className="rounded-full bg-muted px-2 py-0.5">{companyLabel}</span><span className="rounded-full bg-muted px-2 py-0.5">{departmentLabel}</span><span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{positionLabel}</span><span className="rounded-full bg-muted px-2 py-0.5">{expenseTypeLabel}</span><span className="rounded-full bg-muted px-2 py-0.5">{requestKindLabel}</span></div><div className="mt-1 text-xs text-muted-foreground">Priority {rule.priority ?? 100}{rule.members.length > 1 ? ` · ${rule.members.length} เส้นทางภายใน` : ""}</div></td>
              <td className="whitespace-nowrap px-4 py-3">{rule.amount_min.toLocaleString("th-TH", { minimumFractionDigits: 2 })} – {rule.amount_max == null ? "ไม่จำกัด" : rule.amount_max.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-3"><div className="space-y-1">{rule.steps.map((step) => <div key={step.step_no} className="text-xs"><span className="mr-1 font-medium">{step.step_no}.</span>{step.name || step.target_name || "ผู้อนุมัติ"}<span className="ml-1 text-muted-foreground">({step.target_name || targetLabels[(step.target_type as TargetType) || "position"]}, {step.approve_mode === "all" ? "ทุกคน" : "คนใดคนหนึ่ง"})</span></div>)}</div></td>
              <td className="px-4 py-3"><button type="button" onClick={() => toggleActive(rule)} className={`rounded-full px-2 py-1 text-xs font-medium ${rule.is_active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{rule.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</button></td>
              <td className="px-4 py-3"><div className="flex gap-1"><Button variant="outline" size="icon" onClick={() => openEdit(rule)}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="outline" size="icon" onClick={() => remove(rule)}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button></div></td>
            </tr>;
          })}{!loading && filteredRules.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">ไม่พบกฎตามเงื่อนไข</td></tr>}</tbody>
        </table></div>
        </CardContent></Card>
      </>}

      <Dialog open={!!draft} onOpenChange={(open) => !open && closeDialog()}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{editingRule ? "แก้ไขกฎอนุมัติ" : "เพิ่มกฎอนุมัติ"}</DialogTitle><DialogDescription>กำหนดข้อมูลและขั้นอนุมัติให้ตรงกับการตั้งค่า HR</DialogDescription></DialogHeader>{draft && <form onSubmit={save} className="space-y-5 p-6 pt-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label>ชื่อกฎ</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="เช่น ค่าใช้จ่ายทั่วไปของฝ่ายขาย" /></div><div className="space-y-1"><Label>ประเภทการเบิก</Label><select className={inputCls} value={draft.expense_type_id} onChange={(e) => setDraft({ ...draft, expense_type_id: e.target.value })}><option value="">ทุกประเภท</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div></div>
        <div className="grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label>ขอบเขตผู้ขอ *</Label><div className="flex flex-wrap gap-3 pt-2 text-sm"><label><input type="radio" checked={draft.requester_mode === "position"} onChange={() => setDraft({ ...draft, requester_mode: "position" })} /> ตำแหน่งเดียว</label><label><input type="radio" checked={draft.requester_mode === "department"} onChange={() => setDraft({ ...draft, requester_mode: "department" })} /> ทั้งแผนก</label><label><input type="radio" checked={draft.requester_mode === "all"} onChange={() => setDraft({ ...draft, requester_mode: "all" })} /> ทุกตำแหน่ง</label></div></div>{draft.requester_mode === "position" ? <div className="space-y-1"><Label>ตำแหน่งผู้ขอ *</Label><select className={inputCls} required value={draft.requester_position_id} onChange={(e) => setDraft({ ...draft, requester_position_id: e.target.value })}>{positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select></div> : draft.requester_mode === "department" ? <div className="space-y-1"><Label>แผนกผู้ขอ *</Label><select className={inputCls} required value={draft.department_id} onChange={(e) => setDraft({ ...draft, department_id: e.target.value })}><option value="">-- เลือกแผนก --</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div> : <div className="space-y-1"><Label>ตำแหน่งผู้ขอ</Label><div className={`${inputCls} text-muted-foreground`}>ทุกตำแหน่ง</div></div>}</div>
        <div className="grid gap-3 md:grid-cols-4"><div className="space-y-1"><Label>รูปแบบคำขอ</Label><select className={inputCls} value={draft.request_kind} onChange={(e) => setDraft({ ...draft, request_kind: e.target.value as RequestKind })}><option value="">ทุกรูปแบบ</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="space-y-1"><Label>ยอดต่ำสุด *</Label><Input type="number" min="0" step="0.01" required value={draft.amount_min} onChange={(e) => setDraft({ ...draft, amount_min: e.target.value })} /></div><div className="space-y-1"><Label>ยอดสูงสุด</Label><Input type="number" min="0" step="0.01" value={draft.amount_max} onChange={(e) => setDraft({ ...draft, amount_max: e.target.value })} placeholder="ไม่จำกัด" /></div><div className="space-y-1"><Label>Priority</Label><Input type="number" min="1" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} /></div></div>
        <div className="space-y-2"><div className="flex items-center justify-between"><Label>ขั้นอนุมัติ *</Label><Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, steps: [...draft.steps, blankStep(draft.steps.length + 1)] })}><Plus className="h-3.5 w-3.5" /> เพิ่มขั้น</Button></div>{draft.steps.map((step, index) => <StepEditor key={index} step={step} index={index} totalSteps={draft.steps.length} positions={positions} users={users} onChange={(patch) => updateStep(index, patch)} onMove={(direction) => moveStep(index, direction)} onRemove={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })} />)}</div>
        <DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>ยกเลิก</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}บันทึกกฎ</Button></DialogFooter>
      </form>}</DialogContent></Dialog>
    </div>
  );
}
