import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpToLine, Banknote, Building2,
  CheckCircle2, ChevronDown, ChevronUp, Eraser, GitBranch, GripVertical, Layers3, Loader2, Pencil,
  RefreshCw, Search, ShieldCheck, Tags, UserCircle, Users,
} from "lucide-react";
import { getApiErrorMessage } from "@/api/client";
import { policyVersionsApi, rulesApi } from "@/api/approvals";
import type { PolicyVersion, Rule } from "@/api/approvals";
import { DataListFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListKpiCard } from "@/components/data-list/DataListKpiCard";
import { dataListFilterControlClass } from "@/components/data-list/styles";
import { Card, CardContent } from "@/components/ui/card";

type LogicalRule = Rule & { members: Rule[]; key: string };
type ConditionGroup = {
  key: string;
  expenseType: string;
  amount: string;
  requestKind?: string | null;
  rules: LogicalRule[];
};
type DepartmentGroup = { name: string; conditions: ConditionGroup[] };

const kindLabels: Record<string, string> = {
  reimbursement: "เบิกค่าใช้จ่าย",
  advance: "เงินทดรอง",
  direct_payment: "ชำระตรง",
  ot: "ค่าล่วงเวลา",
  allowance: "เบี้ยเลี้ยง",
};

const orderStorageKey = (companyId?: number) => `expense_settings_rule_flow_order:${companyId ?? "default"}`;
const focusStorageKey = (companyId?: number) => `expense_settings_last_rule_focus:${companyId ?? "default"}`;

function ruleFocusToken(ruleId: number, departmentName: string) {
  let hash = 0;
  for (const character of departmentName) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `approval-rule-${ruleId}-${Math.abs(hash)}`;
}

