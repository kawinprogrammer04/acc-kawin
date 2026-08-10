import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { PermissionAction } from "@/types";

export function RequirePermission({
  menuKey,
  action = "view",
  children,
}: {
  menuKey: string;
  action?: PermissionAction;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (can(menuKey, action)) return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-lg border bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <h1 className="text-base font-semibold">ไม่มีสิทธิ์เข้าถึงเมนูนี้</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์การใช้งาน
        </p>
      </div>
    </div>
  );
}

export function Can({
  menuKey,
  action = "view",
  children,
}: {
  menuKey: string;
  action?: PermissionAction;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(menuKey, action)) return null;
  return <>{children}</>;
}

export function RequireLoginRedirect() {
  return <Navigate to="/login" replace />;
}
