import type { ParsedDetail } from './parsers/detail.js';
import type { EstadoCode, EventType, GestionRecord, ListingItem, ListingQuery } from './types.js';
export type ExclusionReason = 'unchanged' | 'baseline' | 'eventType' | 'openingDate' | 'unpublished';
export interface Candidate {
    /** The listing row; null for a record found only by the status sweep (it vanished from the open lists). */
    item: ListingItem | null;
    idGestion: string;
    idNumber: number;
    /** The estado list the row came from (or, for a sweep record, the estado the detail page reports). */
    estado: EstadoCode;
    previousEstado: EstadoCode | null;
    /** Fingerprint stored by a previous run ("" when unknown), null when never seen. */
    previousHash: string | null;
    eventType: EventType;
    isNew: boolean;
    openingAt: string | null;
    excludedBy: ExclusionReason | null;
}
export interface WalkOptions {
    queries: ListingQuery[];
    maxItems: number;
    onlyNew: boolean;
    /** idGestion -> "ESTADO|hash" from the delta state. */
    seen: Readonly<Record<string, string>>;
    /** Highest idGestion delivered by a previous run, or null on a cold start. */
    watermark: number | null;
    /**
     * idGestion of the oldest row reached by a previous walk that was cut
     * short by maxItems (rows below it may be undelivered). While set, pages
     * at or above it never count towards the early-stop and the watermark
     * stop is deferred below it. Null when the last walk completed.
     */
    backlogFloor?: number | null;
    /**
     * True on the FIRST delta run of a store (cold state). The walk then keeps
     * reading every selected list to its end even after maxItems is reached,
     * and every row it does not deliver is returned as excluded 'baseline':
     * main.ts marks those rows seen, so the baseline is a snapshot of the ids
     * present in the monitored lists at that moment. This is deliberately NOT
     * an id floor: idGestion is allocated at creation, so on the ET and CO
     * lists a row that arrives tomorrow usually carries an id below every row
     * delivered today (it was created months ago and just opened/concluded),
     * and even the AP list publishes ids out of order by a few positions.
     */
    coldBaseline?: boolean;
    eventTypes: ReadonlySet<EventType>;
    openingFrom: string | null;
    openingTo: string | null;
    /** Days (past) within which known open records are re-read for amendments; 0 = never. */
    recheckWindowDays: number;
    fetchDetail: boolean;
    now: Date;
}
export type StopReason = 'max-items' | 'end-of-results' | 'delta-early-stop' | 'delta-watermark' | 'page-cap';
export interface WalkResult {
    /** Deliverable candidates in walk order (each estado newest-first). */
    candidates: Candidate[];
    /** Walked but intentionally not delivered (unchanged in delta mode, history, or client-side filtered). */
    excluded: Candidate[];
    /** Known, unchanged-in-the-listing open records whose detail page should be re-read for amendments. */
    rechecks: Candidate[];
    /** Sum of the site's own totals for the walked estados under the current filters. */
    totalMatching: number | null;
    totalsByEstado: Record<EstadoCode, number> | null;
    pagesWalked: number;
    stopReason: StopReason;
    /**
     * true when more deliverable records matched than maxItems allowed. On a
     * cold-baseline walk the walk itself still ran to the end of every list
     * (stopReason 'end-of-results') and the surplus is in `excluded` as 'baseline'.
     */
    truncatedByMaxItems: boolean;
    /** Every idGestion met on any page this run. */
    walkedIds: Set<string>;
    /** Estados whose every query ran to the end of its list (so absence from them is meaningful). */
    walkedToEnd: Set<EstadoCode>;
}
export declare const PAGE_SIZE = 2000;
/**
 * Walk every query (one per estado, newest-created first under `newest`
 * order) and decide, per row, whether it must be delivered, re-read, or
 * skipped. Never fetches detail pages.
 */
export declare function walkListing(options: WalkOptions): Promise<WalkResult>;
export type DetailResult = {
    status: 'ok';
    detail: ParsedDetail;
} | {
    status: 'unpublished';
} | {
    status: 'error';
    message: string;
};
/**
 * Fetch and parse one detail page. A nonexistent / not-yet-published id
 * (HTTP 200 with "La gestión no existe o no está publicada aún", or a 404)
 * is 'unpublished'; a network/5xx failure after retries is 'error' - the
 * caller leaves such records unseen so the next run retries them.
 */
export declare function fetchDetailFor(idGestion: string): Promise<DetailResult>;
/** The part of a detail page that, when it changes, means the process was amended. */
export declare function fingerprintOf(detail: ParsedDetail): string;
export declare function buildRecord(candidate: Candidate, detailResult: DetailResult | null, now: Date, scrapedAt?: string): GestionRecord;
export interface EnrichOptions {
    fetchDetail: boolean;
    maxConcurrency: number;
    now: Date;
}
export interface EnrichedCandidate {
    candidate: Candidate;
    detail: DetailResult | null;
    record: GestionRecord;
}
/** Build final records for a batch of candidates, fetching detail pages with bounded concurrency. Order is preserved. */
export declare function enrichBatch(candidates: readonly Candidate[], options: EnrichOptions): Promise<EnrichedCandidate[]>;
export interface FetchGestionesOptions extends WalkOptions, EnrichOptions {
}
/**
 * Convenience one-shot: walk + enrich everything. main.ts streams in batches
 * instead (so state is persisted only for delivered records); this is the
 * simpler entry point used by the live integration tests.
 */
export declare function fetchGestiones(options: FetchGestionesOptions): Promise<{
    records: GestionRecord[];
    walk: WalkResult;
}>;
//# sourceMappingURL=fetchGestiones.d.ts.map