/**
 * Display-only row number for the flows table.
 *
 * Flow ids come from a PostgreSQL sequence and are never reused, so a page that
 * shows one surviving flow after deleting earlier ones can display `#4` with no
 * `#1`–`#3` on screen. This numbers the rows that are actually visible instead:
 * `pagePosition` is the row's index inside the current page (after sorting and
 * filtering), so the numbering stays continuous across pages while the physical
 * `id` column keeps its stable value for links, reports and evidence.
 */
export const flowRowNumber = (pageIndex: number, pageSize: number, pagePosition: number): number =>
    Math.max(0, pageIndex) * pageSize + pagePosition + 1;
