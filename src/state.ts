import { Actor } from 'apify';

// A NAMED key-value store (not the run's default one, which is isolated per
// run) persists across scheduled runs of this actor - this is what makes
// "only new since last run" possible at all. Keyed per `estado` (AP/ET/CO)
// rather than a single flat list: a given `idGestion` legitimately moves
// through AP -> ET -> CO over its lifecycle, and each transition is a real,
// worth-reporting change of state for a recurring monitor - so the same id
// reappearing under a different estado should count as "new" again there,
// the same way HSE's convictions/notices id spaces are tracked separately.
const STATE_STORE_NAME = 'santafe-compras-monitor-delta-state';
const MAX_SEEN_IDS_PER_ESTADO = 3000;

export interface DeltaState {
    seenIds: Record<string, string[]>;
    lastRunAt: Record<string, string>;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<DeltaState>('state');
    return state ?? { seenIds: {}, lastRunAt: {} };
}

// NOTE: unlike a source verified newest-first, this actor's listing order
// is NOT a recency signal (see fetchListing.ts) - so "idsSeenThisRun first"
// below is only "whatever this run's walk happened to return", not "the
// newest ones". When the cap is exceeded, the ids dropped are a best
// effort, not a guaranteed-correct "keep the newest" trim; a dropped id
// re-appearing after aging out of the cap will be (harmlessly) reported as
// "new" again. Given maxItems defaults to 200 and the cap is 3000, this
// only matters for accounts running with an unusually large maxItems over
// many, many runs.
export async function saveDatasetState(
    state: DeltaState,
    estado: string,
    idsSeenThisRun: string[],
    runAt: string,
): Promise<DeltaState> {
    const previous = state.seenIds[estado] ?? [];
    const merged = [...idsSeenThisRun, ...previous.filter((id) => !idsSeenThisRun.includes(id))];
    const next: DeltaState = {
        seenIds: { ...state.seenIds, [estado]: merged.slice(0, MAX_SEEN_IDS_PER_ESTADO) },
        lastRunAt: { ...state.lastRunAt, [estado]: runAt },
    };
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', next);
    return next;
}
