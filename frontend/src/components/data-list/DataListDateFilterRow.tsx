import type { ReactNode } from "react";
import { PresetDateRangeFilter, type PresetDateRangeFilterProps } from "./PresetDateRangeFilter";

/** Keep date before search in both the responsive layout and keyboard order. */
export function DataListDateFilterRow({
  children, ...dateProps
}: PresetDateRangeFilterProps & { children: ReactNode }) {
  return <div className="grid items-end gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,2.2fr)]">
    <PresetDateRangeFilter {...dateProps} />
    {children}
  </div>;
}
