import type { ReactNode } from "react";
import { BarChart3, FileSearch, Inbox, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { DataListPagination } from "@/components/data-list/DataListPagination";
import { cn } from "@/lib/utils";

type JourneyStep = "upload" | "review" | "summary";

const journeySteps: Array<{
  id: JourneyStep;
  label: string;
  description: string;
  icon: typeof UploadCloud;
}> = [
  { id: "upload", label: "เพิ่มไฟล์", description: "Statement และหลักฐาน", icon: UploadCloud },
  { id: "review", label: "ตรวจยอด", description: "ดูรายการที่ต้องจัดการ", icon: FileSearch },
  { id: "summary", label: "ดูสรุป", description: "ติดตามยอดต่างและผลรวม", icon: BarChart3 },
];

export function StatementJourney({ active }: { active: JourneyStep }) {
  const activeIndex = journeySteps.findIndex((step) => step.id === active);

  return (
    <nav aria-label="ขั้นตอนตรวจ Statement" className="grid overflow-hidden rounded-xl border bg-card shadow-sm sm:grid-cols-3">
      {journeySteps.map((step, index) => {
        const Icon = step.icon;
        const isActive = step.id === active;
        const isDone = index < activeIndex;
        return (
          <Link
            key={step.id}
            to={`/statement?tab=${step.id}`}
            aria-current={isActive ? "step" : undefined}
            className={cn(
              "group flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0",
              isActive ? "bg-sky-50 text-sky-800" : "hover:bg-muted/40",
            )}
          >
            <span className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-bold",
              isActive && "border-sky-600 bg-sky-600 text-white",
              isDone && "border-emerald-200 bg-emerald-50 text-emerald-700",
              !isActive && !isDone && "border-border bg-background text-muted-foreground",
            )}>
              {isDone ? "✓" : <Icon className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{index + 1}. {step.label}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{step.description}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function FriendlyEmpty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-5 w-5" />}
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return <DataListPagination
    page={page}
    pageSize={pageSize}
    total={total}
    onPageChange={onPageChange}
    onPageSizeChange={onPageSizeChange}
  />;
}

export function FilterPanel({ children, resultText }: { children: ReactNode; resultText?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-2">{children}</div>
      {resultText && <p className="mt-2 text-[11px] text-muted-foreground">{resultText}</p>}
    </div>
  );
}
