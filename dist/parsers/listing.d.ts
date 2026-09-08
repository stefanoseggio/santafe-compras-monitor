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
/**
 * Parse and validate a `consultas.getContrataciones` response. Live-verified
 * shape (2026-09-08): `{success:true, errors:{reason:""}, data:[...],
 * type:"1", totalRecords:"78", extraData:{apTotal:"78", etTotal:"2214",
 * coTotal:"28921"}}`; every row carries a numeric-string `idGestion`.
 */
export declare function parseListingResponse(body: string): ListingPage;
//# sourceMappingURL=listing.d.ts.map