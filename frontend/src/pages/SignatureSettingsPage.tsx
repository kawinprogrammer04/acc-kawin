import { useEffect, useState } from "react";
import { Briefcase, Building2, CheckCircle2, Loader2, Save, UserCircle } from "lucide-react";
import { authApi, getApiErrorMessage } from "@/api/client";
import { positionsApi, type Position } from "@/api/approvals";
import { SignaturePad } from "@/components/expense/SignaturePad";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

export function SignatureSettingsPage() {
  const { user, refreshUser } = useAuth();
  const { currentCompany } = useCompany();
  const [currentSignature, setCurrentSignature] = useState<string>();
  const [newSignature, setNewSignature] = useState<string>();
  const [positionNames, setPositionNames] = useState<string[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [padVersion, setPadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!currentCompany?.id) {
      setPositionNames([]);
      setPositionsLoading(false);
      return;
    }
    let cancelled = false;
    setPositionsLoading(true);
    positionsApi.mine()
      .then((positions: Position[]) => {
        if (!cancelled) setPositionNames(positions.map((position) => position.name));
      })
      .catch(() => { if (!cancelled) setPositionNames([]); })
      .finally(() => { if (!cancelled) setPositionsLoading(false); });
    return () => { cancelled = true; };
  }, [currentCompany?.id]);

  useEffect(() => {
    if (!user?.has_saved_signature) {
      setCurrentSignature(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    authApi.mySignature()
      .then((response) => { if (!cancelled) setCurrentSignature(response.signature_data_url); })
      .catch((loadError) => {
        if (!cancelled) setError(getApiErrorMessage(loadError, "โหลดลายเซ็นปัจจุบันไม่สำเร็จ"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.has_saved_signature]);

  const saveSignature = async () => {
    if (!newSignature) {
      setError("กรุณาวาดลายเซ็นใหม่ก่อนบันทึก");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await authApi.saveMySignature(newSignature);
      setCurrentSignature(newSignature);
      setNewSignature(undefined);
      setPadVersion((version) => version + 1);
      await refreshUser();
      setNotice("บันทึกลายเซ็นใหม่เรียบร้อยแล้ว ระบบจะใช้ลายเซ็นนี้ในการอนุมัติครั้งต่อไป");
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "บันทึกลายเซ็นไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader title="จัดการลายเซ็น" subtitle="ดูและแก้ไขลายเซ็นที่ระบบใช้เมื่อคุณยืนยันอนุมัติเอกสาร" />

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      <Card>
        <CardContent className="grid gap-3 p-6 sm:grid-cols-3">
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><UserCircle className="h-4 w-4" />ชื่อผู้ลงลายเซ็น</div>
            <p className="mt-2 text-sm font-semibold text-foreground">{user?.full_name || user?.username || "ยังไม่ได้ระบุ"}</p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Briefcase className="h-4 w-4" />ตำแหน่ง</div>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {positionsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : positionNames.join(", ") || "ยังไม่ได้ระบุ"}
            </p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Building2 className="h-4 w-4" />แผนก</div>
            <p className="mt-2 text-sm font-semibold text-foreground">{currentCompany?.department_name || "ยังไม่ได้ระบุ"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="font-semibold">ลายเซ็นที่บันทึกไว้</h2>
            <p className="mt-1 text-sm text-muted-foreground">ลายเซ็นนี้จะถูกเลือกให้อัตโนมัติเมื่อคุณเปิดรายการที่รออนุมัติ</p>
          </div>
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : currentSignature ? (
            <div className="flex min-h-32 items-center justify-center rounded-xl border bg-white p-4">
              <img src={currentSignature} alt="ลายเซ็นที่บันทึกไว้" className="max-h-24 max-w-full object-contain" />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">ยังไม่มีลายเซ็นที่บันทึกไว้</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="font-semibold">{currentSignature ? "วาดลายเซ็นใหม่" : "เพิ่มลายเซ็น"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">เมื่อตกลงบันทึก ลายเซ็นใหม่จะแทนที่ลายเซ็นเดิมทันที</p>
          </div>
          <SignaturePad key={padVersion} onChange={setNewSignature} />
          <div className="flex justify-end">
            <Button type="button" disabled={saving || !newSignature} onClick={saveSignature}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "กำลังบันทึก..." : "บันทึกลายเซ็นใหม่"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
