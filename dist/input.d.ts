import type { LookupClient } from './lookups.js';
import type { ActorInput, EstadoCode, EventType, ListingFilters, ListingQuery } from './types.js';
export interface RunOptions {
    estados: EstadoCode[];
    maxItems: number;
    fetchDetail: boolean;
    onlyNew: boolean;
    maxConcurrency: number;
    eventTypes: ReadonlySet<EventType>;
    deltaStateName: string;
    resetState: boolean;
    /** Known open processes whose opening date is within this many days (past or future) are re-read for amendments; 0 disables. */
    recheckWindowDays: number;
    /** Client-side opening-date window (YYYY-MM-DD, Santa Fe calendar), both inclusive. */
    openingFrom: string | null;
    openingTo: string | null;
}
export interface ResolvedInput {
    filters: ListingFilters;
    /** One server-side query per estado (x per tipoGestion code when several are selected). */
    queries: ListingQuery[];
    options: RunOptions;
    /** Stable hash of everything that changes WHICH records a run returns (used to name the delta store). */
    filtersSignature: string;
    /** Human-readable names of the ids the lookups resolved (for logs and the run summary). */
    resolvedNames: Record<string, string>;
}
export declare const MAX_ITEMS_HARD_CAP = 100000;
export declare const MAX_CONCURRENCY_HARD_CAP = 10;
export declare const MAX_RECHECK_WINDOW_DAYS = 365;
/**
 * Accepts the Apify datepicker's absolute ("2026-07-01") and relative forms,
 * plus "today" / "now". A relative window counts BACK from today's calendar
 * date in Santa Fe by default ("7 days", "2 weeks", "3 months", "1 year");
 * prefix it with "+" or "in " to count FORWARD ("+30 days" = thirty days from
 * today), which is how "opening in the next month" is expressed for
 * `openingTo`. Returns YYYY-MM-DD.
 */
export declare function resolveDate(value: unknown, now: Date, field: string): string | null;
export declare function resolveInput(raw: ActorInput, now: Date, lookups: LookupClient): Promise<ResolvedInput>;
//# sourceMappingURL=input.d.ts.map