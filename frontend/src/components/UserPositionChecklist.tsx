import { Loader2 } from "lucide-react";
import type { Position } from "@/api/approvals";

/**
 * Presentational checkbox list for "which positions does this one user hold".
 * Shared between the create/edit-user modal (UserManagementPage) and the
 * per-user position view (ApprovalMatrixPage) — each parent owns the actual
 * fetch/mutate logic (pending-until-save for a brand new user vs. immediate
 * apply for an existing one) and just passes state + a toggle handler in.
 */
export function UserPositionChecklist({
  positions, selectedIds, onToggle, togglingId = null, loading = false, immediate = false,
}: {
  positions: Position[];
  selectedIds: number[];
  onToggle: (position: Position) => void | Promise<void>;
  togglingId?: number | null;
  loading?: boolean;
  immediate?: boolean;
}) {
  const activePositions = positions.filter((position) => position.is_active);
  return (
    <div>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
        {loading && (
          <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        )}
        {!loading && activePositions.length === 0 && (
          <p className="py-1 text-center text-xs text-muted-foreground">บริษัทนี้ยังไม่มีตำแหน่ง กรุณาเพิ่มจาก “จัดการแผนกและตำแหน่ง”</p>
        )}
        {!loading && activePositions.map(p => (
          <label key={p.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
            <input
              type="checkbox"
              checked={selectedIds.includes(p.id)}
              disabled={togglingId === p.id}
              onChange={() => onToggle(p)}
            />
            {p.name}
            {togglingId === p.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </label>
        ))}
      </div>
      {immediate && (
        <p className="mt-1 text-[11px] text-muted-foreground">การติ๊กตำแหน่งจะมีผลทันที ไม่ต้องกด "บันทึก"</p>
      )}
    </div>
  );
}
