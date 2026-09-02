import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Check, Loader2, Pencil, Plus, RefreshCw, Route, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Can } from "@/components/auth/RequirePermission";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { api, getApiErrorMessage } from "@/api/client";
import type { Position } from "@/api/approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AppMenu, DiscoveredRoute, PermissionItem, PermissionSet, PositionPermissionCatalog, UserPermissionCatalog } from "@/types";
import { formatCompanyLabel } from "@/lib/companyPresentation";

interface UserOption {
  id: number;
  username: string;
  full_name?: string | null;
  email: string;
  role: string;
  is_active: boolean;
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    view: "เข้าเมนู",
    create: "เพิ่มข้อมูล",
    update: "แก้ไขข้อมูล",
    delete: "ลบข้อมูล",
    approve: "อนุมัติ",
    export: "Export",
    export_pdf: "Export PDF",
    export_xlsx: "Export Excel",
    lookup: "ค้นหา",
    pay: "จ่ายเงิน",
    receive: "รับเงิน",
    post: "Post",
    void: "Void",
    upload: "Upload",
    download: "ดาวน์โหลด",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

function menuGroupLabel(menu: AppMenu) {
  return menu.group_label || "ไม่มีกลุ่ม";
}

function textMatches(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword.trim().toLowerCase());
}

