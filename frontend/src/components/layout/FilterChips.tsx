import { cn } from "@/lib/utils";
import { useFilter, DEPARTMENTS, CATEGORIES } from "@/context/FilterContext";

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:border-primary/50"
      )}
    >
      {label}
    </button>
  );
}

interface FilterChipsProps {
  showDept?: boolean;
  showCat?: boolean;
}

export function FilterChips({ showDept = true, showCat = true }: FilterChipsProps) {
  const { departments, categories, toggleDept, toggleCat, allDeptsOn, allCatsOn, toggleAllDepts, toggleAllCats } = useFilter();

  return (
    <div className="flex flex-wrap items-center gap-3">
      {showCat && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium shrink-0">หมวด:</span>
          <Chip label="ทั้งหมด" active={allCatsOn} onClick={toggleAllCats} />
          {CATEGORIES.map(c => (
            <Chip
              key={c}
              label={c === "Fixed Cost" ? "Fixed" : "Variable"}
              active={categories.has(c)}
              onClick={() => toggleCat(c)}
            />
          ))}
        </div>
      )}
      {showDept && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium shrink-0">แผนก:</span>
          <Chip label="ทั้งหมด" active={allDeptsOn} onClick={toggleAllDepts} />
          {DEPARTMENTS.map(d => (
            <Chip key={d} label={d} active={departments.has(d)} onClick={() => toggleDept(d)} />
          ))}
        </div>
      )}
    </div>
  );
}
