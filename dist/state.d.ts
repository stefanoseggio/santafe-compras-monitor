import type { EstadoCode } from './types.js';
export declare const MAX_SEEN_ENTRIES = 50000;
export interface SeenEntry {
    estado: EstadoCode | null;
    /** Content fingerprint of the detail page at delivery time; "" when unknown (listing-only delivery, baseline). */
    hash: string;
}
export interface DeltaState {
    version: 2;
    /** idGestion -> "ESTADO|hash" (estado list the id was last seen in + detail fingerprint, "" when unknown). */
    seen: Record<string, string>;
    lastRunAt: string | null;
    /** Highest idGestion delivered so far - bounds a delta walk under `newest` order. */
    watermark: number | null;
    /**
     * Set when a delta walk was cut short by maxItems: the idGestion of the
     * oldest row the walk reached. Rows below it may still be undelivered, so
     * the next walk must not early-stop (nor apply the watermark) before it
     * has passed this floor. Cleared by a complete walk.
     */
    backlogFloor: number | null;
    /**
     * Informational: set by the FIRST (cold) delta run when maxItems cut its
     * delivery short - the idGestion of the oldest row it delivered. The
     * baseline itself is NOT this threshold but the `seen` snapshot: the cold
     * run walks every selected list to its end and marks every undelivered
     * row seen (hash ""), because on this site ids follow creation, not the
     * order in which rows enter the ET / CO lists (see fetchGestiones.ts).
     */
    baselineFloor: number | null;
    filtersSignature: string | null;
}
export declare function emptyState(filtersSignature: string | null): DeltaState;
/** A store that has never completed a run - the next delta run establishes the baseline. */
export declare function isColdState(state: DeltaState): boolean;
export declare function stateStoreName(deltaStateName: string): string;
export declare function encodeSeen(estado: EstadoCode | null, hash: string | null): string;
export declare function decodeSeen(value: string | undefined): SeenEntry | null;
export declare function loadState(storeName: string, filtersSignature: string | null, reset: boolean): Promise<DeltaState>;
/** Record that an idGestion was delivered (or intentionally excluded) in the given estado list with the given fingerprint. */
export declare function markSeen(state: DeltaState, idGestion: string, estado: EstadoCode | null, hash: string | null): void;
export declare function forget(state: DeltaState, idGestion: string): void;
/**
 * After a delta walk: remember how deep an INCOMPLETE walk got (so the next
 * run keeps walking past the known block down to the undelivered rows), or
 * clear the floor once a walk ran to its natural end.
 */
export declare function recordWalkCoverage(state: DeltaState, cold: boolean, truncated: boolean, oldestReachedId: number | null): void;
/** Keep the map bounded: drop the lowest (oldest) ids first. */
export declare function pruneState(state: DeltaState, max?: number): void;
export declare function saveState(storeName: string, state: DeltaState, runAt: string): Promise<void>;
//# sourceMappingURL=state.d.ts.map