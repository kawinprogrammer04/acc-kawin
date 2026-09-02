import { useEffect, useMemo, useState } from "react";
import { Briefcase, Building2, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { api, getApiErrorMessage } from "@/api/client";
import type { Department, Position } from "@/api/approvals";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCompanyLabel } from "@/lib/companyPresentation";

interface CompanyOption {
  id: number;
  code: string;
  name_th: string;
}

interface DepartmentDraft {
  id: number | null;
  code: string;
  name: string;
  managerUserId: number | null;
}

const emptyDraft: DepartmentDraft = { id: null, code: "", name: "", managerUserId: null };

interface PositionDraft {
  id: number | null;
  name: string;
  departmentId: string;
}

const emptyPositionDraft: PositionDraft = { id: null, name: "", departmentId: "" };

export function OrganizationStructureManager({
  open,
  onClose,
  companies,
  initialCompanyId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  companies: CompanyOption[];
  initialCompanyId?: number;
  onChanged?: () => void;
}) {
  const [companyId, setCompanyId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [draft, setDraft] = useState<DepartmentDraft>(emptyDraft);
  const [positionDraft, setPositionDraft] = useState<PositionDraft>(emptyPositionDraft);
  const [loading, setLoading] = useState(false);
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [deletingDepartmentId, setDeletingDepartmentId] = useState<number | null>(null);
  const [savingPositionId, setSavingPositionId] = useState<number | null>(null);
  const [savingPosition, setSavingPosition] = useState(false);
  const [deletingPositionId, setDeletingPositionId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const activeDepartments = useMemo(
    () => departments.filter((department) => department.is_active),
    [departments],
  );
  const activePositions = useMemo(
    () => positions.filter((position) => position.is_active),
    [positions],
  );

  useEffect(() => {
    if (!open) return;
    const preferred = initialCompanyId && companies.some((company) => company.id === initialCompanyId)
      ? initialCompanyId
      : companies[0]?.id;
    setCompanyId(preferred ? String(preferred) : "");
    setDraft(emptyDraft);
    setPositionDraft(emptyPositionDraft);
    setError("");
  }, [open, initialCompanyId, companies]);

  useEffect(() => {
    if (!open || !companyId) {
      setDepartments([]);
      setPositions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api.get("/expense-settings/departments", { headers: { "X-Company-Id": companyId } }),
      api.get("/positions", { headers: { "X-Company-Id": companyId } }),
    ])
      .then(([departmentResponse, positionResponse]) => {
        if (cancelled) return;
        setDepartments(departmentResponse.data);
        setPositions(positionResponse.data);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(requestError, "โหลดข้อมูลโครงสร้างองค์กรไม่สำเร็จ"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, companyId]);

  function startEdit(department: Department) {
    setDraft({
      id: department.id,
      code: department.code ?? "",
      name: department.name,
      managerUserId: department.manager_user_id ?? null,
    });
    setError("");
  }

  async function saveDepartment() {
    const name = draft.name.trim();
    if (!companyId || !name) {
      setError("กรุณากรอกชื่อแผนก");
      return;
    }
    setSavingDepartment(true);
    setError("");
    const payload = {
      code: draft.code.trim() || null,
      name,
      manager_user_id: draft.managerUserId,
      is_active: true,
    };
    try {
      const response = draft.id
        ? await api.put(`/expense-settings/departments/${draft.id}`, payload, { headers: { "X-Company-Id": companyId } })
        : await api.post("/expense-settings/departments", payload, { headers: { "X-Company-Id": companyId } });
      setDepartments((rows) => {
        const exists = rows.some((row) => row.id === response.data.id);
        const next = exists
          ? rows.map((row) => row.id === response.data.id ? response.data : row)
          : [...rows, response.data];
        return next.sort((a, b) => a.name.localeCompare(b.name, "th"));
      });
      setDraft(emptyDraft);
      onChanged?.();
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "บันทึกแผนกไม่สำเร็จ ชื่อหรือรหัสแผนกอาจซ้ำ"));
    } finally {
      setSavingDepartment(false);
    }
  }

  async function deleteDepartment(department: Department) {
    if (!companyId || !window.confirm(`ลบแผนก “${department.name}” ใช่หรือไม่?\nตำแหน่งและพนักงานที่ผูกไว้จะถูกปลดออกจากแผนกนี้`)) return;
    setDeletingDepartmentId(department.id);
    setError("");
    try {
      await api.delete(`/expense-settings/departments/${department.id}`, { headers: { "X-Company-Id": companyId } });
      setDepartments((rows) => rows.filter((row) => row.id !== department.id));
      setPositions((rows) => rows.map((position) => (
        position.department_id === department.id ? { ...position, department_id: null } : position
      )));
      if (draft.id === department.id) setDraft(emptyDraft);
      onChanged?.();
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "ลบแผนกไม่สำเร็จ"));
    } finally {
      setDeletingDepartmentId(null);
    }
  }

  async function assignPositionDepartment(position: Position, value: string) {
    if (!companyId) return;
    const departmentId = value ? Number(value) : null;
    setSavingPositionId(position.id);
    setError("");
    try {
      const response = await api.patch(
        `/positions/${position.id}`,
        { department_id: departmentId },
        { headers: { "X-Company-Id": companyId } },
      );
      setPositions((rows) => rows.map((row) => row.id === position.id ? response.data : row));
      if (positionDraft.id === position.id) {
        setPositionDraft((current) => ({ ...current, departmentId: value }));
      }
      onChanged?.();
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "กำหนดแผนกให้ตำแหน่งไม่สำเร็จ"));
    } finally {
      setSavingPositionId(null);
    }
  }

  function startEditPosition(position: Position) {
    setPositionDraft({
      id: position.id,
      name: position.name,
      departmentId: position.department_id ? String(position.department_id) : "",
    });
    setError("");
  }

  async function savePosition() {
    const name = positionDraft.name.trim();
    if (!companyId || !name) {
      setError("กรุณากรอกชื่อตำแหน่ง");
      return;
    }
    setSavingPosition(true);
    setError("");
    const payload = {
      name,
      department_id: positionDraft.departmentId ? Number(positionDraft.departmentId) : null,
      is_active: true,
    };
    try {
      const response = positionDraft.id
        ? await api.patch(`/positions/${positionDraft.id}`, payload, { headers: { "X-Company-Id": companyId } })
        : await api.post("/positions", payload, { headers: { "X-Company-Id": companyId } });
      setPositions((rows) => {
        const exists = rows.some((row) => row.id === response.data.id);
        const next = exists
          ? rows.map((row) => row.id === response.data.id ? response.data : row)
          : [...rows, response.data];
        return next.sort((a, b) => a.name.localeCompare(b.name, "th"));
      });
      setPositionDraft(emptyPositionDraft);
      onChanged?.();
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "บันทึกตำแหน่งไม่สำเร็จ ชื่อตำแหน่งอาจซ้ำ"));
    } finally {
      setSavingPosition(false);
    }
  }

  async function deletePosition(position: Position) {
    if (!companyId || !window.confirm(`ลบตำแหน่ง “${position.name}” ใช่หรือไม่?\nพนักงานที่ได้รับตำแหน่งนี้จะถูกยกเลิกการมอบหมาย`)) return;
    setDeletingPositionId(position.id);
    setError("");
    try {
      await api.delete(`/positions/${position.id}`, { headers: { "X-Company-Id": companyId } });
      setPositions((rows) => rows.filter((row) => row.id !== position.id));
      if (positionDraft.id === position.id) setPositionDraft(emptyPositionDraft);
      onChanged?.();
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "ลบตำแหน่งไม่สำเร็จ"));
    } finally {
      setDeletingPositionId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" /> จัดการแผนกและตำแหน่ง
          </DialogTitle>
          <DialogDescription>เพิ่ม แก้ไข หรือลบแผนก และกำหนดว่าตำแหน่งงานแต่ละตำแหน่งอยู่ในแผนกใด</DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-4">
          <label className="text-xs font-medium text-muted-foreground">บริษัท</label>
          <select
            className="mt-1 w-full max-w-md rounded-md border px-3 py-2 text-sm"
            value={companyId}
            onChange={(event) => { setCompanyId(event.target.value); setDraft(emptyDraft); setPositionDraft(emptyPositionDraft); }}
          >
            {companies.length === 0 && <option value="">-- ไม่มีบริษัทที่เข้าถึงได้ --</option>}
            {companies.map((company) => <option key={company.id} value={company.id}>{formatCompanyLabel(company)}</option>)}
          </select>
        </div>

        <div className="mt-4 max-h-[65vh] overflow-y-auto border-t">
          {loading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-0 lg:grid-cols-2 lg:divide-x">
              <section className="p-6">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">แผนก</h3>
                    <p className="text-xs text-muted-foreground">{activeDepartments.length} แผนกที่ใช้งาน</p>
                  </div>
                  {draft.id !== null && (
                    <button type="button" onClick={() => setDraft(emptyDraft)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" /> ยกเลิกแก้ไข
                    </button>
                  )}
                </div>

                <div className="mb-4 grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto] gap-2 rounded-lg border bg-muted/20 p-3">
                  <input
                    className="min-w-0 rounded-md border bg-white px-2.5 py-2 text-sm"
                    placeholder="รหัส เช่น ACC"
                    value={draft.code}
                    onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
                  />
                  <input
                    className="min-w-0 rounded-md border bg-white px-2.5 py-2 text-sm"
                    placeholder="ชื่อแผนก"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === "Enter") void saveDepartment(); }}
                  />
                  <button
                    type="button"
                    onClick={() => void saveDepartment()}
                    disabled={savingDepartment || !draft.name.trim()}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {savingDepartment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.id ? <Save className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {draft.id ? "บันทึก" : "เพิ่ม"}
                  </button>
                </div>

                <div className="space-y-2">
                  {activeDepartments.length === 0 && <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">ยังไม่มีแผนก</p>}
                  {activeDepartments.map((department) => (
                    <div key={department.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                        {(department.code || department.name).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{department.name}</p>
                        <p className="text-[11px] text-muted-foreground">รหัส: {department.code || "-"}</p>
                      </div>
                      <button type="button" onClick={() => startEdit(department)} className="rounded p-1.5 hover:bg-muted" title="แก้ไขแผนก">
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteDepartment(department)}
                        disabled={deletingDepartmentId === department.id}
                        className="rounded p-1.5 hover:bg-rose-50 disabled:opacity-50"
                        title="ลบแผนก"
                      >
                        {deletingDepartmentId === department.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                          : <Trash2 className="h-3.5 w-3.5 text-rose-600" />}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="p-6">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><Briefcase className="h-4 w-4" /> ตำแหน่งพนักงาน</h3>
                    <p className="text-xs text-muted-foreground">{activePositions.length} ตำแหน่งที่ใช้งาน</p>
                  </div>
                  {positionDraft.id !== null && (
                    <button type="button" onClick={() => setPositionDraft(emptyPositionDraft)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" /> ยกเลิกแก้ไข
                    </button>
                  )}
                </div>

                <div className="mb-4 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-2 rounded-lg border bg-muted/20 p-3">
                  <input
                    className="min-w-0 rounded-md border bg-white px-2.5 py-2 text-sm"
                    placeholder="ชื่อตำแหน่ง"
                    value={positionDraft.name}
                    onChange={(event) => setPositionDraft((current) => ({ ...current, name: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === "Enter") void savePosition(); }}
                  />
                  <select
                    className="min-w-0 rounded-md border bg-white px-2.5 py-2 text-sm"
                    value={positionDraft.departmentId}
                    onChange={(event) => setPositionDraft((current) => ({ ...current, departmentId: event.target.value }))}
                  >
                    <option value="">-- ไม่กำหนดแผนก --</option>
                    {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => void savePosition()}
                    disabled={savingPosition || !positionDraft.name.trim()}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {savingPosition ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : positionDraft.id ? <Save className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {positionDraft.id ? "บันทึก" : "เพิ่ม"}
                  </button>
                </div>

                <div className="space-y-2">
                  {activePositions.length === 0 && (
                    <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">ยังไม่มีตำแหน่งพนักงาน</p>
                  )}
                  {activePositions.map((position) => (
                    <div key={position.id} className="rounded-lg border px-3 py-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label htmlFor={`position-department-${position.id}`} className="truncate text-sm font-medium">{position.name}</label>
                        <div className="flex items-center gap-1">
                          {savingPositionId === position.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                          <button type="button" onClick={() => startEditPosition(position)} className="rounded p-1.5 hover:bg-muted" title="แก้ไขตำแหน่ง">
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePosition(position)}
                            disabled={deletingPositionId === position.id}
                            className="rounded p-1.5 hover:bg-rose-50 disabled:opacity-50"
                            title="ลบตำแหน่ง"
                          >
                            {deletingPositionId === position.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                              : <Trash2 className="h-3.5 w-3.5 text-rose-600" />}
                          </button>
                        </div>
                      </div>
                      <select
                        id={`position-department-${position.id}`}
                        className="w-full rounded-md border px-2.5 py-1.5 text-sm"
                        value={position.department_id ?? ""}
                        disabled={savingPositionId === position.id}
                        onChange={(event) => void assignPositionDepartment(position, event.target.value)}
                      >
                        <option value="">-- ยังไม่กำหนดแผนก --</option>
                        {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        {error && <div className="border-t bg-rose-50 px-6 py-3 text-xs text-rose-700">{error}</div>}
      </DialogContent>
    </Dialog>
  );
}
