export const dataListFilterControlClass = "mt-2 box-border h-12 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition hover:border-primary/50 hover:bg-muted/30 focus:border-primary focus:ring-2 focus:ring-primary/20";

// Raise the whole filter panel above later sticky-table stacking contexts.
// Popover menus render in place, so their z-index cannot escape this parent.
export const dataListFilterPanelClass = "relative z-30";

export const dataListTableScrollClass = "max-h-[70vh] overflow-auto";

export const dataListTableHeaderCellClass = "sticky top-0 z-20 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]";
