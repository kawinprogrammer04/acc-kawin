import { FormEvent, ReactNode, useEffect, useState } from "react";
import { FileCheck2, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { expenseSettingsApi, expenseTypesApi } from "@/api/approvals";
import type { AttachmentRequirement, ExpenseType } from "@/api/approvals";
import { getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApprovalRuleFlow } from "@/components/expense/ApprovalRuleFlow";
import { useCompany } from "@/context/CompanyContext";
import { HrStyleApprovalSettings } from "@/pages/HrStyleApprovalSettings";
import type { ApprovalRuleEditRequest } from "@/pages/HrStyleApprovalSettings";

const MIME_OPTIONS = [
  { value: "application/pdf", label: "PDF" },
  { value: "image/jpeg", label: "JPG / JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "application/msword", label: "DOC" },
  { value: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX" },
  { value: "application/vnd.ms-excel", label: "XLS" },
  { value: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "XLSX" },
] as const;

type RequirementDraft = {
  code: string;
  name: string;
  description: string;
  is_required: boolean;
  requires_signature: boolean;
  allowed_mime_types: string[];
  max_file_size_mb: number;
  sort_order: number;
};

const blankRequirement = (sortOrder: number): RequirementDraft => ({
  code: `DOC_${Date.now()}`,
  name: "",
  description: "",
  is_required: true,
  requires_signature: false,
  allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
  max_file_size_mb: 10,
  sort_order: sortOrder,
});

const requirementToDraft = (requirement: AttachmentRequirement): RequirementDraft => ({
  code: requirement.code,
  name: requirement.name,
  description: requirement.description ?? "",
  is_required: requirement.is_required,
  requires_signature: requirement.requires_signature,
  allowed_mime_types: [...requirement.allowed_mime_types],
  max_file_size_mb: Math.max(1, Math.round(requirement.max_file_size / 1048576)),
  sort_order: requirement.sort_order,
});

const KIND_OPTIONS = [
  { value: "reimbursement", label: "เบิกค่าใช้จ่าย (คืนเงินภายหลัง)" },
  { value: "advance", label: "ขอเงินทดรอง (สำรองจ่ายล่วงหน้า)" },
  { value: "direct_payment", label: "ชำระตรงให้ผู้ขาย" },
] as const;

type TypeDraft = {
  code: string;
  name: string;
  description: string;
  allowed_kinds: string[];
  requires_payment_proof: boolean;
  may_require_withholding_tax: boolean;
  settlement_days: number;
  is_active: boolean;
};

const blankType = (): TypeDraft => ({
  code: "",
  name: "",
  description: "",
  allowed_kinds: ["reimbursement", "advance"],
  requires_payment_proof: true,
  may_require_withholding_tax: true,
  settlement_days: 7,
  is_active: true,
});

const typeToDraft = (type: ExpenseType): TypeDraft => ({
  code: type.code,
  name: type.name,
  description: type.description ?? "",
  allowed_kinds: [...type.allowed_kinds],
  requires_payment_proof: type.requires_payment_proof,
  may_require_withholding_tax: type.may_require_withholding_tax,
  settlement_days: type.settlement_days,
  is_active: type.is_active,
});

function FieldSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function ExpenseSettingsPage() {
  const { currentCompany } = useCompany();
  const [tab, setTab] = useState<"types" | "workflow">("workflow");
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [selectedType, setSelectedType] = useState<number>();
  const [requirements, setRequirements] = useState<AttachmentRequirement[]>([]);
  const [editingRequirement, setEditingRequirement] = useState<AttachmentRequirement | null>(null);
  const [requirementDraft, setRequirementDraft] = useState<RequirementDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [editingType, setEditingType] = useState<ExpenseType | null>(null);
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [deletingTypeId, setDeletingTypeId] = useState<number | null>(null);
  const [togglingTypeId, setTogglingTypeId] = useState<number | null>(null);
  const [typeDialogError, setTypeDialogError] = useState<string | null>(null);
  const [ruleEditRequest, setRuleEditRequest] = useState<ApprovalRuleEditRequest | null>(null);
  const [ruleFlowRevision, setRuleFlowRevision] = useState(0);

  const rememberRuleFocus = (ruleId: number, departmentName?: string, ruleKey?: string) => {
    try {
      localStorage.setItem(
        `expense_settings_last_rule_focus:${currentCompany?.id ?? "default"}`,
        JSON.stringify({ ruleId, ruleKey, departmentName, savedAt: Date.now() }),
      );
    } catch { /* browser storage may be unavailable */ }
  };

  const loadTypes = async () => {
    const rows: ExpenseType[] = await expenseTypesApi.list();
    setTypes(rows);
    setSelectedType((current) =>
      current && rows.some((row) => row.id === current) ? current : rows[0]?.id,
    );
  };

  const loadRequirements = async (typeId: number) => {
    setRequirements(await expenseSettingsApi.requirements(typeId));
  };

  useEffect(() => {
    loadTypes().catch((error) =>
      setMessage({ type: "error", text: getApiErrorMessage(error, "โหลดประเภทค่าใช้จ่ายไม่สำเร็จ") }),
    );
  }, []);

  useEffect(() => {
    if (!selectedType) {
      setRequirements([]);
      return;
    }
    loadRequirements(selectedType).catch((error) =>
      setMessage({ type: "error", text: getApiErrorMessage(error, "โหลดรายการเอกสารไม่สำเร็จ") }),
    );
  }, [selectedType]);

  const openCreateRequirement = () => {
    setEditingRequirement(null);
    setRequirementDraft(blankRequirement(requirements.length + 1));
    setMessage(null);
    setDialogError(null);
  };

  const openEditRequirement = (requirement: AttachmentRequirement) => {
    setEditingRequirement(requirement);
    setRequirementDraft(requirementToDraft(requirement));
    setMessage(null);
    setDialogError(null);
  };

  const closeRequirementDialog = () => {
    if (saving) return;
    setRequirementDraft(null);
    setEditingRequirement(null);
    setDialogError(null);
  };

  const toggleMimeType = (mimeType: string, checked: boolean) => {
    setRequirementDraft((current) => {
      if (!current) return current;
      const allowed = checked
        ? [...new Set([...current.allowed_mime_types, mimeType])]
        : current.allowed_mime_types.filter((item) => item !== mimeType);
      return { ...current, allowed_mime_types: allowed };
    });
  };

  const saveRequirement = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedType || !requirementDraft) return;
    if (!requirementDraft.name.trim()) {
      setDialogError("กรุณาระบุชื่อเอกสาร");
      return;
    }
    if (!requirementDraft.allowed_mime_types.length) {
      setDialogError("กรุณาเลือกชนิดไฟล์อย่างน้อย 1 ชนิด");
      return;
    }

    setSaving(true);
    setMessage(null);
    setDialogError(null);
    const payload = {
      code: requirementDraft.code,
      name: requirementDraft.name.trim(),
      description: requirementDraft.description.trim() || null,
      is_required: requirementDraft.is_required,
      requires_signature: requirementDraft.requires_signature,
      allowed_mime_types: requirementDraft.allowed_mime_types,
      max_file_size: requirementDraft.max_file_size_mb * 1048576,
      sort_order: requirementDraft.sort_order,
      is_active: true,
    };

    try {
      if (editingRequirement) {
        await expenseSettingsApi.updateRequirement(selectedType, editingRequirement.id, payload);
      } else {
        await expenseSettingsApi.createRequirement(selectedType, payload);
      }
      await loadRequirements(selectedType);
      setRequirementDraft(null);
      setEditingRequirement(null);
      setMessage({ type: "success", text: editingRequirement ? "แก้ไขเอกสารแล้ว" : "เพิ่มเอกสารแล้ว" });
    } catch (error) {
      setDialogError(getApiErrorMessage(error, "บันทึกเอกสารไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  const deleteRequirement = async (requirement: AttachmentRequirement) => {
    if (!selectedType) return;
    if (!window.confirm(`ลบเอกสาร “${requirement.name}” ออกจากประเภทนี้หรือไม่?\nไฟล์ที่เคยแนบไว้จะไม่ถูกลบ`)) return;

    setDeletingId(requirement.id);
    setMessage(null);
    try {
      await expenseSettingsApi.deleteRequirement(selectedType, requirement.id);
      await loadRequirements(selectedType);
      setMessage({ type: "success", text: "ลบเอกสารออกจากประเภทนี้แล้ว" });
    } catch (error) {
      setMessage({ type: "error", text: getApiErrorMessage(error, "ลบเอกสารไม่สำเร็จ") });
    } finally {
      setDeletingId(null);
    }
  };

  const openCreateType = () => {
    setEditingType(null);
    setTypeDraft(blankType());
    setMessage(null);
    setTypeDialogError(null);
  };

  const openEditType = (type: ExpenseType) => {
    setEditingType(type);
    setTypeDraft(typeToDraft(type));
    setMessage(null);
    setTypeDialogError(null);
  };

  const closeTypeDialog = () => {
    if (savingType) return;
    setTypeDraft(null);
    setEditingType(null);
    setTypeDialogError(null);
  };

  const toggleAllowedKind = (kind: string, checked: boolean) => {
    setTypeDraft((current) => {
      if (!current) return current;
      const allowed = checked
        ? [...new Set([...current.allowed_kinds, kind])]
        : current.allowed_kinds.filter((item) => item !== kind);
      return { ...current, allowed_kinds: allowed };
    });
  };

  const saveType = async (event: FormEvent) => {
    event.preventDefault();
    if (!typeDraft) return;
    if (!typeDraft.code.trim() || !typeDraft.name.trim()) {
      setTypeDialogError("กรุณาระบุรหัสและชื่อประเภทค่าใช้จ่าย");
      return;
    }
    if (!typeDraft.allowed_kinds.length) {
      setTypeDialogError("กรุณาเลือกรูปแบบการเบิกอย่างน้อย 1 แบบ");
      return;
    }

    setSavingType(true);
    setMessage(null);
    setTypeDialogError(null);
    const payload = {
      code: typeDraft.code.trim(),
      name: typeDraft.name.trim(),
      description: typeDraft.description.trim() || null,
      allowed_kinds: typeDraft.allowed_kinds,
      requires_payment_proof: typeDraft.requires_payment_proof,
      may_require_withholding_tax: typeDraft.may_require_withholding_tax,
      settlement_days: typeDraft.settlement_days,
      is_active: typeDraft.is_active,
    };

    try {
      if (editingType) {
        await expenseTypesApi.update(editingType.id, payload);
      } else {
        const created = await expenseTypesApi.create(payload);
        setSelectedType(created.id);
      }
      await loadTypes();
      setTypeDraft(null);
      setEditingType(null);
      setMessage({ type: "success", text: editingType ? "แก้ไขประเภทค่าใช้จ่ายแล้ว" : "เพิ่มประเภทค่าใช้จ่ายแล้ว" });
    } catch (error) {
      setTypeDialogError(getApiErrorMessage(error, "บันทึกประเภทค่าใช้จ่ายไม่สำเร็จ"));
    } finally {
      setSavingType(false);
    }
  };

  const deleteType = async (type: ExpenseType) => {
    if (!window.confirm(`ลบประเภทค่าใช้จ่าย “${type.name}” หรือไม่?\nหากเคยมีการใช้เบิกด้วยประเภทนี้แล้ว ระบบจะปิดการใช้งานแทนการลบถาวร`)) return;

    setDeletingTypeId(type.id);
    setMessage(null);
    try {
      const result = await expenseTypesApi.delete(type.id);
      await loadTypes();
      setMessage({
        type: "success",
        text: result.deactivated
          ? `ประเภท “${type.name}” เคยถูกใช้เบิกแล้ว ระบบจึงปิดการใช้งานแทนการลบ`
          : `ลบประเภท “${type.name}” แล้ว`,
      });
    } catch (error) {
      setMessage({ type: "error", text: getApiErrorMessage(error, "ลบประเภทค่าใช้จ่ายไม่สำเร็จ") });
    } finally {
      setDeletingTypeId(null);
    }
  };

  const toggleTypeActive = async (type: ExpenseType, checked: boolean) => {
    setTogglingTypeId(type.id);
    setMessage(null);
    try {
      await expenseTypesApi.update(type.id, { is_active: checked });
      await loadTypes();
      setMessage({
        type: "success",
        text: checked ? `เปิดใช้งานประเภท “${type.name}” แล้ว` : `ปิดใช้งานประเภท “${type.name}” แล้ว`,
      });
    } catch (error) {
      setMessage({ type: "error", text: getApiErrorMessage(error, "เปลี่ยนสถานะไม่สำเร็จ") });
    } finally {
      setTogglingTypeId(null);
    }
  };

  const tabs = [
    { key: "types", label: "ประเภทและเอกสาร", icon: FileCheck2 },
    { key: "workflow", label: "กฎอนุมัติและมอบหมาย", icon: Workflow },
  ] as const;

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold">ตั้งค่าระบบเบิก</h1>
        <p className="text-sm text-muted-foreground">ตั้งค่าประเภท เอกสารบังคับ กฎการอนุมัติ และการมอบหมาย</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              tab === key ? "bg-primary text-primary-foreground" : "border hover:bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {message && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {tab === "types" && (
        <div className="grid gap-5 lg:grid-cols-[320px,1fr]">
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-semibold">ประเภทค่าใช้จ่าย</h2>
                <Button size="sm" onClick={openCreateType}>
                  <Plus className="h-4 w-4" />
                  เพิ่มประเภท
                </Button>
              </div>
              <div className="space-y-2">
                {!types.length && (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    ยังไม่มีประเภทค่าใช้จ่าย
                  </div>
                )}
                {types.map((type) => (
                  <div
                    key={type.id}
                    className={`w-full rounded-lg border p-3 ${
                      selectedType === type.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <button onClick={() => setSelectedType(type.id)} className="w-full text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{type.name}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            type.is_active
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {type.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {type.code} · เคลียร์ภายใน {type.settlement_days} วัน
                      </p>
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={type.is_active}
                          disabled={togglingTypeId === type.id}
                          onCheckedChange={(checked) => toggleTypeActive(type, checked)}
                        />
                        {type.is_active ? "ใช้งานได้" : "ปิดไว้ ไม่ให้เลือกในคำขอใหม่"}
                      </label>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditType(type)}>
                          <Pencil className="h-4 w-4" />
                          แก้ไข
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deletingTypeId === type.id}
                          onClick={() => deleteType(type)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {deletingTypeId === type.id ? "กำลังลบ" : "ลบ"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">เอกสารที่ต้องแนบ</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    กำหนดเอกสารประกอบแยกตามประเภทค่าใช้จ่าย
                  </p>
                </div>
                <Button onClick={openCreateRequirement} disabled={!selectedType}>
                  <Plus className="h-4 w-4" />
                  เพิ่มเอกสาร
                </Button>
              </div>

              <div className="space-y-3">
                {!requirements.length && (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    ยังไม่ได้กำหนดเอกสารสำหรับประเภทนี้
                  </div>
                )}
                {requirements.map((doc) => (
                  <div key={doc.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{doc.name}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {doc.is_required ? "บังคับ" : "ไม่บังคับ"}
                          </span>
                        </div>
                        {doc.description && <p className="mt-1 text-xs text-muted-foreground">{doc.description}</p>}
                        <p className="mt-2 text-xs text-muted-foreground">
                          {doc.requires_signature ? "ต้องวางลายเซ็น" : "ไม่ต้องลงลายเซ็น"} · สูงสุด{" "}
                          {Math.round(doc.max_file_size / 1048576)} MB
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          ชนิดไฟล์: {doc.allowed_mime_types.map((mime) => MIME_OPTIONS.find((item) => item.value === mime)?.label ?? mime).join(", ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditRequirement(doc)}>
                          <Pencil className="h-4 w-4" />
                          แก้ไข
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deletingId === doc.id}
                          onClick={() => deleteRequirement(doc)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {deletingId === doc.id ? "กำลังลบ" : "ลบ"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "workflow" && (
        <div className="-mx-6 -mt-4 space-y-6">
          <div className="px-6 pt-6">
            <ApprovalRuleFlow
              companyId={currentCompany?.id}
              refreshKey={ruleFlowRevision}
              onEditRule={(ruleId, departmentName, ruleKey) => {
                rememberRuleFocus(ruleId, departmentName, ruleKey);
                setRuleEditRequest({ ruleId, nonce: Date.now() });
              }}
              onRulesChanged={() => setRuleFlowRevision((current) => current + 1)}
            />
          </div>
          <HrStyleApprovalSettings
            editRuleRequest={ruleEditRequest}
            onRulesChanged={() => setRuleFlowRevision((current) => current + 1)}
            refreshKey={ruleFlowRevision}
            onEditStarted={(ruleId) => rememberRuleFocus(ruleId)}
            showList={false}
          />
        </div>
      )}

      <Dialog open={!!requirementDraft} onOpenChange={(open) => !open && closeRequirementDialog()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRequirement ? "แก้ไขเอกสารที่ต้องแนบ" : "เพิ่มเอกสารที่ต้องแนบ"}</DialogTitle>
            <DialogDescription>
              การตั้งค่านี้ใช้ตรวจเอกสารก่อนพนักงานส่งคำขออนุมัติ
            </DialogDescription>
          </DialogHeader>

          {requirementDraft && (
            <form onSubmit={saveRequirement}>
            <div className="space-y-5 p-6 pt-4">
              {dialogError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {dialogError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="requirement-name">ชื่อเอกสาร *</Label>
                <Input
                  id="requirement-name"
                  value={requirementDraft.name}
                  maxLength={200}
                  required
                  autoFocus
                  onChange={(event) => setRequirementDraft({ ...requirementDraft, name: event.target.value })}
                  placeholder="เช่น ใบเสร็จรับเงิน / ใบกำกับภาษี"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="requirement-description">คำอธิบาย</Label>
                <textarea
                  id="requirement-description"
                  value={requirementDraft.description}
                  maxLength={2000}
                  onChange={(event) => setRequirementDraft({ ...requirementDraft, description: event.target.value })}
                  className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="คำแนะนำสำหรับพนักงาน (ถ้ามี)"
                />
              </div>

              <div className="space-y-2">
                <Label>ชนิดไฟล์ที่อนุญาต *</Label>
                <div className="flex flex-wrap gap-2">
                  {MIME_OPTIONS.map((mime) => {
                    const checked = requirementDraft.allowed_mime_types.includes(mime.value);
                    return (
                      <label
                        key={mime.value}
                        className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          checked ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(event) => toggleMimeType(mime.value, event.target.checked)}
                        />
                        {mime.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="max-w-48 space-y-2">
                <Label htmlFor="requirement-size">ขนาดสูงสุด (MB) *</Label>
                <Input
                  id="requirement-size"
                  type="number"
                  min={1}
                  max={10}
                  required
                  value={requirementDraft.max_file_size_mb}
                  onChange={(event) =>
                    setRequirementDraft({ ...requirementDraft, max_file_size_mb: Number(event.target.value) })
                  }
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <span>
                    <span className="block text-sm font-medium">เอกสารบังคับ</span>
                    <span className="block text-xs text-muted-foreground">ต้องมีไฟล์ก่อนส่งอนุมัติ</span>
                  </span>
                  <Switch
                    checked={requirementDraft.is_required}
                    onCheckedChange={(checked) => setRequirementDraft({ ...requirementDraft, is_required: checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <span>
                    <span className="block text-sm font-medium">ต้องลงลายเซ็น</span>
                    <span className="block text-xs text-muted-foreground">นำไฟล์เข้าพื้นที่วางลายเซ็น</span>
                  </span>
                  <Switch
                    checked={requirementDraft.requires_signature}
                    onCheckedChange={(checked) =>
                      setRequirementDraft({
                        ...requirementDraft,
                        requires_signature: checked,
                        allowed_mime_types:
                          checked && !requirementDraft.allowed_mime_types.includes("application/pdf")
                            ? ["application/pdf", ...requirementDraft.allowed_mime_types]
                            : requirementDraft.allowed_mime_types,
                      })
                    }
                  />
                </label>
              </div>
            </div>

              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={closeRequirementDialog}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "กำลังบันทึก..." : "บันทึก"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!typeDraft} onOpenChange={(open) => !open && closeTypeDialog()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingType ? "แก้ไขประเภทค่าใช้จ่าย" : "เพิ่มประเภทค่าใช้จ่าย"}</DialogTitle>
            <DialogDescription>ใช้กำหนดรูปแบบการเบิกและระยะเวลาเคลียร์เงินของประเภทนี้</DialogDescription>
          </DialogHeader>

          {typeDraft && (
            <form onSubmit={saveType}>
            <div className="space-y-6 p-6 pt-4">
              {typeDialogError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {typeDialogError}
                </div>
              )}

              <FieldSection title="ข้อมูลพื้นฐาน" subtitle="รหัสและชื่อที่จะแสดงให้พนักงานเลือกตอนสร้างคำขอเบิก">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="type-code">รหัสประเภท *</Label>
                    <Input
                      id="type-code"
                      value={typeDraft.code}
                      maxLength={50}
                      required
                      autoFocus
                      onChange={(event) => setTypeDraft({ ...typeDraft, code: event.target.value })}
                      placeholder="เช่น TRAVEL"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type-name">ชื่อประเภท *</Label>
                    <Input
                      id="type-name"
                      value={typeDraft.name}
                      maxLength={150}
                      required
                      onChange={(event) => setTypeDraft({ ...typeDraft, name: event.target.value })}
                      placeholder="เช่น ค่าเดินทาง"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type-description">คำอธิบาย</Label>
                  <textarea
                    id="type-description"
                    value={typeDraft.description}
                    maxLength={2000}
                    onChange={(event) => setTypeDraft({ ...typeDraft, description: event.target.value })}
                    className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="คำแนะนำสำหรับพนักงานเมื่อเลือกประเภทนี้ (ถ้ามี)"
                  />
                </div>
              </FieldSection>

              <div className="border-t pt-6">
                <FieldSection title="เงื่อนไขการเบิก" subtitle="รูปแบบคำขอที่ใช้ประเภทนี้ได้ และกำหนดเวลาส่งเคลียร์เงิน">
                  <div className="space-y-2">
                    <Label>รูปแบบการเบิกที่ใช้ได้ *</Label>
                    <div className="flex flex-wrap gap-2">
                      {KIND_OPTIONS.map((kind) => {
                        const checked = typeDraft.allowed_kinds.includes(kind.value);
                        return (
                          <label
                            key={kind.value}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                              checked ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={(event) => toggleAllowedKind(kind.value, event.target.checked)}
                            />
                            {kind.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="max-w-48 space-y-2">
                    <Label htmlFor="type-settlement-days">เคลียร์เงินภายใน (วัน) *</Label>
                    <Input
                      id="type-settlement-days"
                      type="number"
                      min={0}
                      max={365}
                      required
                      value={typeDraft.settlement_days}
                      onChange={(event) =>
                        setTypeDraft({ ...typeDraft, settlement_days: Number(event.target.value) })
                      }
                    />
                  </div>
                </FieldSection>
              </div>

              <div className="border-t pt-6">
                <FieldSection title="เอกสารและภาษี" subtitle="เงื่อนไขที่ระบบใช้ตรวจก่อนอนุมัติและเคลียร์เงิน">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <span>
                        <span className="block text-sm font-medium">ต้องมีหลักฐานการจ่าย</span>
                        <span className="block text-xs text-muted-foreground">บังคับแนบสลิป/ใบเสร็จก่อนเคลียร์</span>
                      </span>
                      <Switch
                        checked={typeDraft.requires_payment_proof}
                        onCheckedChange={(checked) =>
                          setTypeDraft({ ...typeDraft, requires_payment_proof: checked })
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <span>
                        <span className="block text-sm font-medium">อาจต้องหัก ณ ที่จ่าย</span>
                        <span className="block text-xs text-muted-foreground">ให้ผู้ขอระบุสถานะหักภาษีเอง</span>
                      </span>
                      <Switch
                        checked={typeDraft.may_require_withholding_tax}
                        onCheckedChange={(checked) =>
                          setTypeDraft({ ...typeDraft, may_require_withholding_tax: checked })
                        }
                      />
                    </label>
                  </div>
                </FieldSection>
              </div>

              {editingType && (
                <div className="border-t pt-6">
                  <FieldSection title="สถานะการใช้งาน">
                    <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <span>
                        <span className="block text-sm font-medium">เปิดใช้งาน</span>
                        <span className="block text-xs text-muted-foreground">
                          ปิดไว้เพื่อไม่ให้เลือกประเภทนี้ในคำขอเบิกใหม่ โดยไม่กระทบคำขอเดิมที่เคยใช้แล้ว
                        </span>
                      </span>
                      <Switch
                        checked={typeDraft.is_active}
                        onCheckedChange={(checked) => setTypeDraft({ ...typeDraft, is_active: checked })}
                      />
                    </label>
                  </FieldSection>
                </div>
              )}
            </div>

              <DialogFooter>
                <Button type="button" variant="outline" disabled={savingType} onClick={closeTypeDialog}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={savingType}>
                  {savingType ? "กำลังบันทึก..." : "บันทึก"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