export function PermissionPage() {
  const { user, refreshUser } = useAuth();
  const { companies, currentCompany } = useCompany();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [menus, setMenus] = useState<AppMenu[]>([]);
  const [items, setItems] = useState<PermissionItem[]>([]);
  const [sets, setSets] = useState<PermissionSet[]>([]);
  const [routes, setRoutes] = useState<DiscoveredRoute[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [userCatalog, setUserCatalog] = useState<UserPermissionCatalog | null>(null);
  const [assignedSetIds, setAssignedSetIds] = useState<number[]>([]);
  const [positionCompanyId, setPositionCompanyId] = useState<number | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [positionCatalog, setPositionCatalog] = useState<PositionPermissionCatalog | null>(null);
  const [assignedPositionSetIds, setAssignedPositionSetIds] = useState<number[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const [newPermission, setNewPermission] = useState({ name: "", description: "" });
  const [selectedMenuIds, setSelectedMenuIds] = useState<number[]>([]);
  const [selectedRouteKeys, setSelectedRouteKeys] = useState<string[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [routeError, setRouteError] = useState("");

  const selectedUser = users.find(row => row.id === selectedUserId) ?? null;
  const allUsersSelected = users.length > 0 && selectedUserIds.size === users.length;
  const itemByKey = useMemo(() => new Map(items.map(item => [item.key, item])), [items]);
  const menuById = useMemo(() => new Map(menus.map(menu => [menu.id, menu])), [menus]);

  const groupedMenus = useMemo(() => {
    const groups = new Map<string, AppMenu[]>();
    menus
      .filter(menu => menu.is_active)
      .filter(menu => {
        if (!menuSearch.trim()) return true;
        return textMatches(`${menu.label} ${menu.path ?? ""} ${menu.key}`, menuSearch);
      })
      .forEach(menu => {
        const label = menuGroupLabel(menu);
        groups.set(label, [...(groups.get(label) ?? []), menu]);
      });
    return Array.from(groups.entries()).map(([label, groupMenus]) => ({
      label,
      menus: groupMenus.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
    }));
  }, [menuSearch, menus]);

  const checkedMenuViewKeys = useMemo(() => {
    const keys = selectedMenuIds
      .map(menuId => menuById.get(menuId)?.key)
      .filter(Boolean)
      .map(key => `${key}.view`);
    return new Set(keys);
  }, [selectedMenuIds, menuById]);

  const groupedRoutes = useMemo(() => {
    const groups = new Map<string, DiscoveredRoute[]>();
    routes
      // A menu's own "view" route is already granted by checking that menu in
      // the Menus tab (see ensureMenuViewItem in savePermissionSetFromModal).
      // Keeping it toggleable here too let someone uncheck it in this tab
      // while the menu stayed checked — the menu re-added it on save, so the
      // uncheck silently had no effect. Hide it here while the menu is checked
      // so there's only one control for that permission at a time.
      .filter(route => !checkedMenuViewKeys.has(route.permission_key))
      .filter(route => {
        if (!routeSearch.trim()) return true;
        return textMatches(`${route.action_label} ${route.method} ${route.path} ${route.menu_label ?? ""}`, routeSearch);
      })
      .forEach(route => {
        const label = route.menu_label || "Route ที่ยังไม่ผูกเมนู";
        groups.set(label, [...(groups.get(label) ?? []), route]);
      });
    return Array.from(groups.entries()).map(([label, groupRoutes]) => ({
      label,
      routes: groupRoutes.sort((a, b) => a.path.localeCompare(b.path) || a.action_key.localeCompare(b.action_key)),
    }));
  }, [routeSearch, routes, checkedMenuViewKeys]);

  const loadRoutes = useCallback(async () => {
    setRouteLoading(true);
    setRouteError("");
    try {
      const routesRes = await api.get("/permissions/discovered-routes");
      setRoutes(Array.isArray(routesRes.data) ? routesRes.data : []);
    } catch (e: unknown) {
      setRoutes([]);
      setRouteError(getApiErrorMessage(e));
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    await loadRoutes();
    try {
      const [itemsRes, setsRes] = await Promise.all([
        api.get("/permissions/items"),
        api.get("/permissions/sets"),
      ]);
      setItems(itemsRes.data);
      setSets(setsRes.data);
    } catch (e: unknown) {
      setItems([]);
      setSets([]);
      setError(getApiErrorMessage(e));
    }
  }, [loadRoutes]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, menusRes] = await Promise.all([
        api.get("/auth/users"),
        api.get("/permissions/menus"),
      ]);
      setUsers(usersRes.data);
      setMenus(menusRes.data);
      setSelectedUserId((current) => current ?? usersRes.data[0]?.id ?? null);
      await loadCatalog();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [loadCatalog]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  useEffect(() => {
    if (createOpen) void loadRoutes();
  }, [createOpen, loadRoutes]);

  useEffect(() => {
    if (!selectedUserId) return;
    setError("");
    api.get(`/permissions/users/${selectedUserId}/catalog`)
      .then(res => {
        const catalog: UserPermissionCatalog = res.data;
        setUserCatalog(catalog);
        setAssignedSetIds(catalog.permission_set_ids);
      })
      .catch((e: unknown) => setError(getApiErrorMessage(e)));
  }, [selectedUserId]);

  useEffect(() => {
    if (positionCompanyId === null && currentCompany) setPositionCompanyId(currentCompany.id);
  }, [currentCompany, positionCompanyId]);

  useEffect(() => {
    if (!positionCompanyId) { setPositions([]); return; }
    let cancelled = false;
    setLoadingPositions(true);
    setSelectedPositionId(null);
    setPositionCatalog(null);
    setAssignedPositionSetIds([]);
    api.get("/positions", { headers: { "X-Company-Id": positionCompanyId } })
      .then(res => {
        if (cancelled) return;
        setPositions(res.data);
        setSelectedPositionId((res.data as Position[])[0]?.id ?? null);
      })
      .catch((e: unknown) => { if (!cancelled) setError(getApiErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoadingPositions(false); });
    return () => { cancelled = true; };
  }, [positionCompanyId]);

  useEffect(() => {
    if (!selectedPositionId) return;
    setError("");
    api.get(`/permissions/positions/${selectedPositionId}/catalog`)
      .then(res => {
        const catalog: PositionPermissionCatalog = res.data;
        setPositionCatalog(catalog);
        setAssignedPositionSetIds(catalog.permission_set_ids);
      })
      .catch((e: unknown) => setError(getApiErrorMessage(e)));
  }, [selectedPositionId]);

  function resetCreateForm() {
    setEditingSetId(null);
    setNewPermission({ name: "", description: "" });
    setSelectedMenuIds([]);
    setSelectedRouteKeys([]);
    setMenuSearch("");
    setRouteSearch("");
  }

  function openCreatePermission() {
    resetCreateForm();
    setCreateOpen(true);
  }

  function openEditPermission(set: PermissionSet) {
    const setItems = items.filter(item => set.permission_item_ids.includes(item.id));
    const menuIds = setItems
      .filter(item => item.menu_id && item.action_key === "view")
      .map(item => item.menu_id as number);
    const routeKeys = setItems
      .filter(item => item.source === "route" || item.route_path)
      .map(item => item.key);
    setEditingSetId(set.id);
    setNewPermission({ name: set.name, description: set.description ?? "" });
    setSelectedMenuIds(Array.from(new Set(menuIds)));
    setSelectedRouteKeys(Array.from(new Set(routeKeys)));
    setMenuSearch("");
    setRouteSearch("");
    setCreateOpen(true);
  }

  // Unchecking a menu should also drop any routes already selected for it —
  // otherwise routes pulled in when the edit dialog opened (e.g. from an
  // existing set that already covers most/all menus) stay selected forever,
  // since nothing else ever clears them. Without this, "uncheck 29 of 30
  // menus, keep 1" silently keeps all 29 menus' routes and the edit appears
  // to do nothing when saved.
  function removeRoutesForMenuKeys(menuKeys: (string | undefined)[]) {
    const keys = new Set(menuKeys.filter(Boolean));
    if (!keys.size) return;
    setSelectedRouteKeys(current => current.filter(routeKey => {
      const route = routes.find(r => r.permission_key === routeKey);
      return !(route?.menu_key && keys.has(route.menu_key));
    }));
  }

  function toggleMenu(menuId: number, checked: boolean) {
    setSelectedMenuIds(current => checked
      ? Array.from(new Set([...current, menuId]))
      : current.filter(id => id !== menuId)
    );
    if (!checked) {
      removeRoutesForMenuKeys([menuById.get(menuId)?.key]);
    }
  }

  function toggleRoute(permissionKey: string, checked: boolean) {
    setSelectedRouteKeys(current => checked
      ? Array.from(new Set([...current, permissionKey]))
      : current.filter(key => key !== permissionKey)
    );
  }

  function toggleUserSelection(id: number) {
    setSelectedUserIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllUsers() {
    setSelectedUserIds(current => current.size === users.length ? new Set() : new Set(users.map(row => row.id)));
  }

  function setGroupMenus(groupMenus: AppMenu[], checked: boolean) {
    const ids = groupMenus.map(menu => menu.id);
    setSelectedMenuIds(current => checked
      ? Array.from(new Set([...current, ...ids]))
      : current.filter(id => !ids.includes(id))
    );
    if (!checked) {
      removeRoutesForMenuKeys(groupMenus.map(menu => menu.key));
    }
  }

  function setGroupRoutes(groupRoutes: DiscoveredRoute[], checked: boolean) {
    const keys = groupRoutes.map(route => route.permission_key);
    setSelectedRouteKeys(current => checked
      ? Array.from(new Set([...current, ...keys]))
      : current.filter(key => !keys.includes(key))
    );
  }

  function applyRoutePreset(mode: "readonly" | "work" | "full") {
    const selectedMenus = new Set(
      selectedMenuIds
        .map(menuId => menuById.get(menuId)?.key)
        .filter(Boolean)
    );
    // These buttons are meant to fill in routes for the menus already ticked
    // above. With none ticked, `selectedMenus.size` is 0 and the old
    // `!selectedMenus.size || ...` guard passed every route regardless of
    // menu — so clicking a preset with no menu selected silently replaced
    // whatever the admin had hand-picked with routes from every menu in the
    // whole system. Require at least one menu instead of falling back to "all".
    if (!selectedMenus.size) {
      setError("เลือกเมนูอย่างน้อย 1 เมนูก่อน ค่อยกดตัวช่วยเลือก route — ไม่งั้นจะไม่รู้ว่าจะเลือก route ของเมนูไหน");
      return;
    }
    const workActions = new Set(["view", "create", "update", "export", "export_pdf", "export_xlsx", "lookup", "upload", "download"]);
    const nextKeys = routes
      .filter(route => route.menu_key && selectedMenus.has(route.menu_key))
      .filter(route => {
        if (mode === "readonly") return route.action_key === "view" || route.method === "GET";
        if (mode === "work") return workActions.has(route.action_key);
        return true;
      })
      .map(route => route.permission_key);
    setSelectedRouteKeys(current => Array.from(new Set([...current, ...nextKeys])));
  }

  async function ensureMenuViewItem(menu: AppMenu, currentItems: PermissionItem[]) {
    const existing = currentItems.find(item => item.key === `${menu.key}.view`);
    if (existing) return existing.id;
    const res = await api.post("/permissions/items", {
      key: `${menu.key}.view`,
      menu_id: menu.id,
      menu_key: menu.key,
      action_key: "view",
      label: `เข้าเมนู ${menu.label}`,
      source: "manual",
      is_active: true,
    });
    return res.data.id as number;
  }

  async function savePermissionSetFromModal() {
    if (!newPermission.name.trim()) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const syncedRes = await api.post("/permissions/sync-routes");
      let latestItems: PermissionItem[] = syncedRes.data;

      const menuItemIds = await Promise.all(
        selectedMenuIds
          .map(menuId => menuById.get(menuId))
          .filter(Boolean)
          .map(menu => ensureMenuViewItem(menu as AppMenu, latestItems))
      );

      const routeItemIds = selectedRouteKeys
        .map(key => latestItems.find(item => item.key === key))
        .filter(Boolean)
        .map(item => (item as PermissionItem).id);

      const permissionItemIds = Array.from(new Set([...menuItemIds, ...routeItemIds]));
      const payload = {
        name: newPermission.name.trim(),
        description: newPermission.description.trim() || null,
        permission_item_ids: permissionItemIds,
      };
      const res = editingSetId
        ? await api.patch(`/permissions/sets/${editingSetId}`, payload)
        : await api.post("/permissions/sets", payload);

      const [itemsRes, routesRes] = await Promise.all([
        api.get("/permissions/items"),
        api.get("/permissions/discovered-routes"),
      ]);
      latestItems = itemsRes.data;
      setItems(latestItems);
      setRoutes(routesRes.data);
      setSets(current => editingSetId
        ? current.map(set => set.id === editingSetId ? res.data : set)
        : [...current, res.data]
      );

      // Editing a shared set's items changes what every user/position holding
      // it can do, but nothing here reloads that automatically: the logged-in
      // admin's own menu access is cached in AuthContext since login, and the
      // "effective permissions" figure shown for whichever user/position is
      // open on the other tabs was fetched before this edit. Without these
      // refetches the change is genuinely saved (confirmed server-side) but
      // looks like it "did nothing" until a manual reload or re-login.
      await refreshUser();
      if (selectedUserId) {
        const catalogRes = await api.get(`/permissions/users/${selectedUserId}/catalog`);
        setUserCatalog(catalogRes.data);
      }
      if (selectedPositionId) {
        const positionCatalogRes = await api.get(`/permissions/positions/${selectedPositionId}/catalog`);
        setPositionCatalog(positionCatalogRes.data);
      }

      setCreateOpen(false);
      resetCreateForm();
      setSaved(editingSetId ? "แก้ไขสิทธิ์เรียบร้อยแล้ว" : "สร้างสิทธิ์เรียบร้อยแล้ว");
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deletePermissionSet(set: PermissionSet) {
    if (!window.confirm(`ต้องการปิดใช้งานสิทธิ์ "${set.name}" ใช่ไหม?`)) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await api.delete(`/permissions/sets/${set.id}`);
      setSets(current => current.map(row => row.id === set.id ? { ...row, is_active: false } : row));
      setAssignedSetIds(current => current.filter(id => id !== set.id));
      setSaved("ปิดใช้งานสิทธิ์เรียบร้อยแล้ว");
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveUserCatalog() {
    const targetUserIds = selectedUserIds.size > 0
      ? Array.from(selectedUserIds)
      : (selectedUserId ? [selectedUserId] : []);
    if (!targetUserIds.length) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      // Bulk-save hits the backend one small batch at a time — firing every
      // request in parallel (Promise.all) trips nginx's per-IP connection
      // and request-rate limits once more than a handful of users are
      // selected, which surfaces to the user as a 503.
      const BATCH_SIZE = 5;
      for (let i = 0; i < targetUserIds.length; i += BATCH_SIZE) {
        const batch = targetUserIds.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(id =>
          api.put(`/permissions/users/${id}/catalog`, {
            permission_set_ids: assignedSetIds,
            overrides: [],
          })
        ));
      }
      if (selectedUserId && targetUserIds.includes(selectedUserId)) {
        const res = await api.get(`/permissions/users/${selectedUserId}/catalog`);
        setUserCatalog(res.data);
      }
      if (user?.id && targetUserIds.includes(user.id)) await refreshUser();
      setSaved(
        targetUserIds.length > 1
          ? `กำหนดสิทธิ์ให้ผู้ใช้ ${targetUserIds.length} คนเรียบร้อยแล้ว`
          : "กำหนดสิทธิ์ผู้ใช้เรียบร้อยแล้ว"
      );
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePositionCatalog() {
    if (!selectedPositionId) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await api.put(`/permissions/positions/${selectedPositionId}/catalog`, {
        permission_set_ids: assignedPositionSetIds,
      });
      setPositionCatalog(res.data);
      if (user?.id) await refreshUser();
      setSaved("กำหนดสิทธิ์ตำแหน่งเรียบร้อยแล้ว");
    } catch (e: unknown) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const selectedPermissionNames = useMemo(
    () => sets.filter(set => assignedSetIds.includes(set.id)).map(set => set.name),
    [assignedSetIds, sets]
  );

  const selectedPosition = positions.find(p => p.id === selectedPositionId) ?? null;
  const selectedPositionPermissionNames = useMemo(
    () => sets.filter(set => assignedPositionSetIds.includes(set.id)).map(set => set.name),
    [assignedPositionSetIds, sets]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Permission" subtitle="สร้างสิทธิ์จากเมนูหรือ route แล้วกำหนดให้ผู้ใช้">
        <Can menuKey="permissions" action="create">
          <button
            onClick={openCreatePermission}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            สร้างสิทธิ์
          </button>
        </Can>
      </PageHeader>

      {saved && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> {saved}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      <Tabs defaultValue="permissions">
        <TabsList>
          <TabsTrigger value="permissions">สิทธิ์ที่สร้างไว้</TabsTrigger>
          <TabsTrigger value="users">กำหนดสิทธิ์ผู้ใช้</TabsTrigger>
          <TabsTrigger value="positions">กำหนดสิทธิ์ตำแหน่ง</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions">
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm">สิทธิ์ทั้งหมด</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-3">
              {sets.filter(set => set.is_active).map(set => (
                <div key={set.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{set.name}</div>
                      {set.description && <div className="mt-1 text-sm text-muted-foreground">{set.description}</div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEditPermission(set)}
                        className="rounded-md border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="แก้ไขสิทธิ์"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePermissionSet(set)}
                        disabled={busy || set.is_system}
                        className="rounded-md border p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        title={set.is_system ? "สิทธิ์ระบบไม่สามารถลบได้" : "ลบสิทธิ์"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">{set.permission_item_ids.length} รายการที่เลือกไว้</div>
                </div>
              ))}
              {!sets.filter(set => set.is_active).length && (
                <div className="text-sm text-muted-foreground">ยังไม่มีสิทธิ์ที่สร้างไว้ กด “สร้างสิทธิ์” เพื่อเริ่มต้น</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4" /> ผู้ใช้งาน
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between gap-2 border-b pb-2">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allUsersSelected}
                    onChange={toggleSelectAllUsers}
                  />
                  เลือกทั้งหมด
                </label>
                {selectedUserIds.size > 0 && (
                  <span className="text-xs font-medium text-primary">เลือกแล้ว {selectedUserIds.size} คน</span>
                )}
              </div>
              {users.map(row => (
                <div
                  key={row.id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${selectedUserId === row.id ? "border-primary bg-primary/5" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedUserIds.has(row.id)}
                    onChange={() => toggleUserSelection(row.id)}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedUserId(row.id)}
                    className={`min-w-0 flex-1 text-left ${selectedUserId === row.id ? "text-primary" : ""}`}
                  >
                    <div className="truncate font-medium">{row.full_name || row.username}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between border-b pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4" />
                {selectedUserIds.size > 1
                  ? `สิทธิ์ที่จะใช้กับผู้ใช้ที่เลือก ${selectedUserIds.size} คน`
                  : selectedUser ? `สิทธิ์ของ ${selectedUser.full_name || selectedUser.username}` : "กำหนดสิทธิ์ผู้ใช้"}
              </CardTitle>
              <button
                onClick={saveUserCatalog}
                disabled={busy || (!selectedUserId && !selectedUserIds.size)}
                className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {selectedUserIds.size > 1 ? `บันทึกสิทธิ์ผู้ใช้ (${selectedUserIds.size} คน)` : "บันทึกสิทธิ์ผู้ใช้"}
              </button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm">
                <div className="font-medium">สิทธิ์ที่เลือกให้ผู้ใช้นี้</div>
                <div className="mt-1 text-muted-foreground">
                  {selectedPermissionNames.length ? selectedPermissionNames.join(", ") : "ยังไม่ได้เลือกสิทธิ์"}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  สิทธิ์รวมหลังบันทึกครั้งล่าสุด: {userCatalog?.effective_permission_keys.length ?? 0} รายการ
                </div>
                {selectedUserIds.size > 1 && (
                  <div className="mt-2 text-xs text-amber-700">
                    กำลังเลือกไว้ {selectedUserIds.size} คน — กด “บันทึกสิทธิ์ผู้ใช้” จะแทนที่สิทธิ์ของผู้ใช้ทุกคนที่เลือกด้วยรายการด้านล่างนี้ทั้งหมด
                  </div>
                )}
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {sets.filter(set => set.is_active).map(set => (
                  <label key={set.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={assignedSetIds.includes(set.id)}
                      onChange={e => {
                        setAssignedSetIds(current => e.target.checked
                          ? Array.from(new Set([...current, set.id]))
                          : current.filter(id => id !== set.id)
                        );
                      }}
                    />
                    <span>
                      <span className="block font-medium">{set.name}</span>
                      <span className="block text-xs text-muted-foreground">{set.permission_item_ids.length} รายการ</span>
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="positions" className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">บริษัท:</label>
            <select
              className="rounded-md border px-3 py-1.5 text-sm"
              value={positionCompanyId ?? ""}
              onChange={e => setPositionCompanyId(e.target.value ? Number(e.target.value) : null)}
            >
              {companies.map(c => (
                <option key={c.id} value={c.id}>{formatCompanyLabel(c)}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              ตำแหน่งขึ้นอยู่กับบริษัท — เลือกบริษัทก่อนเพื่อดูตำแหน่งของบริษัทนั้น
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Briefcase className="h-4 w-4" /> ตำแหน่ง
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {loadingPositions && (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                )}
                {!loadingPositions && positions.length === 0 && (
                  <div className="text-sm text-muted-foreground">บริษัทนี้ยังไม่มีตำแหน่ง (ตั้งค่าที่หน้า "สายอนุมัติ")</div>
                )}
                {!loadingPositions && positions.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPositionId(p.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedPositionId === p.id ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted"}`}
                  >
                    <div className="font-medium">{p.name}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between border-b pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4" />
                  {selectedPosition ? `สิทธิ์ของตำแหน่ง ${selectedPosition.name}` : "กำหนดสิทธิ์ตำแหน่ง"}
                </CardTitle>
                <button onClick={savePositionCatalog} disabled={busy || !selectedPositionId} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  บันทึกสิทธิ์ตำแหน่ง
                </button>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm">
                  <div className="font-medium">สิทธิ์ที่เลือกให้ตำแหน่งนี้</div>
                  <div className="mt-1 text-muted-foreground">
                    {selectedPositionPermissionNames.length ? selectedPositionPermissionNames.join(", ") : "ยังไม่ได้เลือกสิทธิ์"}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    สิทธิ์รวมหลังบันทึกครั้งล่าสุด: {positionCatalog?.effective_permission_keys.length ?? 0} รายการ
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    ทุกคนที่ถืออยู่ในตำแหน่งนี้จะได้สิทธิ์นี้อัตโนมัติ (รวมกับสิทธิ์ส่วนตัวที่กำหนดแยกในแท็บ "กำหนดสิทธิ์ผู้ใช้")
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {sets.filter(set => set.is_active).map(set => (
                    <label key={set.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={assignedPositionSetIds.includes(set.id)}
                        onChange={e => {
                          setAssignedPositionSetIds(current => e.target.checked
                            ? Array.from(new Set([...current, set.id]))
                            : current.filter(id => id !== set.id)
                          );
                        }}
                      />
                      <span>
                        <span className="block font-medium">{set.name}</span>
                        <span className="block text-xs text-muted-foreground">{set.permission_item_ids.length} รายการ</span>
                      </span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingSetId ? "แก้ไขสิทธิ์" : "สร้างสิทธิ์"}</DialogTitle>
            <DialogDescription>
              ตั้งชื่อ เลือกเมนู แล้วใช้ตัวช่วยเลือก route ตามรูปแบบงานได้ทันที
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="mx-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="space-y-3 px-6 pt-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={newPermission.name}
                onChange={e => setNewPermission(current => ({ ...current, name: e.target.value }))}
                placeholder="ชื่อสิทธิ์ เช่น ดูอย่างเดียว, บัญชี, ผู้อนุมัติ"
              />
              <Input
                value={newPermission.description}
                onChange={e => setNewPermission(current => ({ ...current, description: e.target.value }))}
                placeholder="คำอธิบาย เช่น เห็นเมนูรายงานและ export ได้"
              />
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <button
                type="button"
                onClick={() => applyRoutePreset("readonly")}
                className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="block font-medium">ดูอย่างเดียว</span>
                <span className="text-xs text-muted-foreground">เลือก route สำหรับดูข้อมูล</span>
              </button>
              <button
                type="button"
                onClick={() => applyRoutePreset("work")}
                className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="block font-medium">ใช้งานทั่วไป</span>
                <span className="text-xs text-muted-foreground">ดู เพิ่ม แก้ไข export</span>
              </button>
              <button
                type="button"
                onClick={() => applyRoutePreset("full")}
                className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="block font-medium">จัดการเต็ม</span>
                <span className="text-xs text-muted-foreground">เลือก route ทั้งหมดของเมนู</span>
              </button>
            </div>
          </div>

          <Tabs defaultValue="menus" className="px-6">
            <TabsList>
              <TabsTrigger value="menus">เมนูในระบบ</TabsTrigger>
              <TabsTrigger value="routes">Route ทั้งหมดในโปรเจก</TabsTrigger>
            </TabsList>

            <TabsContent value="menus">
              <div className="max-h-[460px] overflow-y-auto rounded-md border p-3">
                <div className="sticky top-0 z-10 mb-3 bg-white pb-3">
                  <Input
                    value={menuSearch}
                    onChange={e => setMenuSearch(e.target.value)}
                    placeholder="ค้นหาเมนู"
                  />
                </div>
                {groupedMenus.map(group => (
                  <div key={group.label} className="mb-4 last:mb-0">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold text-muted-foreground">{group.label}</div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setGroupMenus(group.menus, true)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                          เลือกทั้งกลุ่ม
                        </button>
                        <button type="button" onClick={() => setGroupMenus(group.menus, false)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                          ล้างกลุ่ม
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {group.menus.map(menu => (
                        <label key={menu.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selectedMenuIds.includes(menu.id)}
                            onChange={e => toggleMenu(menu.id, e.target.checked)}
                          />
                          <span>
                            <span className="block font-medium">{menu.label}</span>
                            <span className="block text-xs text-muted-foreground">{menu.path || menu.key}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="routes">
              <div className="max-h-[460px] overflow-y-auto rounded-md border p-3">
                <div className="sticky top-0 z-10 mb-3 space-y-2 bg-white pb-3">
                  <Input
                    value={routeSearch}
                    onChange={e => setRouteSearch(e.target.value)}
                    placeholder="ค้นหา route เช่น pay, export, invoices"
                  />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    พบ route {routes.length} รายการ
                  </div>
                  <button
                    type="button"
                    onClick={loadRoutes}
                    disabled={routeLoading}
                    className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    {routeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    โหลด route ใหม่
                  </button>
                </div>
                </div>
                {routeLoading && (
                  <div className="flex items-center gap-2 rounded-md border px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    กำลังโหลด route จาก backend
                  </div>
                )}
                {routeError && !routeLoading && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    โหลด route ไม่สำเร็จ: {routeError}
                  </div>
                )}
                {!routeLoading && !routeError && !groupedRoutes.length && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    API ตอบสำเร็จ แต่ยังไม่พบ route จาก backend ถ้าเพิ่ง deploy โค้ดใหม่ ให้ rebuild/restart backend แล้วกด “โหลด route ใหม่”
                  </div>
                )}
                {groupedRoutes.map(group => (
                  <div key={group.label} className="mb-4 last:mb-0">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold text-muted-foreground">{group.label}</div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setGroupRoutes(group.routes, true)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                          เลือกทั้งกลุ่ม
                        </button>
                        <button type="button" onClick={() => setGroupRoutes(group.routes, false)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                          ล้างกลุ่ม
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      {group.routes.map(route => {
                        const syncedItem = itemByKey.get(route.permission_key);
                        return (
                          <label key={`${route.method}:${route.path}:${route.permission_key}`} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={selectedRouteKeys.includes(route.permission_key)}
                              onChange={e => toggleRoute(route.permission_key, e.target.checked)}
                            />
                            <span className="min-w-0">
                              <span className="block font-medium">
                                <Route className="mr-1 inline h-3.5 w-3.5" />
                                {route.action_label || actionLabel(route.action_key)}
                              </span>
                              <span className="block break-all text-xs text-muted-foreground">{route.method} {route.path}</span>
                              <span className="block text-xs text-muted-foreground">
                                {syncedItem ? "พร้อมใช้งาน" : "จะถูกดึงเข้าระบบตอนบันทึก"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <div className="mx-6 rounded-md border bg-muted/20 px-4 py-3 text-sm">
            <div className="font-medium">สรุปก่อนบันทึก</div>
            <div className="mt-1 text-muted-foreground">
              เลือกเมนู {selectedMenuIds.length} รายการ และ route {selectedRouteKeys.length} รายการ
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => { setCreateOpen(false); resetCreateForm(); }}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
            >
              ยกเลิก
            </button>
            <button
              onClick={savePermissionSetFromModal}
              disabled={busy || !newPermission.name.trim() || (!selectedMenuIds.length && !selectedRouteKeys.length)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingSetId ? "บันทึกการแก้ไข" : "บันทึกสิทธิ์"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
