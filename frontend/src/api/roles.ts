import { api } from "./client";

export interface Role {
  id: number;
  code: string;
  label: string;
  level: number;
  is_system: boolean;
  is_active: boolean;
}

export const rolesApi = {
  list: () => api.get("/auth/roles").then((r) => r.data),
  create: (data: { code: string; label: string; level: number; is_active?: boolean }) =>
    api.post("/auth/roles", data).then((r) => r.data),
  update: (id: number, data: Partial<{ label: string; level: number; is_active: boolean }>) =>
    api.patch(`/auth/roles/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/auth/roles/${id}`),
};
