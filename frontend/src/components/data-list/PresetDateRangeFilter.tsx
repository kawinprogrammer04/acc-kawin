import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dataListFilterControlClass } from "@/components/data-list/styles";
import { localDateInput, today } from "@/lib/format";

type DatePreset = "all" | "today" | "yesterday" | "last_7_days" | "this_month" | "previous_month" | "custom";

const datePresetOptions: Array<{ value: DatePreset; label: string }> = [
  { value: "all", label: "ไม่กรองวันที่" },
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "last_7_days", label: "7 วันย้อนหลัง" },
  { value: "this_month", label: "เดือนนี้" },
  { value: "previous_month", label: "เดือนก่อน" },
  { value: "custom", label: "กำหนดเอง" },
];

function dateRangeForPreset(preset: Exclude<DatePreset, "custom">) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: today(), to: today() };
  if (preset === "yesterday") {
    const value = localDateInput(new Date(year, month, now.getDate() - 1));
    return { from: value, to: value };
  }
  if (preset === "last_7_days") return {
    from: localDateInput(new Date(year, month, now.getDate() - 6)), to: today(),
  };
  if (preset === "this_month") return {
    from: localDateInput(new Date(year, month, 1)),
    to: localDateInput(new Date(year, month + 1, 0)),
  };
  return {
    from: localDateInput(new Date(year, month - 1, 1)),
    to: localDateInput(new Date(year, month, 0)),
  };
}

function detectDatePreset(dateFrom: string, dateTo: string): DatePreset {
  for (const preset of ["all", "today", "yesterday", "last_7_days", "this_month", "previous_month"] as const) {
    const range = dateRangeForPreset(preset);
    if (dateFrom === range.from && dateTo === range.to) return preset;
  }
  return "custom";
}

function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatThaiDate(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "long", year: "numeric",
  }).format(value);
}

function orderedRange(first: Date, second: Date): { from: Date; to: Date } {
  return first <= second ? { from: first, to: second } : { from: second, to: first };
}

export type PresetDateRangeFilterProps = {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
  label?: string;
  className?: string;
};

export function PresetDateRangeFilter({
  dateFrom, dateTo, onChange, label = "ช่วงวันที่", className = "",
}: PresetDateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(() => detectDatePreset(dateFrom, dateTo) === "custom");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(() => dateFrom || dateTo ? {
    from: parseLocalDate(dateFrom), to: parseLocalDate(dateTo),
  } : undefined);
  const [hoveredDay, setHoveredDay] = useState<Date>();
  const detectedPreset = detectDatePreset(dateFrom, dateTo);
  const selectedPreset = customMode ? "custom" : detectedPreset;
  const selectedFrom = parseLocalDate(dateFrom);
  const selectedTo = parseLocalDate(dateTo);
  const selectedLabel = selectedFrom && selectedTo
    ? selectedFrom.getTime() === selectedTo.getTime()
      ? formatThaiDate(selectedFrom)
      : `${formatThaiDate(selectedFrom)} – ${formatThaiDate(selectedTo)}`
    : datePresetOptions.find(option => option.value === selectedPreset)?.label || label;
  const previewRange = customRange?.from && !customRange.to && hoveredDay
    ? orderedRange(customRange.from, hoveredDay)
    : customRange;

  useEffect(() => {
    if (!open && detectedPreset !== "custom") setCustomMode(false);
  }, [dateFrom, dateTo, detectedPreset, open]);

  const choosePreset = (preset: DatePreset) => {
    if (preset === "custom") {
      setCustomMode(true); setCustomRange(undefined); setHoveredDay(undefined); return;
    }
    const range = dateRangeForPreset(preset);
    setCustomMode(false); setHoveredDay(undefined); onChange(range.from, range.to); setOpen(false);
  };

  const chooseCustomDay = (day: Date) => {
    if (!customRange?.from || customRange.to) {
      setCustomRange({ from: day, to: undefined });
      setHoveredDay(undefined);
      return;
    }
    const { from, to } = orderedRange(customRange.from, day);
    setCustomRange({ from, to }); setHoveredDay(undefined);
    onChange(localDateInput(from), localDateInput(to));
    setOpen(false);
  };

  return <div className={`min-w-0 text-sm font-bold ${className}`}>
    <span>{label}</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${selectedLabel}`} className={`${dataListFilterControlClass} flex items-center justify-between gap-3 text-left font-medium`}>
          <span className="truncate">{selectedLabel}</span><ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`${customMode ? "w-[640px]" : "w-[var(--radix-popover-trigger-width)] min-w-[320px]"} max-w-[calc(100vw-2rem)] p-2`}>
        <div className={customMode ? "grid grid-cols-1 sm:grid-cols-[220px_minmax(0,1fr)]" : ""}>
          <div className={customMode ? "sm:pr-2" : ""}>
            <p className="border-b px-2 pb-2 text-xs font-bold text-muted-foreground">เลือก{label}</p>
            <div className="space-y-1 py-2">{datePresetOptions.map(option => {
              const selected = selectedPreset === option.value;
              return <button key={option.value} type="button" onClick={() => choosePreset(option.value)} className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-bold text-primary" : "font-medium hover:bg-muted"}`}>
                <span>{option.label}</span>{selected && <Check className="h-4 w-4" />}
              </button>;
            })}</div>
          </div>
          {customMode && <div className="border-t px-2 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-1">
            <p className="text-center text-xs font-bold text-muted-foreground">
              {customRange?.from && !customRange.to
                ? `วันเริ่มต้น ${formatThaiDate(customRange.from)} · เลือกวันสิ้นสุด`
                : "เลือกวันเริ่มต้น แล้วเลือกวันสิ้นสุด"}
            </p>
            {previewRange?.from && previewRange.to && <p className="mt-1 text-center text-xs font-bold text-primary">
              {formatThaiDate(previewRange.from)} – {formatThaiDate(previewRange.to)}
            </p>}
            <Calendar
              mode="range"
              selected={previewRange}
              defaultMonth={customRange?.from || parseLocalDate(dateFrom)}
              onDayClick={chooseCustomDay}
              onDayMouseEnter={day => setHoveredDay(day)}
              onDayMouseLeave={() => setHoveredDay(undefined)}
              numberOfMonths={1}
              formatters={{
                formatCaption: date => new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(date),
              }}
              classNames={{
                day_range_start: "rounded-l-md bg-primary text-primary-foreground",
                day_range_end: "rounded-r-md bg-primary text-primary-foreground",
                day_range_middle: "aria-selected:bg-primary/[0.08] aria-selected:text-foreground",
              }}
              className="mx-auto"
            />
          </div>}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
