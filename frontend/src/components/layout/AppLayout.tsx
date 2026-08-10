import { useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/context/AuthContext";

export function AppLayout() {
  const { user, loading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">กำลังโหลด...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar — the sidebar becomes an off-canvas drawer below md */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="เปิดเมนู"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">ระบบบัญชี</span>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
