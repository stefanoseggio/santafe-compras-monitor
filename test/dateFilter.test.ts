import { describe, expect, it } from 'vitest';

import { isWithinDateRange, parseSantaFeDate } from '../src/dateFilter.js';

describe('parseSantaFeDate', () => {
    it('parses a real "YYYY-MM-DD HH:mm:ss" value (fechaHoraAperturaFija)', () => {
        const date = parseSantaFeDate('2026-09-04 09:30:00');
        expect(date?.toISOString()).toBe('2026-09-04T09:30:00.000Z');
    });

    it('returns null for null/undefined/empty/malformed input', () => {
        expect(parseSantaFeDate(null)).toBeNull();
        expect(parseSantaFeDate(undefined)).toBeNull();
        expect(parseSantaFeDate('')).toBeNull();
        expect(parseSantaFeDate('04-09-2026')).toBeNull();
        expect(parseSantaFeDate('not a date')).toBeNull();
    });
});

describe('isWithinDateRange', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');

    it('always passes when no preset is given', () => {
        expect(isWithinDateRange(null, undefined, now)).toBe(true);
        expect(isWithinDateRange(parseSantaFeDate('2000-01-01 00:00:00'), undefined, now)).toBe(true);
    });

    it('rejects a null date when a preset is given', () => {
        expect(isWithinDateRange(null, '24h', now)).toBe(false);
    });

    it('correctly buckets a past date at each preset boundary', () => {
        const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        expect(isWithinDateRange(twelveHoursAgo, '24h', now)).toBe(true);
        expect(isWithinDateRange(threeDaysAgo, '24h', now)).toBe(false);

        expect(isWithinDateRange(threeDaysAgo, '7d', now)).toBe(true);
        expect(isWithinDateRange(twentyDaysAgo, '7d', now)).toBe(false);

        expect(isWithinDateRange(twentyDaysAgo, '30d', now)).toBe(true);
        expect(isWithinDateRange(sixtyDaysAgo, '30d', now)).toBe(false);
    });

    it('also matches a FUTURE date within the window - unlike an offence/served date, fechaHoraApertura can be scheduled ahead (estado=AP)', () => {
        const twelveHoursAhead = new Date(now.getTime() + 12 * 60 * 60 * 1000);
        const threeDaysAhead = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

        expect(isWithinDateRange(twelveHoursAhead, '24h', now)).toBe(true);
        expect(isWithinDateRange(threeDaysAhead, '24h', now)).toBe(false);
        expect(isWithinDateRange(threeDaysAhead, '7d', now)).toBe(true);
    });
});
