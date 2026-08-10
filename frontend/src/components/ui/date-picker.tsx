import * as React from "react";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DatePickerProps {
  /** ISO date string (yyyy-MM-dd), same shape as a native <input type="date">. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/** Parses "yyyy-MM-dd" as a local calendar date (avoids the UTC-midnight
 * off-by-one shift `new Date("yyyy-MM-dd")` can cause in negative-offset
 * timezones). */
function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function toLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Thai-formatted equivalent of <input type="date"> — a button showing the
 * date in Thai (e.g. "8 ส.ค. 2569") that opens a calendar popup to pick from. */
export function DatePicker({ value, onChange, placeholder = "เลือกวันที่", className, disabled }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseLocalDate(value);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start px-3 font-normal",
              selected && "pr-8",
              !selected && "text-muted-foreground",
              className
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            {selected ? formatDate(value) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (date) onChange(toLocalIso(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {selected && !disabled && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onChange(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="ล้างวันที่ (ไม่กรอง)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
