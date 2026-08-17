import { FormEvent, useEffect, useState } from "react";
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
import { ApprovalMatrixPage } from "@/pages/ApprovalMatrixPage";

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

export function ExpenseSettingsPage() {
  const [tab, setTab] = useState<"types" | "workflow">("types");
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [selectedType, setSelectedType] = useState<number>();
  const [requirements, setRequirements] = useState<AttachmentRequirement[]>([]);
  const [editingRequirement, setEditingRequirement] = useState<AttachmentRequirement | null>(null);
  const [requirementDraft, setRequirementDraft] = useState<RequirementDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const loadTypes = async () => {
    const rows = await expenseTypesApi.list();
    setTypes(rows);
    setSelectedType((current) => current ?? rows[0]?.id);
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
              <h2 className="mb-3 font-semibold">ประเภทค่าใช้จ่าย</h2>
              <div className="space-y-2">
                {types.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setSelectedType(type.id)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      selectedType === type.id ? "border-primary bg-primary/5" : "hover:bg-muted"
                    }`}
                  >
                    <p className="font-medium">{type.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {type.code} · เคลียร์ภายใน {type.settlement_days} วัน
                    </p>
                  </button>
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
        <div className="-mx-6 -mt-4">
          <ApprovalMatrixPage />
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
            <form className="space-y-5" onSubmit={saveRequirement}>
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
    </div>
  );
}
