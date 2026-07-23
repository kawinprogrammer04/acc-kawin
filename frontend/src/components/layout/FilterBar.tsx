import { Filter } from "lucide-react";
import { useFilter, DEPARTMENTS, CATEGORIES } from "@/context/FilterContext";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function Chip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:border-primary/50"
      )}
    >
      <span className={cn(
        "h-1.5 w-1.5 rounded-full flex-shrink-0",
        active ? "bg-primary-foreground" : "bg-muted-foreground/40"
      )} />
      {label}
    </button>
  );
}

export function FilterBar() {
  const {
    departments, categories,
    toggleDept, toggleCat,
    allDeptsOn, allCatsOn,
    toggleAllDepts, toggleAllCats,
  } = useFilter();

  return (
    <div className="border-t bg-muted/30 px-3 pt-3 pb-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        <span>Filter</span>
      </div>

      {/* หมวดหมู่ */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          หมวดหมู่
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Chip label="ทั้งหมด" active={allCatsOn} onClick={toggleAllCats} />
          {CATEGORIES.map(c => (
            <Chip key={c} label={c === "Fixed Cost" ? "Fixed" : "Variable"}
              active={categories.has(c)} onClick={() => toggleCat(c)} />
          ))}
        </div>
      </div>

      <Separator className="opacity-50" />

      {/* แผนก */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          แผนก
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Chip label="ทั้งหมด" active={allDeptsOn} onClick={toggleAllDepts} />
          {DEPARTMENTS.map(d => (
            <Chip key={d} label={d} active={departments.has(d)} onClick={() => toggleDept(d)} />
          ))}
        </div>
      </div>
    </div>
  );
}
