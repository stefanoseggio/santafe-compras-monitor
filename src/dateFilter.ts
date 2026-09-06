export type DateRangePreset = '24h' | '7d' | '30d';

const WINDOW_MS: Record<DateRangePreset, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

// fechaHoraAperturaFija is rendered as "YYYY-MM-DD HH:mm:ss" - verified live
// against the real API response (see fetchListing.ts). Treated as UTC for
// simplicity - Argentina has used a fixed UTC-3 offset with no DST since
// 2009, so this is off by a constant few hours, the same pragmatic
// timezone simplification the portfolio's UK HSE actor's parseUkDate makes
// for BST; negligible at 24h/7d/30d granularity.
export function parseSantaFeDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, yyyy, mm, dd, hh, min, ss] = match;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)));
}

// Unlike the HSE actor's Offence/served dates (always in the past),
// fechaHoraApertura is a *scheduling* date: for estado=AP it is necessarily
// in the future (that's what "upcoming opening" means), while for ET/CO
// it's typically in the past. So this checks the *absolute* distance from
// `now` rather than "happened in the last N" - a one-directional
// (now - date <= window) check would make every AP record trivially match
// every preset, since a negative difference is always <= a positive
// window. That would be a silently-meaningless filter for exactly the
// estado this actor defaults to.
export function isWithinDateRange(date: Date | null, preset: DateRangePreset | undefined, now: Date): boolean {
    if (!preset) return true;
    if (!date) return false;
    return Math.abs(now.getTime() - date.getTime()) <= WINDOW_MS[preset];
}
