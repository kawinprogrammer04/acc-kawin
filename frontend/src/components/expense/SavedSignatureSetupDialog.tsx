import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { authApi, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SignaturePad } from "@/components/expense/SignaturePad";

export function SavedSignatureSetupDialog({
  open,
  onSkip,
  onSaved,
}: {
  open: boolean;
  onSkip: () => void;
  onSaved: () => Promise<void>;
}) {
  const [signature, setSignature] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) setError("");
  }, [open]);

  const save = async () => {
    if (!signature) {
      setError("กรุณาวาดลายเซ็นก่อนบันทึก");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await authApi.saveMySignature(signature);
      await onSaved();
      setSignature(undefined);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "บันทึกลายเซ็นไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !saving) onSkip(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>บันทึกลายเซ็นของคุณ</DialogTitle>
          <DialogDescription>
            เซ็นไว้ครั้งเดียว ระบบจะเลือกลายเซ็นนี้ให้อัตโนมัติเมื่อคุณอนุมัติคำขอครั้งต่อไป
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <SignaturePad onChange={setSignature} />
          <p className="text-xs text-muted-foreground">
            ลายเซ็นนี้ใช้เฉพาะการลงนามเอกสารที่คุณกดยืนยันอนุมัติเท่านั้น
          </p>
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onSkip}>ข้ามก่อน</Button>
          <Button type="button" disabled={saving || !signature} onClick={save}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "กำลังบันทึก..." : "บันทึกลายเซ็น"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
