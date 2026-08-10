import React, { createContext, useContext, useEffect, useState } from "react";
import { authApi } from "@/api/client";
import type { PermissionAction, User } from "@/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  can: (menuKey: string, action?: PermissionAction) => boolean;
}

const AuthContext = createContext<AuthContextValue>({} as AuthContextValue);

const ACTION_FIELD: Record<string, keyof NonNullable<User["menu_permissions"]>[number]> = {
  view: "can_view",
  create: "can_create",
  update: "can_update",
  delete: "can_delete",
  approve: "can_approve",
  export: "can_export",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then(setUser)
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    localStorage.setItem("token", res.access_token);
    await refreshUser();
  };

  const refreshUser = async () => {
    const me = await authApi.me();
    setUser(me);
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  const can = (menuKey: string, action: PermissionAction = "view") => {
    if (!user) return false;
    if (user.is_platform_admin) return true;
    if (user.permissions_configured && Array.isArray(user.allowed_permissions)) {
      return user.allowed_permissions.includes(`${menuKey}.${action}`);
    }
    if (!user.permissions_configured) return true;
    const field = ACTION_FIELD[action];
    if (!field) return false;
    const permission = user.menu_permissions?.find(p => p.menu_key === menuKey);
    return Boolean(permission?.[field]);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, can }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
