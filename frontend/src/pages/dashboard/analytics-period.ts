import { UsageStatsPeriod } from '@/graphql/types';

/**
 * Days each analytics period covers. Mirrors the backend windows
 * (`NOW() - INTERVAL '7 days' | '30 days' | '90 days'`), so the chart axis and
 * the query stay in sync.
 */
export const PERIOD_DAY_COUNTS: Record<UsageStatsPeriod, number> = {
    [UsageStatsPeriod.Month]: 30,
    [UsageStatsPeriod.Quarter]: 90,
    [UsageStatsPeriod.Week]: 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const periodDayCount = (period: UsageStatsPeriod): number =>
    PERIOD_DAY_COUNTS[period] ?? PERIOD_DAY_COUNTS[UsageStatsPeriod.Week];

/** `2026-09-12T00:00:00Z` -> `2026-09-12` */
export const dayKeyFromTimestamp = (value: string): string => value.slice(0, 10);

/** `2026-09-12` -> `2026-09-12T00:00:00Z`, the shape the backend returns. */
export const periodDayTimestamp = (dayKey: string): string => `${dayKey}T00:00:00Z`;

/**
 * The window the backend aggregated over, as `YYYY-MM-DD` keys in UTC, oldest
 * first. The backend uses `DATE(created_at)` (UTC) and groups only days that
 * have rows, so this is what turns a sparse result into a continuous axis.
 */
export const buildPeriodDayKeys = (period: UsageStatsPeriod, now: Date = new Date()): string[] => {
    const total = periodDayCount(period);
    const endOfWindow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    return Array.from({ length: total }, (_, index) =>
        new Date(endOfWindow - (total - 1 - index) * DAY_MS).toISOString().slice(0, 10),
    );
};

/**
 * Fill the period window with zero rows so switching week/month/quarter always
 * changes the axis, even when every row the backend returned falls on the same
 * day. Days returned by the backend are never dropped: a timestamp just outside
 * the window (the window is inclusive of `NOW() - N days`, which can reach one
 * calendar day further back) is kept in place instead of being discarded.
 */
export function fillPeriodDays<TRow>(
    rows: TRow[],
    period: UsageStatsPeriod,
    getTimestamp: (row: TRow) => string,
    buildEmptyRow: (dayTimestamp: string) => TRow,
    now: Date = new Date(),
): TRow[] {
    const rowsByDay = new Map(rows.map((row) => [dayKeyFromTimestamp(getTimestamp(row)), row]));
    const dayKeys = new Set(buildPeriodDayKeys(period, now));

    rowsByDay.forEach((_, dayKey) => dayKeys.add(dayKey));

    return [...dayKeys].sort().map((dayKey) => rowsByDay.get(dayKey) ?? buildEmptyRow(periodDayTimestamp(dayKey)));
}
