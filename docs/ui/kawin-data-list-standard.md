# Kawin Data List Standard

This is the canonical design and behavior contract for filterable list pages in
ACC Kawin. The reference implementation is `/expense-requests/accounting`.

Use the phrase **Kawin Data List Standard** in tasks and reviews. An agent must
treat this document and the shared components below as the acceptance criteria.

## Scope

Apply this standard to pages containing one or more of these elements:

- KPI or summary cards above a list;
- search, select, multi-select, or date filters;
- data tables and aggregate totals;
- page-size selection or pagination;
- exports based on the current filters.

## Shared components

Do not copy or independently recreate an existing pattern.

- Thai preset date range: `frontend/src/components/data-list/PresetDateRangeFilter.tsx`
- Single/multi-select filters: `frontend/src/components/data-list/DataListFilterSelect.tsx`
- KPI cards: `frontend/src/components/data-list/DataListKpiCard.tsx`
- Pagination and page size: `frontend/src/components/data-list/DataListPagination.tsx`
- Shared filter styling: `frontend/src/components/data-list/styles.ts`
- Reference page: `frontend/src/pages/ExpenseAccountingPage.tsx`
- UI primitives: `frontend/src/components/ui/`

When a pattern will be used by a second page, extract the generic implementation
into `frontend/src/components/data-list/` and use it from both pages.

## Filter panel

1. Filters auto-apply. Do not require a “กรองข้อมูล” or Apply button.
2. Text search is debounced by 250–400 ms. Selects, checkboxes, and completed
   date ranges update immediately or with the same short debounce.
3. Keep a “ล้างตัวกรอง” action. Reset must restore documented defaults.
4. Single-choice fields use a single-select dropdown. Multiple-choice fields
   use a multi-select dropdown and show the selected count when appropriate.
5. List, KPI cards, aggregate totals, and export must receive the same normalized
   filter object. A filter must never update only the table.
6. Loading, empty, and error states must remain visible and understandable.

## Date Range Picker with Presets

Always reuse `PresetDateRangeFilter`; do not use two independent date inputs.

Required presets, in this order:

1. ไม่กรองวันที่
2. วันนี้
3. เมื่อวาน
4. 7 วันย้อนหลัง
5. เดือนนี้
6. เดือนก่อน
7. กำหนดเอง

Behavior:

- Default to the current day unless the page specification says otherwise.
- Display selected dates in Thai with Buddhist Era year (พ.ศ.).
- Choosing “กำหนดเอง” displays one calendar to the right of the preset list on
  desktop and below it on small screens.
- First click selects the start date; second click selects the end date.
- If the second date precedes the first, normalize the order automatically.
- While choosing the end date, hovering previews the whole range. Intermediate
  dates use a light primary tint; endpoints remain visually stronger.
- Close and apply only after the range is complete.

## KPI / Summary cards

- These are called KPI Cards, Summary Cards, or Stat Cards.
- Every count and amount must vary with the active filters.
- Amount cards use Thai currency formatting.
- Card layouts are responsive and use the same spacing, radius, typography, and
  icon treatment as the reference page.

## Data table and summary row

- Use explicit, task-approved column order.
- Numeric columns are right-aligned in the header, body, and footer.
- Aggregate values belong in a table `<tfoot>` summary row and must occupy the
  exact column they summarize. Do not place a column total in the pagination bar.
- Aggregate totals cover all filtered records, not only the current page, unless
  the label explicitly says “หน้านี้”.
- Loading and empty states must not change column alignment.

## Pagination

- Default page size: 25.
- Page-size selector options: 10, 25, 50, 100, ทั้งหมด.
- Show `แสดง X–Y จาก Z รายการ` next to the page-size selector.
- Show Previous/Next controls and current page when pagination is enabled.
- Selecting “ทั้งหมด” disables page navigation and requests the full filtered set.
- Any filter or page-size change returns to page 1.

## Backend and verification contract

- List, stats/summary, totals, and export endpoints accept equivalent filters.
- Server-side totals use the same business calculation as the displayed column.
- Add or update tests for filter propagation and aggregate calculations.
- Before delivery: run the frontend TypeScript/Vite build and relevant backend
  tests; verify local health; then follow the repository's branch/deploy process.

## Prompt shorthand

After this standard exists, a complete future request can be as short as:

> เพิ่ม Filter วันที่หน้านี้ โดยใช้ Kawin Data List Standard

or:

> ปรับหน้านี้ให้เป็นรูปแบบเดียวกับ `/expense-requests/accounting`

An explicit instruction from the user overrides this standard for that task.
