import { useEffect, useState, useCallback } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { rolesApi } from "@/api/roles";
import type { Role } from "@/api/roles";
import { RoleManagerContent } from "@/components/RoleManager";

export function RoleManagementPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRoles(await rolesApi.list());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="จัดการบทบาท (Role)" subtitle="เพิ่ม แก้ไข หรือปิดใช้งานบทบาทที่ใช้กำหนดสิทธิ์ผู้ใช้งานทั่วทั้งระบบ" />
      <Card>
        <CardContent className="p-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <RoleManagerContent roles={roles} onChanged={load} />
          )}
        </CardContent>
      </Card>
      <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          บทบาท admin / approver / accountant / viewer เป็นบทบาทหลักของระบบ (system) — แก้ชื่อและระดับได้ แต่ลบหรือปิดใช้งานไม่ได้
          เพราะมีโค้ดส่วนอื่นอ้างอิงชื่อเหล่านี้โดยตรง บทบาทที่เพิ่มเองจะถูกลบได้เฉพาะตอนที่ยังไม่เคยถูกมอบให้ใครเลย
        </p>
      </div>
    </div>
  );
}
