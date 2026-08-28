import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/format";

export const DATA_LIST_PAGE_SIZES = [10, 25, 50, 100] as const;

export function DataListPagination({
  total, page, pageSize, onPageChange, onPageSizeChange, updatedAt = new Date(),
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  updatedAt?: Date;
}) {
  if (total <= 0) return null;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const displayedFrom = pageSize === 0 ? 1 : ((page - 1) * pageSize) + 1;
  const displayedTo = pageSize === 0 ? total : Math.min(page * pageSize, total);

  return <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
    <div className="flex flex-wrap items-center gap-2">
      <span>แสดง {displayedFrom.toLocaleString("th-TH")}–{displayedTo.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} รายการ</span>
      <span>· ต่อหน้า</span>
      <select
        aria-label="จำนวนรายการต่อหน้า"
        value={pageSize === 0 ? "all" : String(pageSize)}
        onChange={event => onPageSizeChange(event.target.value === "all" ? 0 : Number(event.target.value))}
        className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-black text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        {DATA_LIST_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
        <option value="all">ทั้งหมด</option>
      </select>
      <span>· อัปเดตล่าสุด {formatDate(updatedAt.toISOString())}</span>
    </div>
    {pageSize !== 0 && <div className="flex items-center gap-2">
      <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 font-bold disabled:opacity-40"><ChevronLeft className="h-4 w-4" />ก่อนหน้า</button>
      <span className="px-2 font-bold">หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</span>
      <button type="button" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="inline-flex h-10 items-center gap-1 rounded-lg border px-3 font-bold disabled:opacity-40">ถัดไป<ChevronRight className="h-4 w-4" /></button>
    </div>}
  </div>;
}
