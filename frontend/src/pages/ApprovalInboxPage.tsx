import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { approvalInboxApi } from "@/api/approvals";
import type { InboxItem } from "@/api/approvals";
import { formatCurrency, formatDate } from "@/lib/format";

function DecisionModal({ item, action, onClose, onDone }: {
  item: InboxItem; action: "approve" | "reject"; onClose: () => void; onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const isReject = action === "reject";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReject && !comment.trim()) return;
    setSaving(true);
    try {
      const idempotencyKey = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${item.step_id}-${Date.now()}-${Math.random()}`;
      await approvalInboxApi.decide(item.step_id, { action, comment: comment || undefined, idempotency_key: idempotencyKey });
      onDone();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "ดำเนินการไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold">{isReject ? "ปฏิเสธคำขอ" : "อนุมัติคำขอ"}</h2>
          <p className="text-sm text-muted-foreground">{item.title} · {formatCurrency(item.amount)}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              เหตุผล {isReject && "*"}
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              rows={3} required={isReject} value={comment}
              placeholder={isReject ? "กรุณาระบุเหตุผลที่ปฏิเสธ" : "หมายเหตุ (ถ้ามี)"}
              onChange={e => setComment(e.target.value)}
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md border hover:bg-accent">ยกเลิก</button>
            <button type="submit" disabled={saving}
              className={`px-4 py-2 text-sm rounded-md text-white disabled:opacity-50 flex items-center gap-2 ${isReject ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {isReject ? "ยืนยันปฏิเสธ" : "ยืนยันอนุมัติ"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ApprovalInboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<{ item: InboxItem; action: "approve" | "reject" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await approvalInboxApi.list()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="รออนุมัติของฉัน" subtitle="รายการที่รอการพิจารณาจากคุณ" />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["ขั้นตอน", "เรื่อง", "ผู้เบิก", "ยอดเงิน", "วันที่ส่ง", ""].map(h => (
                      <th key={h} className={`px-4 py-3 text-xs font-medium text-muted-foreground ${h === "ยอดเงิน" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(item => (
                    <tr key={item.step_id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground">ขั้น {item.step_no}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.title}</p>
                        <p className="text-[11px] text-muted-foreground">{item.expense_type_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{item.requester_name}</p>
                        <p className="text-[11px] text-muted-foreground">{item.requester_position_name}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.amount)}</td>
                      <td className="px-4 py-3">{item.submitted_at ? formatDate(item.submitted_at) : "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setDecision({ item, action: "approve" })}
                            className="flex items-center gap-1 text-xs rounded-md bg-emerald-100 text-emerald-700 px-2 py-1 hover:bg-emerald-200">
                            <Check className="h-3 w-3" /> อนุมัติ
                          </button>
                          <button onClick={() => setDecision({ item, action: "reject" })}
                            className="flex items-center gap-1 text-xs rounded-md bg-rose-100 text-rose-700 px-2 py-1 hover:bg-rose-200">
                            <X className="h-3 w-3" /> ปฏิเสธ
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Inbox className="h-8 w-8 mb-2" />
                  <p className="text-sm">ไม่มีรายการรออนุมัติ</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {decision && (
        <DecisionModal
          item={decision.item} action={decision.action}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); load(); }}
        />
      )}
    </div>
  );
}
