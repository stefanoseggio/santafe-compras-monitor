import type { EstadoCode, ListingItem } from '../types.js';

export interface ListingPage {
    /**
     * false when the body is not the JSON the site's own search page gets
     * back (maintenance HTML, an empty 500 body, a shape change). A page
     * past the end is still a listing page (success:true, data:[]).
     */
    isListingPage: boolean;
    items: ListingItem[];
    /** `totalRecords` = rows matching the filter set in THIS estado. */
    totalRecords: number | null;
    /** `extraData` = counts for all three estados under the current filter set. */
    totals: Record<EstadoCode, number> | null;
    /** The API's own `errors.reason`, for diagnostics. */
    reason: string | null;
}

interface RawListing {
    success?: unknown;
    errors?: { reason?: unknown };
    data?: unknown;
    totalRecords?: unknown;
    extraData?: { apTotal?: unknown; etTotal?: unknown; coTotal?: unknown } | string;
}

function toCount(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse and validate a `consultas.getContrataciones` response. Live-verified
 * shape (2026-09-08): `{success:true, errors:{reason:""}, data:[...],
 * type:"1", totalRecords:"78", extraData:{apTotal:"78", etTotal:"2214",
 * coTotal:"28921"}}`; every row carries a numeric-string `idGestion`.
 */
export function parseListingResponse(body: string): ListingPage {
    const notListing: ListingPage = { isListingPage: false, items: [], totalRecords: null, totals: null, reason: null };
    let raw: RawListing;
    try {
        raw = JSON.parse(body) as RawListing;
    } catch {
        return notListing;
    }
    if (!raw || typeof raw !== 'object') return notListing;
    const reason = typeof raw.errors?.reason === 'string' && raw.errors.reason ? raw.errors.reason : null;
    if (raw.success !== true || !Array.isArray(raw.data)) return { ...notListing, reason };
    const extra = raw.extraData;
    if (!extra || typeof extra !== 'object') return { ...notListing, reason };
    const totals = {
        AP: toCount(extra.apTotal),
        ET: toCount(extra.etTotal),
        CO: toCount(extra.coTotal),
    };
    if (totals.AP === null || totals.ET === null || totals.CO === null) return { ...notListing, reason };

    const items: ListingItem[] = [];
    for (const row of raw.data as unknown[]) {
        if (!row || typeof row !== 'object') return { ...notListing, reason };
        const item = row as Record<string, unknown>;
        if (typeof item.idGestion !== 'string' || !/^\d+$/.test(item.idGestion)) return { ...notListing, reason };
        items.push(item as unknown as ListingItem);
    }
    return {
        isListingPage: true,
        items,
        totalRecords: toCount(raw.totalRecords),
        totals: totals as Record<EstadoCode, number>,
        reason,
    };
}
