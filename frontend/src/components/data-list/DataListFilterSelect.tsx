import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dataListFilterControlClass } from "@/components/data-list/styles";

export type DataListFilterOption = { value: string; label: string };

export function DataListFilterSelect({
  label, value, allLabel, options, onChange, allowEmpty = true,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: DataListFilterOption[];
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(option => option.value === value)?.label || allLabel;
  const selectableOptions = allowEmpty ? [{ value: "", label: allLabel }, ...options] : options;

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return <div className="min-w-0 text-sm font-bold">
    <span>{label}</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${selectedLabel}`}
          className={`${dataListFilterControlClass} flex items-center justify-between gap-3 text-left font-medium`}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-2">
        <p className="border-b px-2 pb-2 text-xs font-bold text-muted-foreground">เลือก{label}</p>
        <div className="max-h-72 space-y-1 overflow-y-auto pt-2">
          {selectableOptions.map(option => {
            const selected = value === option.value;
            return <button
              key={option.value || "all"}
              type="button"
              onClick={() => selectOption(option.value)}
              className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-bold text-primary" : "font-medium hover:bg-muted"}`}
            >
              <span className="truncate">{option.label}</span>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? "bg-primary text-primary-foreground" : "border border-input"}`}>
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>;
          })}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}

export function DataListMultiFilterSelect({
  label, values, allLabel, options, onChange,
}: {
  label: string;
  values: string[];
  allLabel: string;
  options: DataListFilterOption[];
  onChange: (values: string[]) => void;
}) {
  const selectedLabel = values.length === 0
    ? allLabel
    : values.length === 1
      ? options.find(option => option.value === values[0])?.label || values[0]
      : `เลือกแล้ว ${values.length} รายการ`;

  const toggleOption = (value: string) => {
    onChange(values.includes(value)
      ? values.filter(current => current !== value)
      : [...values, value]);
  };

  return <div className="min-w-0 text-sm font-bold">
    <span>{label}</span>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${selectedLabel}`}
          className={`${dataListFilterControlClass} flex items-center justify-between gap-3 text-left font-medium`}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          {values.length > 1 && <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-black text-primary-foreground">{values.length}</span>}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-2">
        <div className="flex items-center justify-between gap-3 border-b px-2 pb-2">
          <p className="text-xs font-bold text-muted-foreground">เลือก{label}ได้หลายรายการ</p>
          <button type="button" onClick={() => onChange([])} disabled={values.length === 0} className="shrink-0 text-xs font-bold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">เลือกทั้งหมด</button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto py-2">
          {options.map(option => {
            const selected = values.includes(option.value);
            return <button
              key={option.value}
              type="button"
              onClick={() => toggleOption(option.value)}
              className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-bold text-primary" : "font-medium hover:bg-muted"}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>;
          })}
        </div>
        <p className="border-t px-2 pt-2 text-xs text-muted-foreground">{values.length === 0 ? allLabel : `เลือกไว้ ${values.length} รายการ`}</p>
      </PopoverContent>
    </Popover>
  </div>;
}