function formatNumber(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function amountLabel(rule: Rule) {
  if (rule.amount_min <= 0 && rule.amount_max == null) return "ทุกวงเงิน";
  if (rule.amount_max == null) return `ตั้งแต่ ฿${formatNumber(rule.amount_min)}`;
  return `฿${formatNumber(rule.amount_min)} – ฿${formatNumber(rule.amount_max)}`;
}

function unique(values: Array<string | null | undefined>, fallback: string) {
  const labels = [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
  return labels.length ? labels : [fallback];
}

function departmentLabels(rule: LogicalRule) {
  return unique(rule.members.map((member) => member.source_scope?.department_name || member.requester_department_name), "ทุกแผนก");
}

function positionLabels(rule: LogicalRule) {
  return unique(rule.members.map((member) => member.source_scope?.requester_position_name || member.requester_position_name), "ทุกตำแหน่ง");
}

function expenseTypeLabel(rule: Rule) {
  return rule.source_scope?.expense_type_name || rule.expense_type_name || "ทุกประเภทการเบิก";
}

function approverLabel(step: Rule["steps"][number]) {
  if (step.target_name) return step.target_name;
  if (step.approver_position_name) return step.approver_position_name;
  if (step.target_type === "direct_supervisor") return "หัวหน้าของผู้ขอ";
  if (step.target_type === "user") return "ผู้อนุมัติเฉพาะบุคคล";
  return "ตำแหน่งผู้อนุมัติ";
}

function FlowArrow() {
  return <div className="flex w-8 shrink-0 items-center justify-center text-slate-300 dark:text-slate-600" aria-hidden="true"><div className="h-px w-3 bg-current" /><ArrowRight className="-ml-0.5 h-4 w-4" /></div>;
}

function RuleCard({
  rule, departmentName, index, total, expanded, dragging,
  reordering, highlighted, focusToken, onEdit, onToggle, onMove, onReorderSteps, onDragStart, onDragEnd, onDrop,
}: {
  rule: LogicalRule;
  departmentName: string;
  index: number;
  total: number;
  expanded: boolean;
  dragging: boolean;
  reordering: boolean;
  highlighted: boolean;
  focusToken: string;
  onEdit: () => void;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
  onReorderSteps: (sourceIndex: number, targetIndex: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const departments = departmentLabels(rule);
  const positions = positionLabels(rule);
  const active = rule.members.some((member) => member.is_active);
  const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);

  return <article
    id={focusToken}
    draggable={!reordering}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; onDragStart(); }}
    onDragEnd={onDragEnd}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
    onDrop={(event) => { event.preventDefault(); onDrop(); }}
    className={`overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-500 ${highlighted ? "border-amber-400 ring-4 ring-amber-300/50 shadow-lg shadow-amber-200/40 dark:ring-amber-700/40" : dragging ? "border-primary/60 opacity-50" : expanded ? "border-primary/40 shadow-md" : "hover:border-primary/30 hover:shadow-md"}`}
  >
    <div className="flex items-stretch">
      <div className="flex w-11 shrink-0 cursor-grab flex-col items-center justify-center border-r bg-muted/40 text-muted-foreground active:cursor-grabbing" title="ลากเพื่อจัดลำดับกฎ"><GripVertical className="h-5 w-5" /><span className="text-[10px] font-black">{index + 1}</span></div>
      <button type="button" onClick={onEdit} aria-label={`แก้ไขกฎ ${rule.name || "กฎอนุมัติ"} และผู้อนุมัติ`} className="min-w-0 flex-1 p-4 text-left outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} /><h5 className="truncate text-base font-black">{rule.name || "กฎอนุมัติ"}</h5>{highlighted && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200">แก้ไขล่าสุด</span>}{!active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800">ปิดใช้งาน</span>}</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-900"><Banknote className="h-3 w-3" />วงเงินกฎ {amountLabel(rule)}</span>
              {positions.slice(0, 2).map((position) => <span key={position} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><UserCircle className="h-3 w-3" />{position}</span>)}
              {departments.length > 1 && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">ใช้ร่วม {departments.length} แผนก</span>}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-xs font-black text-primary">{reordering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}{reordering ? "กำลังอัปเดตลำดับ" : "แก้ไขกฎและผู้อนุมัติ"}</span>
        </div>
      </button>
      <div className="flex w-11 shrink-0 flex-col justify-center gap-1 border-l p-1"><button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? "ย่อสายผู้อนุมัติ" : "เปิดดูสายผู้อนุมัติ"} title={expanded ? "ย่อสายผู้อนุมัติ" : "เปิดดูสายผู้อนุมัติ"} className="flex h-9 items-center justify-center rounded-lg bg-muted text-primary hover:bg-primary/10">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button><button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="ย้ายกฎขึ้น" className="hidden h-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-25 sm:flex"><ArrowUp className="h-4 w-4" /></button><button type="button" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="ย้ายกฎลง" className="hidden h-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-25 sm:flex"><ArrowDown className="h-4 w-4" /></button></div>
    </div>
    {expanded && <div className="border-t bg-slate-50/70 p-4 dark:bg-slate-950/30">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>กฎ → ผู้อนุมัติแต่ละขั้น</p><p className="font-bold">Priority {rule.priority ?? 100}</p></div>
      <div className="overflow-x-auto pb-2"><div className="flex min-w-max items-stretch">
        <button type="button" onClick={onEdit} className="w-56 shrink-0 rounded-xl border border-indigo-200 bg-white p-3 text-left shadow-sm transition hover:border-primary hover:ring-2 hover:ring-primary/15 dark:border-indigo-900 dark:bg-slate-900"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-indigo-600 dark:text-indigo-300"><GitBranch className="h-4 w-4" />กฎที่ใช้ · คลิกเพื่อแก้ไข</div><p className="mt-2 text-sm font-black">{rule.name || "กฎอนุมัติ"}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{departmentName} · {positions.join(", ")}</p></button>
        {rule.steps.map((step, stepIndex) => <div key={`${rule.key}:${step.step_no}`} className="flex items-stretch"><FlowArrow /><div
          draggable={!reordering}
          onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; setDraggedStepIndex(stepIndex); }}
          onDragEnd={(event) => { event.stopPropagation(); setDraggedStepIndex(null); }}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (draggedStepIndex != null && draggedStepIndex !== stepIndex) onReorderSteps(draggedStepIndex, stepIndex); setDraggedStepIndex(null); }}
          className={`w-56 shrink-0 overflow-hidden rounded-xl border bg-white shadow-sm transition dark:bg-slate-900 ${draggedStepIndex === stepIndex ? "border-primary opacity-50" : "border-emerald-200 dark:border-emerald-900"}`}
        ><button type="button" onClick={onEdit} disabled={reordering} aria-label={`แก้ไขผู้อนุมัติขั้นที่ ${step.step_no}`} className="relative block w-full p-3 text-left transition hover:bg-primary/5 disabled:cursor-wait"><div className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-bl-xl bg-emerald-500 text-xs font-black text-white">{stepIndex + 1}</div><div className="flex items-center gap-2 pr-7 text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />ผู้อนุมัติ · คลิกเพื่อแก้ไข</div><p className="mt-2 pr-6 text-sm font-black">{step.name || `อนุมัติขั้นที่ ${stepIndex + 1}`}</p><p className="mt-1 text-xs text-muted-foreground">{approverLabel(step)}</p><p className="mt-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{step.approve_mode === "all" ? "ต้องอนุมัติทุกคน" : "อนุมัติคนใดคนหนึ่ง"}</p></button><div className="flex items-center justify-between border-t bg-emerald-50/70 px-2 py-1.5 dark:bg-emerald-950/30"><button type="button" onClick={() => onReorderSteps(stepIndex, stepIndex - 1)} disabled={reordering || stepIndex === 0} aria-label={`ย้ายผู้อนุมัติขั้นที่ ${stepIndex + 1} ไปก่อนหน้า`} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white disabled:opacity-25 dark:hover:bg-slate-900"><ArrowLeft className="h-3.5 w-3.5" /></button><span className="inline-flex cursor-grab items-center gap-1 text-[10px] font-black text-emerald-700 dark:text-emerald-300"><GripVertical className="h-3.5 w-3.5" />ลากเปลี่ยนลำดับ</span><button type="button" onClick={() => onReorderSteps(stepIndex, stepIndex + 1)} disabled={reordering || stepIndex === rule.steps.length - 1} aria-label={`ย้ายผู้อนุมัติขั้นที่ ${stepIndex + 1} ไปถัดไป`} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white disabled:opacity-25 dark:hover:bg-slate-900"><ArrowRight className="h-3.5 w-3.5" /></button></div></div></div>)}
      </div></div>
    </div>}
  </article>;
}

