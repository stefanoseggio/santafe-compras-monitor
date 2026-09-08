/* eslint-disable no-param-reassign -- the delta state is an in-place mutable accumulator by design */
import { Actor, log } from 'apify';
// Delta state lives in a NAMED key-value store (the run's default store is
// isolated per run and would not survive between scheduled runs). One store
// per delta-state name, so two schedules with different filters never poison
// each other's memory - the name defaults to a hash of the filter set (see
// input.ts) and can be pinned explicitly with the `deltaStateName` input.
const STORE_PREFIX = 'santafe-compras-monitor-state';
const STATE_KEY = 'state';
// The whole register is ~31,000 processes and grows by ~1,200 a year, so
// 50,000 entries holds everything for decades; the JSON stays under 4 MB.
export const MAX_SEEN_ENTRIES = 50_000;
export function emptyState(filtersSignature) {
    return {
        version: 2,
        seen: {},
        lastRunAt: null,
        watermark: null,
        backlogFloor: null,
        baselineFloor: null,
        filtersSignature,
    };
}
/** A store that has never completed a run - the next delta run establishes the baseline. */
export function isColdState(state) {
    return state.lastRunAt === null && Object.keys(state.seen).length === 0;
}
export function stateStoreName(deltaStateName) {
    const safe = deltaStateName
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30);
    return `${STORE_PREFIX}-${safe || 'default'}`;
}
export function encodeSeen(estado, hash) {
    return `${estado ?? ''}|${hash ?? ''}`;
}
export function decodeSeen(value) {
    if (value === undefined)
        return null;
    const idx = value.indexOf('|');
    if (idx === -1)
        return { estado: null, hash: '' };
    const estado = value.slice(0, idx);
    return {
        estado: estado === 'AP' || estado === 'ET' || estado === 'CO' ? estado : null,
        hash: value.slice(idx + 1),
    };
}
export async function loadState(storeName, filtersSignature, reset) {
    if (reset) {
        log.info(`resetState=true - starting from an empty memory in store "${storeName}".`);
        return emptyState(filtersSignature);
    }
    const store = await Actor.openKeyValueStore(storeName);
    const stored = await store.getValue(STATE_KEY);
    if (stored && stored.version === 2 && stored.seen && typeof stored.seen === 'object') {
        stored.watermark ??= null;
        stored.backlogFloor ??= null;
        stored.baselineFloor ??= null;
        stored.lastRunAt ??= null;
        if (stored.filtersSignature && filtersSignature && stored.filtersSignature !== filtersSignature) {
            log.warning(`Delta store "${storeName}" was built with a different filter set - records matching the new filters but already seen under the old ones will not be re-delivered. Use resetState=true to re-baseline.`);
        }
        return stored;
    }
    // Every delta-state name starts from an empty memory. The v1 store
    // (`santafe-compras-monitor-delta-state`, per-estado id lists written
    // BEFORE delivery) is deliberately NOT adopted: inheriting it would make
    // the first v2 run non-cold (no baseline) and could suppress records a
    // v1 run had marked seen without ever delivering them.
    return emptyState(filtersSignature);
}
/** Record that an idGestion was delivered (or intentionally excluded) in the given estado list with the given fingerprint. */
export function markSeen(state, idGestion, estado, hash) {
    state.seen[idGestion] = encodeSeen(estado, hash);
    const id = Number(idGestion);
    if (Number.isFinite(id) && (state.watermark === null || id > state.watermark))
        state.watermark = id;
}
export function forget(state, idGestion) {
    delete state.seen[idGestion];
}
/**
 * After a delta walk: remember how deep an INCOMPLETE walk got (so the next
 * run keeps walking past the known block down to the undelivered rows), or
 * clear the floor once a walk ran to its natural end.
 */
export function recordWalkCoverage(state, cold, truncated, oldestReachedId) {
    if (cold) {
        // The first run defines the baseline: whatever it could not deliver is
        // history (marked seen by main.ts from the walk's 'baseline' exclusions),
        // not backlog. The floor is kept for the run summary only.
        state.baselineFloor = truncated ? oldestReachedId : null;
        state.backlogFloor = null;
        return;
    }
    if (!truncated) {
        state.backlogFloor = null;
        return;
    }
    if (oldestReachedId === null)
        return; // nothing usable to anchor on - keep whatever floor exists
    state.backlogFloor =
        state.backlogFloor !== null && state.backlogFloor < oldestReachedId ? state.backlogFloor : oldestReachedId;
}
/** Keep the map bounded: drop the lowest (oldest) ids first. */
export function pruneState(state, max = MAX_SEEN_ENTRIES) {
    const ids = Object.keys(state.seen);
    if (ids.length <= max)
        return;
    ids.sort((a, b) => Number(a) - Number(b));
    const drop = ids.length - max;
    for (let i = 0; i < drop; i++)
        delete state.seen[ids[i]];
    log.info(`Pruned ${drop} oldest entries from the delta state (cap ${max}).`);
}
export async function saveState(storeName, state, runAt) {
    state.lastRunAt = runAt;
    pruneState(state);
    const store = await Actor.openKeyValueStore(storeName);
    await store.setValue(STATE_KEY, state);
}
//# sourceMappingURL=state.js.map