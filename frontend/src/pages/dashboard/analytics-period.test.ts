import { describe, expect, it } from 'vitest';

import { UsageStatsPeriod } from '@/graphql/types';

import { buildPeriodDayKeys, dayKeyFromTimestamp, fillPeriodDays, periodDayCount } from './analytics-period';

const NOW = new Date('2026-09-14T02:00:00Z');

describe('periodDayCount', () => {
    it('matches the backend query windows', () => {
        expect(periodDayCount(UsageStatsPeriod.Week)).toBe(7);
        expect(periodDayCount(UsageStatsPeriod.Month)).toBe(30);
        expect(periodDayCount(UsageStatsPeriod.Quarter)).toBe(90);
    });
});

describe('buildPeriodDayKeys', () => {
    it('returns a continuous window that ends today (UTC), oldest first', () => {
        const week = buildPeriodDayKeys(UsageStatsPeriod.Week, NOW);

        expect(week).toHaveLength(7);
        expect(week[0]).toBe('2026-09-08');
        expect(week[6]).toBe('2026-09-14');
        expect(new Set(week).size).toBe(week.length);
    });

    it('grows the axis with the period so switching tabs is visible', () => {
        expect(buildPeriodDayKeys(UsageStatsPeriod.Month, NOW)).toHaveLength(30);
        expect(buildPeriodDayKeys(UsageStatsPeriod.Quarter, NOW)).toHaveLength(90);
        expect(buildPeriodDayKeys(UsageStatsPeriod.Month, NOW)[0]).toBe('2026-08-16');
        expect(buildPeriodDayKeys(UsageStatsPeriod.Quarter, NOW)[0]).toBe('2026-06-17');
    });
});

describe('fillPeriodDays', () => {
    const buildEmpty = (date: string) => ({ count: 0, date });
    const row = (date: string, count: number) => ({ count, date });

    it('zero-fills every day of the period instead of returning a single point', () => {
        const filled = fillPeriodDays(
            [row('2026-09-12T00:00:00Z', 121)],
            UsageStatsPeriod.Week,
            (item) => item.date,
            buildEmpty,
            NOW,
        );

        expect(filled).toHaveLength(7);
        expect(filled.map((item) => item.count)).toEqual([0, 0, 0, 0, 121, 0, 0]);
        expect(filled.map((item) => dayKeyFromTimestamp(item.date))).toEqual(
            buildPeriodDayKeys(UsageStatsPeriod.Week, NOW),
        );
    });

    it('fills a different window for each period', () => {
        const rows = [row('2026-09-12T00:00:00Z', 121)];

        expect(fillPeriodDays(rows, UsageStatsPeriod.Month, (i) => i.date, buildEmpty, NOW)).toHaveLength(30);
        expect(fillPeriodDays(rows, UsageStatsPeriod.Quarter, (i) => i.date, buildEmpty, NOW)).toHaveLength(90);
    });

    it('keeps a row that falls outside the window instead of dropping it', () => {
        const filled = fillPeriodDays(
            [row('2026-01-02T00:00:00Z', 5)],
            UsageStatsPeriod.Week,
            (item) => item.date,
            buildEmpty,
            NOW,
        );

        expect(filled).toHaveLength(8);
        expect(filled[0]).toEqual({ count: 5, date: '2026-01-02T00:00:00Z' });
    });

    it('returns an all-zero axis for an empty result', () => {
        const filled = fillPeriodDays(
            [],
            UsageStatsPeriod.Week,
            (item: { date: string }) => item.date,
            buildEmpty,
            NOW,
        );

        expect(filled).toHaveLength(7);
        expect(filled.every((item) => item.count === 0)).toBe(true);
    });
});
