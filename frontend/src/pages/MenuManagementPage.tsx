import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  BookOpen,
  Building2,
  Calendar,
  Check,
  ClipboardList,
  CreditCard,
  FileBarChart,
  FolderOpen,
  GripVertical,
  HelpingHand,
  LayoutDashboard,
  ListTree,
  Loader2,
  Package,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  Save,
  Settings,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { Can } from "@/components/auth/RequirePermission";
import { useAuth } from "@/context/AuthContext";
import { api, getApiErrorMessage } from "@/api/client";
import type { AppMenu } from "@/types";

const emptyForm = {
  key: "",
  label: "",
  path: "",
  icon: "LayoutDashboard",
  group_key: "cashflow",
  group_label: "กระแสเงินสด",
  description: "",
  sort_order: 0,
  is_active: true,
  is_system: false,
};

type MenuForm = typeof emptyForm;

const ICON_OPTIONS = [
  { value: "LayoutDashboard", label: "แดชบอร์ด" },
  { value: "ArrowUpCircle", label: "รายรับ" },
  { value: "ArrowDownCircle", label: "รายจ่าย" },
  { value: "CreditCard", label: "บัตร / เจ้าหนี้" },
  { value: "HelpingHand", label: "ลูกหนี้" },
  { value: "Calendar", label: "ปฏิทิน" },
  { value: "Wallet", label: "กระเป๋าเงิน" },
  { value: "Package", label: "กล่อง / Holder" },
  { value: "ArrowLeftRight", label: "โอนเงิน" },
  { value: "Tag", label: "หมวดหมู่" },
  { value: "FileBarChart", label: "รายงาน" },
  { value: "FolderOpen", label: "เอกสาร" },
  { value: "Receipt", label: "ใบกำกับภาษี" },
  { value: "PiggyBank", label: "งบประมาณ" },
  { value: "ClipboardList", label: "รายการ / Log" },
  { value: "Building2", label: "บริษัท" },
  { value: "Users", label: "ผู้ใช้งาน" },
  { value: "Settings", label: "ตั้งค่า" },
  { value: "ShieldCheck", label: "สิทธิ์" },
  { value: "ListTree", label: "เมนู" },
  { value: "BookOpen", label: "บัญชี" },
] as const;

const ICON_COMPONENTS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  ArrowUpCircle,
  ArrowDownCircle,
  CreditCard,
  HelpingHand,
  Calendar,
  Wallet,
  Package,
  ArrowLeftRight,
  Tag,
  FileBarChart,
  FolderOpen,
  Receipt,
  PiggyBank,
  ClipboardList,
  Building2,
  Users,
  Settings,
  ShieldCheck,
  ListTree,
  BookOpen,
};

const LUCIDE_ICON_COMPONENTS = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

function getIconComponent(iconName: string) {
  return ICON_COMPONENTS[iconName] ?? LUCIDE_ICON_COMPONENTS[iconName] ?? ListTree;
}