export function ApprovalRuleFlow({ companyId, refreshKey = 0, onEditRule, onRulesChanged }: { companyId?: number; refreshKey?: number; onEditRule?: (ruleId: number, departmentName?: string, ruleKey?: string) => void; onRulesChanged?: () => void }) {
  const [version, setVersion] = useState<PolicyVersion | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState("active");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedDepartments, setCollapsedDepartments] = useState<Set<string>>(new Set());
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [reorderingRuleKey, setReorderingRuleKey] = useState<string | null>(null);
  const [highlightedToken, setHighlightedToken] = useState<string | null>(null);
  const [loadedCycle, setLoadedCycle] = useState<string | null>(null);
  const restoredCycle = useRef<string | null>(null);
  const flowTopRef = useRef<HTMLDivElement | null>(null);
  const flowBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim().toLowerCase()), 300); return () => window.clearTimeout(timer); }, [search]);

  const load = useCallback(async () => {
    if (!companyId) return;
    const cycle = `${companyId}:${refreshKey}`;
    setLoading(true); setError("");
    try {
      const versions: PolicyVersion[] = await policyVersionsApi.list();
      const selected = versions.find((item) => item.status === "active") ?? versions[0] ?? null;
      setVersion(selected);
      setRules(selected ? await rulesApi.list(selected.id) : []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "โหลดผังกฎการอนุมัติไม่สำเร็จ")); setVersion(null); setRules([]);
    } finally { setLoading(false); setLoadedCycle(cycle); }
  }, [companyId, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const logicalRules = useMemo<LogicalRule[]>(() => {
    const grouped = new Map<string, Rule[]>();
    rules.forEach((rule) => {
      const key = rule.logical_group_key || (rule.source_system === "hr" && rule.source_policy_id ? `hr:${rule.source_policy_id}` : `rule:${rule.id}`);
      grouped.set(key, [...(grouped.get(key) ?? []), rule]);
    });
    return [...grouped.entries()].map(([key, members]) => ({ ...members[0], is_active: members.some((member) => member.is_active), members, key }));
  }, [rules]);

  useEffect(() => {
    if (!logicalRules.length) { setOrderedKeys([]); return; }
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(orderStorageKey(companyId)) || "[]"); } catch { saved = []; }
    const available = new Set(logicalRules.map((rule) => rule.key));
    const next = [...saved.filter((key) => available.has(key)), ...logicalRules.map((rule) => rule.key).filter((key) => !saved.includes(key))];
    setOrderedKeys(next);
    setExpanded(new Set(next));
  }, [companyId, logicalRules]);

  const orderedRules = useMemo(() => {
    const order = new Map(orderedKeys.map((key, index) => [key, index]));
    return [...logicalRules].sort((a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }, [logicalRules, orderedKeys]);

  const departments = useMemo(() => logicalRules.length ? unique(logicalRules.flatMap(departmentLabels), "ทุกแผนก").sort((a, b) => a.localeCompare(b, "th")) : [], [logicalRules]);
  const expenseTypes = useMemo(() => [...new Set(logicalRules.map(expenseTypeLabel))].sort((a, b) => a.localeCompare(b, "th")), [logicalRules]);
  const positions = useMemo(() => [...new Set(logicalRules.flatMap(positionLabels))].sort((a, b) => a.localeCompare(b, "th")), [logicalRules]);
  const filteredRules = useMemo(() => orderedRules.flatMap((rule) => {
    const scopedMembers = rule.members.filter((member) => {
      const memberDepartment = member.source_scope?.department_name || member.requester_department_name || "ทุกแผนก";
      const memberPosition = member.source_scope?.requester_position_name || member.requester_position_name || "ทุกตำแหน่ง";
      if (status === "active" && !member.is_active) return false;
      if (department && memberDepartment !== department) return false;
      if (expenseType && expenseTypeLabel(member) !== expenseType) return false;
      if (position && memberPosition !== position) return false;
      return true;
    });
    if (!scopedMembers.length) return [];
    const scopedRule: LogicalRule = {
      ...rule,
      ...scopedMembers[0],
      key: rule.key,
      members: scopedMembers,
      is_active: scopedMembers.some((member) => member.is_active),
    };
    if (query && ![
      scopedRule.name,
      expenseTypeLabel(scopedRule),
      amountLabel(scopedRule),
      ...departmentLabels(scopedRule),
      ...positionLabels(scopedRule),
      ...scopedRule.steps.flatMap((step) => [step.name, approverLabel(step)]),
    ].join(" ").toLowerCase().includes(query)) return [];
    return [scopedRule];
  }), [department, expenseType, orderedRules, position, query, status]);

  useEffect(() => {
    setExpanded((current) => new Set([...current, ...filteredRules.map((rule) => rule.key)]));
  }, [department, expenseType, position, query, status]);

  const departmentGroups = useMemo<DepartmentGroup[]>(() => {
    const byDepartment = new Map<string, LogicalRule[]>();
    filteredRules.forEach((rule) => {
      const visibleDepartments = department
        ? departmentLabels(rule).filter((name) => name === department)
        : departmentLabels(rule);
      visibleDepartments.forEach((name) => byDepartment.set(name, [...(byDepartment.get(name) ?? []), rule]));
    });
    return [...byDepartment.entries()].map(([name, departmentRules]) => {
      const byCondition = new Map<string, LogicalRule[]>();
      departmentRules.forEach((rule) => {
        const kind = rule.source_scope?.request_kind || rule.request_kind || "";
        const key = [rule.expense_type_id ?? "all", rule.amount_min, rule.amount_max ?? "unlimited", kind].join(":");
        byCondition.set(key, [...(byCondition.get(key) ?? []), rule]);
      });
      return { name, conditions: [...byCondition.entries()].map(([key, conditionRules]) => ({ key, expenseType: expenseTypeLabel(conditionRules[0]), amount: amountLabel(conditionRules[0]), requestKind: conditionRules[0].source_scope?.request_kind || conditionRules[0].request_kind, rules: conditionRules })) };
    }).sort((a, b) => a.name === "ทุกแผนก" ? -1 : b.name === "ทุกแผนก" ? 1 : a.name.localeCompare(b.name, "th"));
  }, [department, filteredRules]);

  useEffect(() => {
    if (loading || !logicalRules.length) return;
    const cycle = `${companyId ?? "default"}:${refreshKey}`;
    if (loadedCycle !== cycle) return;
    if (restoredCycle.current === cycle) return;
    restoredCycle.current = cycle;
    let stored: { ruleId: number; ruleKey?: string; departmentName?: string; savedAt?: number } | null = null;
    try { stored = JSON.parse(localStorage.getItem(focusStorageKey(companyId)) || "null"); } catch { stored = null; }
    if (!stored?.ruleId || (stored.savedAt && Date.now() - stored.savedAt > 7 * 24 * 60 * 60 * 1000)) return;
    const focusedRule = logicalRules.find((rule) =>
      (stored?.ruleKey && rule.key === stored.ruleKey)
      || rule.id === stored?.ruleId
      || rule.members.some((member) => member.id === stored?.ruleId),
    );
    if (!focusedRule) return;
    const availableDepartments = departmentLabels(focusedRule);
    const targetDepartment = stored.departmentName && availableDepartments.includes(stored.departmentName) ? stored.departmentName : availableDepartments[0];
    const token = ruleFocusToken(focusedRule.id, targetDepartment);
    setSearch(""); setQuery(""); setExpenseType(""); setPosition(""); setDepartment(targetDepartment); setStatus(focusedRule.is_active ? "active" : "all");
    setCollapsedDepartments((current) => { const next = new Set(current); next.delete(targetDepartment); return next; });
    setExpanded((current) => new Set([...current, focusedRule.key]));
    setHighlightedToken(token);
    setNotice(`กลับมาที่กฎล่าสุด “${focusedRule.name || "กฎอนุมัติ"}”`);
    let scrollAttempt = 0;
    const scrollWhenReady = () => {
      const element = document.getElementById(token);
      if (element) { element.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      scrollAttempt += 1;
      if (scrollAttempt < 20) window.setTimeout(scrollWhenReady, 100);
    };
    window.setTimeout(scrollWhenReady, 100);
    window.setTimeout(() => setHighlightedToken((current) => current === token ? null : current), 5000);
    window.setTimeout(() => setNotice((current) => current.startsWith("กลับมาที่กฎล่าสุด") ? "" : current), 4000);
  }, [companyId, loadedCycle, loading, logicalRules, refreshKey]);

  const conditionCount = departmentGroups.reduce((sum, group) => sum + group.conditions.length, 0);
  const maxSteps = filteredRules.reduce((maximum, rule) => Math.max(maximum, rule.steps.length), 0);

  const saveOrder = (next: string[]) => { setOrderedKeys(next); try { localStorage.setItem(orderStorageKey(companyId), JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const moveRule = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    const next = [...orderedKeys]; const from = next.indexOf(sourceKey); const to = next.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    next.splice(from, 1); next.splice(to, 0, sourceKey); saveOrder(next);
  };
  const reorderApprovalSteps = async (rule: LogicalRule, sourceIndex: number, targetIndex: number, departmentName?: string) => {
    if (sourceIndex === targetIndex || targetIndex < 0 || targetIndex >= rule.steps.length || reorderingRuleKey) return;
    const reordered = [...rule.steps];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const steps = reordered.map((step, index) => ({
      step_no: index + 1,
      name: step.name || undefined,
      target_type: step.target_type || "position",
      target_id: step.target_id ?? step.approver_position_id ?? null,
      approve_mode: step.approve_mode || "any",
      approver_position_id: step.approver_position_id ?? null,
    }));
    try { localStorage.setItem(focusStorageKey(companyId), JSON.stringify({ ruleId: rule.id, ruleKey: rule.key, departmentName: departmentName || departmentLabels(rule)[0], savedAt: Date.now() })); } catch { /* storage unavailable */ }
    setReorderingRuleKey(rule.key); setError(""); setNotice("");
    try {
      await Promise.all(rule.members.map((member) => rulesApi.update(member.id, { steps })));
      await load();
      onRulesChanged?.();
      setNotice(`อัปเดตลำดับผู้อนุมัติของ “${rule.name || "กฎอนุมัติ"}” แล้ว`);
      window.setTimeout(() => setNotice(""), 3000);
    } catch (reorderError) {
      setError(getApiErrorMessage(reorderError, "อัปเดตลำดับผู้อนุมัติไม่สำเร็จ"));
    } finally { setReorderingRuleKey(null); }
  };
  const clearFilters = () => { setSearch(""); setQuery(""); setDepartment(""); setExpenseType(""); setPosition(""); setStatus("active"); };
  const editRule = (rule: LogicalRule, departmentName: string) => {
    try {
      localStorage.setItem(focusStorageKey(companyId), JSON.stringify({ ruleId: rule.id, ruleKey: rule.key, departmentName, savedAt: Date.now() }));
    } catch { /* storage unavailable */ }
    onEditRule?.(rule.id, departmentName, rule.key);
  };

  return <div ref={flowTopRef} className="space-y-5">
    <Card className="overflow-hidden border-slate-200 shadow-lg dark:border-slate-800">
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-6 text-white sm:px-6"><div className="absolute -right-20 -top-24 h-60 w-60 rounded-full bg-blue-500/20 blur-3xl" /><div className="relative flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10"><GitBranch className="h-6 w-6 text-blue-200" /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black sm:text-2xl">ผังกฎการอนุมัติ</h2>{version && <span className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-black text-emerald-200">เวอร์ชัน {version.version_no} · ใช้งานอยู่</span>}</div><p className="mt-1 text-sm text-slate-300">แผนก → ประเภท/วงเงิน → กฎทั้งหมดของแผนก → ผู้อนุมัติแต่ละขั้น</p></div></div></div>
    </Card>

    <div className="grid gap-4 sm:grid-cols-3"><DataListKpiCard label="แผนกตามตัวกรอง" value={departmentGroups.length} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950" icon={Building2} /><DataListKpiCard label="ประเภท/ช่วงวงเงิน" value={conditionCount} tone="bg-cyan-100 text-cyan-700 dark:bg-cyan-950" icon={Layers3} /><DataListKpiCard label="กฎที่พบ" value={filteredRules.length} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-950" icon={Users} /></div>

    <Card><CardContent className="space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[minmax(0,1fr),200px,220px,240px,180px,auto] 2xl:items-end">
        <label className="min-w-0 text-sm font-bold">ค้นหา<div className="relative"><Search className="absolute left-3 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาแผนก กฎ วงเงิน หรือผู้อนุมัติ" className={`${dataListFilterControlClass} pl-10`} /></div></label>
        <DataListFilterSelect label="แผนก" value={department} allLabel="ทุกแผนก" options={departments.map((label) => ({ value: label, label }))} onChange={(value) => { setDepartment(value); if (value) setCollapsedDepartments((current) => { const next = new Set(current); next.delete(value); return next; }); }} />
        <DataListFilterSelect label="ประเภทการเบิก" value={expenseType} allLabel="ทุกประเภทการเบิก" options={expenseTypes.map((label) => ({ value: label, label }))} onChange={setExpenseType} />
        <DataListFilterSelect label="ตำแหน่งผู้ขอ" value={position} allLabel="ทุกตำแหน่งผู้ขอ" options={positions.map((label) => ({ value: label, label }))} onChange={setPosition} />
        <DataListFilterSelect label="สถานะ" value={status} allLabel="ทุกสถานะ" options={[{ value: "active", label: "เปิดใช้งาน" }, { value: "all", label: "ทุกสถานะ" }]} onChange={setStatus} allowEmpty={false} />
        <div className="flex gap-2"><button type="button" onClick={clearFilters} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold hover:bg-muted"><Eraser className="h-4 w-4" />ล้างตัวกรอง</button><button type="button" onClick={load} disabled={loading} className="inline-flex h-12 w-12 items-center justify-center rounded-xl border hover:bg-muted disabled:opacity-50" aria-label="รีเฟรช"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><p>พบ {filteredRules.length.toLocaleString("th-TH")} กฎ · วงเงินแสดงบนการ์ดทุกกฎ</p><div className="flex items-center gap-1"><button type="button" onClick={() => { setCollapsedDepartments(new Set()); setExpanded(new Set(filteredRules.map((rule) => rule.key))); }} className="rounded-lg px-2 py-1.5 font-bold hover:bg-background">เปิดทั้งหมด</button><span>·</span><button type="button" onClick={() => { setCollapsedDepartments(new Set(departmentGroups.map((group) => group.name))); setExpanded(new Set()); }} className="rounded-lg px-2 py-1.5 font-bold hover:bg-background">ย่อทั้งหมด</button></div></div>
    </CardContent></Card>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</div>}
    {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-semibold text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />กำลังจัดผังกฎอนุมัติ...</div> : !version ? <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">ยังไม่มีเวอร์ชันกฎอนุมัติ</div> : !departmentGroups.length ? <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">ไม่พบกฎตามตัวกรอง</div> : <div className="space-y-5">{departmentGroups.map((departmentGroup) => {
      const collapsed = collapsedDepartments.has(departmentGroup.name);
      const departmentRules = departmentGroup.conditions.flatMap((condition) => condition.rules);
      return <section key={departmentGroup.name} className="overflow-hidden rounded-3xl border border-indigo-100 bg-card shadow-sm dark:border-indigo-950">
        <button type="button" onClick={() => setCollapsedDepartments((current) => { const next = new Set(current); next.has(departmentGroup.name) ? next.delete(departmentGroup.name) : next.add(departmentGroup.name); return next; })} aria-expanded={!collapsed} className="flex w-full items-center gap-4 bg-gradient-to-r from-indigo-50 via-blue-50/70 to-transparent p-4 text-left hover:from-indigo-100/80 dark:from-indigo-950/60 dark:via-blue-950/30 sm:p-5"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white"><Building2 className="h-6 w-6" /></div><div className="min-w-0 flex-1"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">แผนก</p><h3 className="truncate text-xl font-black">{departmentGroup.name}</h3></div><div className="hidden gap-2 sm:flex"><span className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-black text-cyan-700 dark:bg-slate-900">{departmentGroup.conditions.length} เงื่อนไข</span><span className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-black text-indigo-700 dark:bg-slate-900">{departmentRules.length} กฎ</span></div>{collapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}</button>
        {!collapsed && <div className="space-y-4 border-t border-indigo-100 bg-slate-50/40 p-3 dark:border-indigo-950 dark:bg-slate-950/20 sm:p-4">{departmentGroup.conditions.map((condition) => <div key={`${departmentGroup.name}:${condition.key}`} className="overflow-hidden rounded-2xl border border-cyan-100 bg-white/70 dark:border-cyan-950 dark:bg-slate-900/40">
          <div className="flex flex-col gap-3 border-b border-cyan-100 bg-gradient-to-r from-cyan-50 to-amber-50/50 p-4 dark:border-cyan-950 dark:from-cyan-950/40 dark:to-amber-950/20 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white"><Tags className="h-5 w-5" /></div><div><p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">ประเภท / วงเงิน</p><h4 className="text-base font-black">{condition.expenseType}</h4></div></div><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200"><Banknote className="h-3.5 w-3.5" />{condition.amount}</span>{condition.requestKind && <span className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-200">{kindLabels[condition.requestKind] || condition.requestKind}</span>}<span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{condition.rules.length} กฎ</span></div></div>
          <div className="space-y-3 p-3 sm:p-4"><p className="px-1 text-xs font-black text-muted-foreground">กฎทั้งหมดที่ตรงกับประเภทและวงเงินนี้ · คลิกเพื่อแก้ไข หรือลากก้อนผู้อนุมัติเพื่ออัปเดตลำดับ</p>{condition.rules.map((rule, index) => { const focusToken = ruleFocusToken(rule.id, departmentGroup.name); return <RuleCard key={`${departmentGroup.name}:${condition.key}:${rule.key}`} rule={rule} departmentName={departmentGroup.name} index={index} total={condition.rules.length} expanded={expanded.has(rule.key)} dragging={draggingKey === rule.key} reordering={reorderingRuleKey === rule.key} highlighted={highlightedToken === focusToken} focusToken={focusToken} onEdit={() => editRule(rule, departmentGroup.name)} onToggle={() => setExpanded((current) => { const next = new Set(current); next.has(rule.key) ? next.delete(rule.key) : next.add(rule.key); return next; })} onMove={(direction) => { const target = condition.rules[index + direction]; if (target) moveRule(rule.key, target.key); }} onReorderSteps={(sourceIndex, targetIndex) => reorderApprovalSteps(rule, sourceIndex, targetIndex, departmentGroup.name)} onDragStart={() => setDraggingKey(rule.key)} onDragEnd={() => setDraggingKey(null)} onDrop={() => { if (draggingKey && condition.rules.some((item) => item.key === draggingKey)) moveRule(draggingKey, rule.key); setDraggingKey(null); }} />; })}</div>
        </div>)}</div>}
      </section>;
    })}</div>}
    {maxSteps > 0 && <p className="text-right text-xs text-muted-foreground">สายอนุมัติที่ยาวที่สุดตามตัวกรอง: {maxSteps} ขั้น</p>}
    <div ref={flowBottomRef} aria-hidden="true" />
    <div className="fixed bottom-20 right-3 z-40 flex flex-col gap-2 sm:right-5" aria-label="ทางลัดเลื่อนผังกฎ">
      <button type="button" onClick={() => flowTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="group inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 bg-slate-950/90 px-3 text-xs font-black text-white shadow-xl backdrop-blur transition hover:-translate-y-0.5 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" aria-label="เลื่อนไปบนสุด" title="เลื่อนไปบนสุด"><ArrowUpToLine className="h-4 w-4" /><span className="hidden lg:inline">บนสุด</span></button>
      <button type="button" onClick={() => flowBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} className="group inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 bg-slate-950/90 px-3 text-xs font-black text-white shadow-xl backdrop-blur transition hover:translate-y-0.5 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" aria-label="เลื่อนไปล่างสุด" title="เลื่อนไปล่างสุด"><ArrowDownToLine className="h-4 w-4" /><span className="hidden lg:inline">ล่างสุด</span></button>
    </div>
  </div>;
}