export function MenuManagementPage() {
  const { refreshUser } = useAuth();
  const [menus, setMenus] = useState<AppMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppMenu | null>(null);
  const [form, setForm] = useState<MenuForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);
  const [dragOverGroupKey, setDragOverGroupKey] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<{ key: string; label: string } | null>(null);
  const [groupLabel, setGroupLabel] = useState("");
  const [alertDialog, setAlertDialog] = useState<{ title: string; message: string } | null>(null);
  const [groupMode, setGroupMode] = useState<"existing" | "new" | "none">("existing");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");

  function showAlert(title: string, message: string) {
    setAlertDialog({ title, message });
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/permissions/menus");
      setMenus(sortMenus(res.data));
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groupedMenus = useMemo(() => {
    const groups = new Map<string, { label: string; rows: AppMenu[] }>();
    sortMenus(menus).forEach(menu => {
      const key = menu.group_key ?? "";
      if (!groups.has(key)) groups.set(key, { label: menu.group_label || "ไม่มีกลุ่ม", rows: [] });
      groups.get(key)?.rows.push(menu);
    });
    return Array.from(groups.entries());
  }, [menus]);

  const groupOptions = useMemo(() => (
    groupedMenus
      .filter(([key]) => Boolean(key))
      .map(([key, group]) => ({ key, label: group.label }))
  ), [groupedMenus]);

  function openAdd() {
    const nextSort = menus.length ? Math.max(...menus.map(menu => menu.sort_order)) + 10 : 10;
    const firstGroup = groupOptions[0] ?? { key: "cashflow", label: "กระแสเงินสด" };
    setEditing(null);
    setForm({
      ...emptyForm,
      key: "",
      group_key: firstGroup.key,
      group_label: firstGroup.label,
      sort_order: nextSort,
    });
    setGroupMode("existing");
    setShowAdvanced(false);
    setIconPickerOpen(false);
    setIconSearch("");
    setError("");
    setShowForm(true);
  }

  function openEdit(menu: AppMenu) {
    setEditing(menu);
    setForm({
      key: menu.key,
      label: menu.label,
      path: menu.path ?? "",
      icon: menu.icon ?? "",
      group_key: menu.group_key ?? "",
      group_label: menu.group_label ?? "",
      description: menu.description ?? "",
      sort_order: menu.sort_order,
      is_active: menu.is_active,
      is_system: menu.is_system,
    });
    setGroupMode(menu.group_key ? "existing" : "none");
    setShowAdvanced(false);
    setIconPickerOpen(false);
    setIconSearch("");
    setError("");
    setShowForm(true);
  }

  function update<K extends keyof MenuForm>(key: K, value: MenuForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (!form.label.trim()) {
      showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อเมนู");
      return;
    }
    if (!form.path.trim()) {
      showAlert("ข้อมูลไม่ครบ", "กรุณากรอกลิงก์หรือ path ของเมนู");
      return;
    }
    if (groupMode === "new" && !form.group_label.trim()) {
      showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อเมนูใหญ่ใหม่");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const groupKey = groupMode === "none"
        ? ""
        : groupMode === "new"
          ? (form.group_key.trim() || makeUniqueKey(form.group_label, "group", menus.map(menu => menu.group_key ?? "")))
          : form.group_key.trim();
      const payload = {
        ...form,
        key: editing ? form.key : (form.key.trim() || makeUniqueKey(form.path || form.label, "menu", menus.map(menu => menu.key))),
        label: form.label.trim(),
        path: form.path || null,
        icon: form.icon || null,
        group_key: groupKey || null,
        group_label: groupMode === "none" ? null : form.group_label.trim() || null,
        description: form.description || null,
      };
      if (editing) {
        await api.patch(`/permissions/menus/${editing.id}`, payload);
      } else {
        await api.post("/permissions/menus", payload);
      }
      setShowForm(false);
      setSaved(true);
      await load();
      await refreshUser();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function persistOrder(nextMenus: AppMenu[]) {
    const normalized = normalizeSortOrder(nextMenus);
    const previousById = new Map(menus.map(menu => [menu.id, menu]));
    setMenus(normalized);
    setSaved(false);
    try {
      const payload = {
        items: normalized.map(menu => ({
          id: menu.id,
          sort_order: menu.sort_order,
          group_key: menu.group_key,
          group_label: menu.group_label,
        })),
      };
      await api.post("/permissions/menus/reorder", payload);
      const changedMenus = normalized.filter(menu => {
        const previous = previousById.get(menu.id);
        if (!previous) return false;
        return previous.sort_order !== menu.sort_order ||
          (previous.group_key ?? null) !== (menu.group_key ?? null) ||
          (previous.group_label ?? null) !== (menu.group_label ?? null);
      });
      await Promise.all(changedMenus.map(menu => api.patch(`/permissions/menus/${menu.id}`, {
        sort_order: menu.sort_order,
        group_key: menu.group_key ?? null,
        group_label: menu.group_label ?? null,
      })));
      await load();
      await refreshUser();
      setSaved(true);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
      load();
    }
  }

  function handleDropOnMenu(target: AppMenu) {
    if (!draggingId || draggingId === target.id) return;
    const dragged = menus.find(menu => menu.id === draggingId);
    if (!dragged) return;

    const withoutDragged = sortMenus(menus).filter(menu => menu.id !== draggingId);
    const targetIndex = withoutDragged.findIndex(menu => menu.id === target.id);
    const moved = {
      ...dragged,
      group_key: target.group_key,
      group_label: target.group_label,
    };
    const nextMenus = [...withoutDragged];
    nextMenus.splice(targetIndex, 0, moved);
    setDraggingId(null);
    setDragOverId(null);
    persistOrder(nextMenus);
  }

  function handleDropToNoGroup() {
    if (!draggingId) return;
    const dragged = menus.find(menu => menu.id === draggingId);
    if (!dragged) return;

    const withoutDragged = sortMenus(menus).filter(menu => menu.id !== draggingId);
    const insertAfterIndex = findLastIndex(withoutDragged, menu => !menu.group_key);
    const moved = {
      ...dragged,
      group_key: null,
      group_label: null,
    };
    const nextMenus = [...withoutDragged];
    nextMenus.splice(insertAfterIndex + 1, 0, moved);
    setDraggingId(null);
    setDragOverId(null);
    persistOrder(nextMenus);
  }

  function handleDropOnGroup(groupKey: string, groupLabel: string) {
    if (draggingGroupKey) {
      handleDropGroupOnGroup(groupKey);
      return;
    }
    if (!draggingId) return;
    const dragged = menus.find(menu => menu.id === draggingId);
    if (!dragged) return;

    const withoutDragged = sortMenus(menus).filter(menu => menu.id !== draggingId);
    const insertAfterIndex = findLastIndex(withoutDragged, menu => (menu.group_key ?? "") === groupKey);
    const moved = {
      ...dragged,
      group_key: groupKey || null,
      group_label: groupLabel || null,
    };
    const nextMenus = [...withoutDragged];
    nextMenus.splice(insertAfterIndex + 1, 0, moved);
    setDraggingId(null);
    setDragOverId(null);
    persistOrder(nextMenus);
  }

  function handleDropGroupOnGroup(targetGroupKey: string) {
    if (!draggingGroupKey || draggingGroupKey === targetGroupKey) return;
    const orderedGroups = buildGroupsFromMenus(menus);
    const draggedGroup = orderedGroups.find(group => group.key === draggingGroupKey);
    if (!draggedGroup) return;

    const withoutDragged = orderedGroups.filter(group => group.key !== draggingGroupKey);
    const targetIndex = withoutDragged.findIndex(group => group.key === targetGroupKey);
    if (targetIndex < 0) return;

    const nextGroups = [...withoutDragged];
    nextGroups.splice(targetIndex, 0, draggedGroup);
    setDraggingGroupKey(null);
    setDragOverGroupKey(null);
    persistOrder(nextGroups.flatMap(group => group.rows));
  }

  async function deleteMenu(menu: AppMenu) {
    if (!window.confirm(`ลบเมนู "${menu.label}" ใช่ไหม?`)) return;
    setError("");
    try {
      await api.delete(`/permissions/menus/${menu.id}`);
      await load();
      await refreshUser();
      setSaved(true);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    }
  }

  function openEditGroup(groupKey: string, label: string) {
    if (!groupKey) {
      showAlert("ไม่สามารถแก้ชื่อเมนูใหญ่ได้", "กลุ่มที่ไม่มีรหัสกลุ่มไม่สามารถแก้ชื่อเมนูใหญ่ได้");
      return;
    }
    setEditingGroup({ key: groupKey, label });
    setGroupLabel(label);
    setError("");
  }

  async function saveGroupName() {
    if (!editingGroup || !groupLabel.trim()) return;
    setSaving(true);
    setError("");
    try {
      const nextLabel = groupLabel.trim();
      const groupMenus = menus.filter(menu => (menu.group_key ?? "") === editingGroup.key);
      await Promise.all(
        groupMenus.map(menu => api.patch(`/permissions/menus/${menu.id}`, { group_label: nextLabel }))
      );
      setEditingGroup(null);
      setSaved(true);
      await load();
      await refreshUser();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(groupKey: string, label: string, childCount: number) {
    if (!groupKey) {
      showAlert("ไม่สามารถลบเมนูใหญ่ได้", "กลุ่มที่ไม่มีรหัสกลุ่มไม่สามารถลบเมนูใหญ่ได้");
      return;
    }
    if (childCount > 0) {
      showAlert("ไม่สามารถลบเมนูใหญ่ได้", `ไม่สามารถลบเมนูใหญ่ "${label}" ได้ เพราะยังมีเมนูย่อยอยู่ในนั้น`);
      return;
    }
    if (!window.confirm(`ลบเมนูใหญ่ "${label}" ใช่ไหม?`)) return;
    setError("");
    try {
      await api.delete(`/permissions/menu-groups/${encodeURIComponent(groupKey)}`);
      await load();
      await refreshUser();
      setSaved(true);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    }
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
      <PageHeader title="จัดการเมนู" subtitle="สร้าง แก้ไข เปิด/ปิด และเรียงลำดับเมนูที่แสดงในระบบ">
        <Can menuKey="menus" action="create">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> เพิ่มเมนู
          </button>
        </Can>
      </PageHeader>

      <Dialog open={!!alertDialog} onOpenChange={(open) => !open && setAlertDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{alertDialog?.title}</DialogTitle>
            <DialogDescription>{alertDialog?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setAlertDialog(null)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              ตกลง
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> บันทึกข้อมูลเรียบร้อยแล้ว
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {draggingId && (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={handleDropToNoGroup}
          className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm text-primary"
        >
          ปล่อยเมนูที่นี่ ถ้าต้องการให้เมนูนี้ไม่มีเมนูใหญ่
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">{editing ? "แก้ไขเมนู" : "เพิ่มเมนูใหม่"}</h2>
            <div className="space-y-4">
              <Field label="ชื่อเมนู *">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.label}
                  onChange={e => update("label", e.target.value)}
                  placeholder="ชื่อที่แสดงบน Sidebar"
                />
              </Field>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="ลิงก์ / Path *">
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.path}
                    onChange={e => {
                      update("path", e.target.value);
                      if (!editing && !form.key) {
                        update("key", makeUniqueKey(e.target.value, "menu", menus.map(menu => menu.key)));
                      }
                    }}
                    placeholder="/income"
                  />
                </Field>
                <Field label="ไอคอน">
                  <IconPicker
                    value={form.icon}
                    open={iconPickerOpen}
                    search={iconSearch}
                    onOpenChange={setIconPickerOpen}
                    onSearchChange={setIconSearch}
                    onChange={(value) => update("icon", value)}
                  />
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="อยู่ใต้เมนูใหญ่">
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={groupMode === "none" ? "__none__" : groupMode === "new" ? "__new__" : form.group_key}
                    onChange={e => {
                      if (e.target.value === "__none__") {
                        setGroupMode("none");
                        update("group_key", "");
                        update("group_label", "");
                        return;
                      }
                      if (e.target.value === "__new__") {
                        setGroupMode("new");
                        update("group_key", "");
                        update("group_label", "");
                        return;
                      }
                      const selected = groupOptions.find(group => group.key === e.target.value);
                      setGroupMode("existing");
                      update("group_key", selected?.key ?? "");
                      update("group_label", selected?.label ?? "");
                    }}
                  >
                    <option value="__none__">ไม่อยู่ใต้เมนูใหญ่</option>
                    {groupOptions.map(group => (
                      <option key={group.key} value={group.key}>{group.label}</option>
                    ))}
                    <option value="__new__">+ สร้างเมนูใหญ่ใหม่</option>
                  </select>
                </Field>
                {groupMode === "new" ? (
                  <Field label="ชื่อเมนูใหญ่ใหม่ *">
                    <input
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={form.group_label}
                      onChange={e => {
                        update("group_label", e.target.value);
                        update("group_key", makeUniqueKey(e.target.value, "group", menus.map(menu => menu.group_key ?? "")));
                      }}
                      placeholder="เช่น งานขาย"
                    />
                  </Field>
                ) : (
                  <Field label="สถานะ">
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={e => update("is_active", e.target.checked)}
                      />
                      เปิดใช้งาน
                    </label>
                  </Field>
                )}
              </div>

              {groupMode === "new" && (
                <Field label="สถานะ">
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => update("is_active", e.target.checked)}
                    />
                    เปิดใช้งาน
                  </label>
                </Field>
              )}

              <Field label="รายละเอียด">
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  rows={3}
                  value={form.description}
                  onChange={e => update("description", e.target.value)}
                  placeholder="คำอธิบายเมนู"
                />
              </Field>

              <button
                type="button"
                onClick={() => setShowAdvanced(open => !open)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {showAdvanced ? "ซ่อนขั้นสูง" : "แสดงขั้นสูง"}
              </button>

              {showAdvanced && (
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-2">
                  <Field label="รหัสเมนู">
                    <input
                      className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-muted"
                      value={form.key}
                      disabled={!!editing}
                      onChange={e => update("key", e.target.value)}
                      placeholder="สร้างให้อัตโนมัติ"
                    />
                  </Field>
                  <Field label="รหัสเมนูใหญ่">
                    <input
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={form.group_key}
                      disabled={groupMode !== "new"}
                      onChange={e => update("group_key", e.target.value)}
                      placeholder={groupMode === "none" ? "ไม่มีเมนูใหญ่" : "สร้างให้อัตโนมัติ"}
                    />
                  </Field>
                  <Field label="ลำดับ">
                    <input
                      type="number"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={form.sort_order}
                      onChange={e => update("sort_order", Number(e.target.value))}
                    />
                  </Field>
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">
                ยกเลิก
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">แก้ไขชื่อเมนูใหญ่</h2>
            <Field label="ชื่อเมนูใหญ่">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={groupLabel}
                onChange={e => setGroupLabel(e.target.value)}
                placeholder="ชื่อกลุ่มเมนู"
              />
            </Field>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditingGroup(null)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">
                ยกเลิก
              </button>
              <button
                onClick={saveGroupName}
                disabled={saving || !groupLabel.trim()}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  {["", "เมนู", "Path", "กลุ่ม", "ลำดับ", "สถานะ", ""].map(header => (
                    <th key={header} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedMenus.map(([groupKey, group]) => (
                  <Fragment key={groupKey || "empty"}>
                    <tr
                      draggable
                      onDragStart={e => {
                        setDraggingGroupKey(groupKey);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", `group:${groupKey}`);
                      }}
                      onDragEnter={() => setDragOverGroupKey(groupKey)}
                      onDragEnd={() => {
                        setDraggingGroupKey(null);
                        setDragOverGroupKey(null);
                      }}
                      className={`border-b bg-muted/20 ${dragOverGroupKey === groupKey ? "outline outline-1 outline-primary/30" : ""}`}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => handleDropOnGroup(groupKey, group.label)}
                    >
                      <td className="px-4 py-2" colSpan={7}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground">{group.label}</div>
                              <div className="text-[11px] text-muted-foreground/70">{groupKey || "no-group"} · {group.rows.length} เมนูย่อย</div>
                            </div>
                          </div>
                          <Can menuKey="menus" action="update">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditGroup(groupKey, group.label)}
                                className="rounded p-1.5 hover:bg-white"
                                title="แก้ชื่อเมนูใหญ่"
                              >
                                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <button
                                onClick={() => deleteGroup(groupKey, group.label, group.rows.length)}
                                className="rounded p-1.5 hover:bg-white"
                                title="ลบเมนูใหญ่"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                              </button>
                            </div>
                          </Can>
                        </div>
                      </td>
                    </tr>
                    {group.rows.map(menu => (
                      <tr
                        key={menu.id}
                        draggable
                        onDragStart={e => {
                          if (draggingGroupKey) return;
                          setDraggingId(menu.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(menu.id));
                        }}
                        onDragEnter={() => setDragOverId(menu.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverId(null);
                        }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleDropOnMenu(menu)}
                        className={`border-b hover:bg-muted/20 ${dragOverId === menu.id ? "bg-primary/5 outline outline-1 outline-primary/30" : ""}`}
                      >
                        <td className="w-10 px-4 py-2.5">
                          <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <ListTree className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{menu.label}</div>
                              <div className="text-xs text-muted-foreground">{menu.key}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{menu.path || "-"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{menu.group_key || "-"}</td>
                        <td className="px-4 py-2.5">{menu.sort_order}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            menu.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                          }`}>
                            {menu.is_active ? "เปิดใช้งาน" : "ปิด"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <Can menuKey="menus" action="update">
                              <button onClick={() => openEdit(menu)} className="rounded p-1.5 hover:bg-muted" title="แก้ไข">
                                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </Can>
                            <Can menuKey="menus" action="delete">
                              <button onClick={() => deleteMenu(menu)} className="rounded p-1.5 hover:bg-muted" title="ลบ">
                                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                              </button>
                            </Can>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function sortMenus(rows: AppMenu[]) {
  return [...rows].sort((a, b) =>
    a.sort_order - b.sort_order ||
    (a.group_key ?? "").localeCompare(b.group_key ?? "") ||
    a.id - b.id
  );
}

function normalizeSortOrder(rows: AppMenu[]) {
  return rows.map((menu, index) => ({
    ...menu,
    sort_order: (index + 1) * 10,
  }));
}

function buildGroupsFromMenus(rows: AppMenu[]) {
  const groups = new Map<string, { key: string; label: string; rows: AppMenu[] }>();
  sortMenus(rows).forEach(menu => {
    const key = menu.group_key ?? "";
    if (!groups.has(key)) groups.set(key, { key, label: menu.group_label || "ไม่มีกลุ่ม", rows: [] });
    groups.get(key)?.rows.push(menu);
  });
  return Array.from(groups.values());
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i;
  }
  return -1;
}

function makeUniqueKey(value: string, fallbackPrefix: string, existingKeys: string[]) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `${fallbackPrefix}_${Date.now().toString(36)}`;
  const existing = new Set(existingKeys.filter(Boolean));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function IconPicker({
  value,
  open,
  search,
  onOpenChange,
  onSearchChange,
  onChange,
}: {
  value: string;
  open: boolean;
  search: string;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onChange: (value: string) => void;
}) {
  const selected = ICON_OPTIONS.find(icon => icon.value === value);
  const selectedValue = value || ICON_OPTIONS[0].value;
  const SelectedIcon = getIconComponent(selectedValue);
  const filteredIcons = ICON_OPTIONS.filter(icon => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return icon.label.toLowerCase().includes(query) || icon.value.toLowerCase().includes(query);
  });
  const customIconName = toPascalIconName(search);
  const hasExactOption = ICON_OPTIONS.some(icon => icon.value.toLowerCase() === customIconName.toLowerCase());
  const customIconAvailable = Boolean(LUCIDE_ICON_COMPONENTS[customIconName]);
  const CustomIcon = getIconComponent(customIconName);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SelectedIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{selected?.label ?? selectedValue}</span>
        </span>
        <span className="text-xs text-muted-foreground">{selectedValue}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border bg-white p-2 shadow-xl">
          <input
            autoFocus
            className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="ค้นหาไอคอน..."
          />
          <div className="max-h-56 overflow-y-auto">
            {customIconName && !hasExactOption && (
              <button
                type="button"
                onClick={() => {
                  onChange(customIconName);
                  onSearchChange("");
                  onOpenChange(false);
                }}
                className="mb-1 flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-2 text-left text-sm hover:bg-muted"
              >
                <CustomIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1">ใช้ไอคอนนี้: {customIconName}</span>
                <span className={`text-xs ${customIconAvailable ? "text-emerald-600" : "text-amber-600"}`}>
                  {customIconAvailable ? "พบไอคอน" : "ใช้ fallback"}
                </span>
              </button>
            )}
            {filteredIcons.map(icon => {
              const Icon = getIconComponent(icon.value);
              return (
                <button
                  key={icon.value}
                  type="button"
                  onClick={() => {
                    onChange(icon.value);
                    onSearchChange("");
                    onOpenChange(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${
                    icon.value === value ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{icon.label}</span>
                  <span className="text-xs text-muted-foreground">{icon.value}</span>
                </button>
              );
            })}
            {filteredIcons.length === 0 && (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                ไม่พบไอคอน
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toPascalIconName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
