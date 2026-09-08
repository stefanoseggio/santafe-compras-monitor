import { Actor, log } from 'apify';

import type { Candidate, EnrichedCandidate, WalkResult } from './fetchGestiones.js';
import { buildRecord, enrichBatch, fetchDetailFor, fingerprintOf, walkListing } from './fetchGestiones.js';
import type { RunOptions } from './input.js';
import { resolveInput } from './input.js';
import { liveLookups } from './lookups.js';
import type { DeltaState } from './state.js';
import {
    decodeSeen,
    forget,
    isColdState,
    loadState,
    markSeen,
    recordWalkCoverage,
    saveState,
    stateStoreName,
} from './state.js';
import type { EstadoCode, GestionRecord } from './types.js';
import { listingUrl } from './urls.js';

// Pay-per-event names. Both must exist in the actor's pricing configuration
// on the platform (see README "Pricing"): a detail-enriched record is charged
// as `result`, a listing-only record (fetchDetail=false, or a detail page
// that is not published) as the cheaper `result-summary`.
const EVENT_DETAIL = 'result';
const EVENT_SUMMARY = 'result-summary';

const DELIVERY_BATCH_SIZE = 15;
const PERSIST_EVERY_N_DELIVERED = 50;
// Known open records re-read per run for amendments, and vanished open
// records probed per run for a status change - both bounded so a run's
// uncharged detail traffic stays in the hundreds, never thousands.
const MAX_RECHECKS_PER_RUN = 1000;
const MAX_SWEEP_PER_RUN = 300;

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
    return out;
}

interface DeliveryStats {
    chargeLimitReached: boolean;
    deferred: number;
    rechecked: number;
    recheckUnchanged: number;
    hashFilled: number;
    swept: number;
    sweptUnpublished: number;
}

/**
 * Delivers records OLDEST-FIRST (lowest idGestion first) in small batches,
 * persisting the seen-map only for records actually stored (and charged).
 * Oldest-first matters: if a run dies half-way, the undelivered records are
 * the NEWEST ones, i.e. the exact rows the next delta walk visits first - so
 * nothing is ever skipped. The dataset is therefore a chronological
 * append-only log; the dataset views display it newest-first.
 */
class Delivery {
    readonly records: GestionRecord[] = [];

    readonly stats: DeliveryStats = {
        chargeLimitReached: false,
        deferred: 0,
        rechecked: 0,
        recheckUnchanged: 0,
        hashFilled: 0,
        swept: 0,
        sweptUnpublished: 0,
    };

    private readonly isPayPerEvent: boolean;

    private sinceLastPersist = 0;

    private dirty = false;

    private readonly onPlatformEvent = (): void => {
        void this.persist();
    };

    constructor(
        private readonly state: DeltaState,
        private readonly storeName: string,
        private readonly runAt: string,
        private readonly options: RunOptions,
        private readonly now: Date,
    ) {
        this.isPayPerEvent = Actor.getChargingManager().getPricingInfo().isPayPerEvent;
        Actor.on('migrating', this.onPlatformEvent);
        Actor.on('aborting', this.onPlatformEvent);
    }

    get room(): number {
        return this.options.maxItems - this.records.length;
    }

    get stopped(): boolean {
        return this.stats.chargeLimitReached || this.room <= 0;
    }

    async close(): Promise<void> {
        await this.persist();
        Actor.off('migrating', this.onPlatformEvent);
        Actor.off('aborting', this.onPlatformEvent);
    }

    private async persist(): Promise<void> {
        if (!this.dirty) return;
        await saveState(this.storeName, this.state, this.runAt);
        this.dirty = false;
        this.sinceLastPersist = 0;
    }

    /** Push a group of records under one charge event; mark seen exactly those the SDK stored. */
    private async push(eventName: string, items: EnrichedCandidate[]): Promise<void> {
        if (items.length === 0 || this.stats.chargeLimitReached) return;
        const result = await Actor.pushData(
            items.map((e) => e.record),
            eventName,
        );
        // In pay-per-event mode the SDK stores only as many items as the
        // customer's spending limit allows and reports that count; outside
        // PPE (local runs, tests) everything is stored and nothing charged.
        const stored = this.isPayPerEvent ? result.chargedCount : items.length;
        for (const { record, candidate } of items.slice(0, stored)) {
            this.records.push(record);
            markSeen(this.state, candidate.idGestion, record.estado, record.contentHash ?? '');
            this.dirty = true;
            this.sinceLastPersist += 1;
        }
        if (result.eventChargeLimitReached) {
            this.stats.chargeLimitReached = true;
            log.warning(
                `Spending limit reached after ${this.records.length} record(s) - stopping. Undelivered records will be picked up by the next run.`,
            );
        }
        if (this.sinceLastPersist >= PERSIST_EVERY_N_DELIVERED) await this.persist();
    }

    /** Deliver a batch that is already enriched: detail records as `result`, the rest as `result-summary`; transient detail failures are deferred (left unseen). */
    private async pushBatch(enriched: EnrichedCandidate[]): Promise<void> {
        const detailed: EnrichedCandidate[] = [];
        const summaries: EnrichedCandidate[] = [];
        for (const e of enriched) {
            if (e.detail?.status === 'error') {
                this.stats.deferred += 1;
                continue;
            }
            if (this.room - detailed.length - summaries.length <= 0) break;
            (e.record.detailFetched ? detailed : summaries).push(e);
        }
        await this.push(EVENT_DETAIL, detailed);
        await this.push(EVENT_SUMMARY, summaries);
    }

    async deliverCandidates(walk: WalkResult): Promise<void> {
        const queue = [...walk.candidates].sort((a, b) => a.idNumber - b.idNumber);
        let attempted = 0;
        for (let offset = 0; offset < queue.length && !this.stopped; offset += DELIVERY_BATCH_SIZE) {
            const batch = queue.slice(offset, offset + DELIVERY_BATCH_SIZE);
            const enriched = await enrichBatch(batch, {
                fetchDetail: this.options.fetchDetail,
                maxConcurrency: this.options.maxConcurrency,
                now: this.now,
            });
            attempted += batch.length;
            await this.pushBatch(enriched);
            log.info(`Delivered ${this.records.length}/${queue.length}.`);
        }
        if (this.options.fetchDetail && attempted > 0 && this.stats.deferred === attempted) {
            throw new Error(
                `every one of the ${attempted} detail pages failed to load while the listing worked - the detail endpoint is blocked or down. Nothing was marked as seen; the next run will retry.`,
            );
        }
        if (this.stats.deferred > 0) {
            log.warning(
                `${this.stats.deferred} record(s) were NOT delivered because their detail page could not be fetched; they stay unseen and the next run retries them.`,
            );
        }
    }

    /**
     * Known open records whose listing row did not change may still have been
     * amended (a circular, an acta de apertura, a new opening date...). Their
     * detail pages are re-read and compared with the stored fingerprint; only
     * a real change is delivered (and charged) as UPDATED.
     */
    async recheckKnown(walk: WalkResult): Promise<void> {
        if (walk.rechecks.length === 0 || this.stopped) {
            if (walk.rechecks.length > 0)
                log.info(`Skipping ${walk.rechecks.length} re-check(s): maxItems or spending limit already reached.`);
            return;
        }
        let queue = [...walk.rechecks].sort((a, b) => b.idNumber - a.idNumber);
        if (queue.length > MAX_RECHECKS_PER_RUN) {
            log.warning(
                `${queue.length} known open records qualify for a re-check; only the ${MAX_RECHECKS_PER_RUN} newest are re-read this run. Lower recheckWindowDays to bound this.`,
            );
            queue = queue.slice(0, MAX_RECHECKS_PER_RUN);
        }
        log.info(`Re-reading ${queue.length} known open record(s) for amendments (uncharged unless changed)...`);
        const scrapedAt = this.now.toISOString();
        for (let offset = 0; offset < queue.length && !this.stopped; offset += DELIVERY_BATCH_SIZE) {
            const batch = queue.slice(offset, offset + DELIVERY_BATCH_SIZE);
            const enriched = await enrichBatch(batch, {
                fetchDetail: true,
                maxConcurrency: this.options.maxConcurrency,
                now: this.now,
            });
            const changed: EnrichedCandidate[] = [];
            for (const e of enriched) {
                if (e.detail?.status !== 'ok') continue; // unreachable or unpublished: keep the old fingerprint, retry next run
                this.stats.rechecked += 1;
                const hash = fingerprintOf(e.detail.detail);
                const previous = e.candidate.previousHash ?? '';
                if (previous === '') {
                    // First fingerprint for a record delivered listing-only or excluded as
                    // baseline: remember it silently - not an update, just a reference point.
                    markSeen(this.state, e.candidate.idGestion, e.candidate.estado, hash);
                    this.dirty = true;
                    this.stats.hashFilled += 1;
                } else if (hash !== previous) {
                    const candidate: Candidate = {
                        ...e.candidate,
                        eventType: 'UPDATED',
                        isNew: false,
                        excludedBy: null,
                    };
                    changed.push({
                        candidate,
                        detail: e.detail,
                        record: buildRecord(candidate, e.detail, this.now, scrapedAt),
                    });
                } else {
                    this.stats.recheckUnchanged += 1;
                }
            }
            if (changed.length > 0) await this.pushBatch(changed);
            if (this.sinceLastPersist >= PERSIST_EVERY_N_DELIVERED || this.dirty) await this.persist();
        }
        log.info(
            `Re-check done: ${this.stats.rechecked} read, ${this.stats.recheckUnchanged} unchanged, ${this.stats.hashFilled} fingerprinted, ${this.records.filter((r) => r.event_type === 'UPDATED').length} updated.`,
        );
    }

    /**
     * A process that was in an open list (AP / ET) on a previous run and is
     * absent from every open list walked to its end this run has moved on
     * (opened, concluded) or was withdrawn. Its detail page tells which:
     * a different Estado is delivered as STATUS_CHANGE, a vanished page is
     * forgotten so it can come back as new if it is republished.
     */
    async sweepVanished(walk: WalkResult): Promise<void> {
        if (!this.options.onlyNew || !this.options.fetchDetail || !this.options.eventTypes.has('STATUS_CHANGE')) return;
        const sweepable = new Set<EstadoCode>();
        for (const estado of ['AP', 'ET'] as const) {
            if (this.options.estados.includes(estado) && walk.walkedToEnd.has(estado)) sweepable.add(estado);
        }
        if (sweepable.size === 0) return;
        let vanished = Object.entries(this.state.seen)
            .map(([id, value]) => ({ id, entry: decodeSeen(value) }))
            .filter(({ id, entry }) => entry?.estado && sweepable.has(entry.estado) && !walk.walkedIds.has(id))
            .sort((a, b) => Number(b.id) - Number(a.id));
        if (vanished.length === 0) return;
        if (this.stopped) {
            log.info(
                `Skipping the status sweep of ${vanished.length} vanished record(s): maxItems or spending limit already reached.`,
            );
            return;
        }
        if (vanished.length > MAX_SWEEP_PER_RUN) {
            log.warning(
                `${vanished.length} known open records vanished from the lists; probing the ${MAX_SWEEP_PER_RUN} newest this run, the rest next run.`,
            );
            vanished = vanished.slice(0, MAX_SWEEP_PER_RUN);
        }
        log.info(
            `Status sweep: ${vanished.length} record(s) left the ${[...sweepable].join('/')} list(s) - reading their detail pages.`,
        );
        const scrapedAt = this.now.toISOString();
        for (let offset = 0; offset < vanished.length && !this.stopped; offset += DELIVERY_BATCH_SIZE) {
            const batch = vanished.slice(offset, offset + DELIVERY_BATCH_SIZE);
            const details = await Promise.all(batch.map(async ({ id }) => fetchDetailFor(id)));
            const changed: EnrichedCandidate[] = [];
            batch.forEach(({ id, entry }, i) => {
                const detail = details[i];
                if (detail.status === 'error') return; // retry next run
                if (detail.status === 'unpublished') {
                    forget(this.state, id);
                    this.dirty = true;
                    this.stats.sweptUnpublished += 1;
                    return;
                }
                this.stats.swept += 1;
                const newEstado = detail.detail.estadoCode;
                if (newEstado === null || newEstado === entry?.estado) return; // filtered out of the list for another reason
                const candidate: Candidate = {
                    item: null,
                    idGestion: id,
                    idNumber: Number(id),
                    estado: newEstado,
                    previousEstado: entry?.estado ?? null,
                    previousHash: entry?.hash ?? null,
                    eventType: 'STATUS_CHANGE',
                    isNew: false,
                    openingAt: null,
                    excludedBy: null,
                };
                changed.push({ candidate, detail, record: buildRecord(candidate, detail, this.now, scrapedAt) });
            });
            if (changed.length > 0) await this.pushBatch(changed);
            if (this.dirty) await this.persist();
        }
        log.info(
            `Status sweep done: ${this.stats.swept} read, ${this.stats.sweptUnpublished} unpublished/forgotten, ${this.records.filter((r) => r.event_type === 'STATUS_CHANGE' && r.fechaHoraApertura === null).length} status change(s) delivered.`,
        );
    }
}

async function run(): Promise<void> {
    const now = new Date();
    const runAt = now.toISOString();
    const resolved = await resolveInput((await Actor.getInput()) ?? {}, now, liveLookups());
    const { queries, options } = resolved;
    const firstListingUrl = listingUrl(queries[0]);

    log.info(
        `Query: ${firstListingUrl}${queries.length > 1 ? ` (+${queries.length - 1} more estado/tipo queries)` : ''}`,
    );
    for (const [k, v] of Object.entries(resolved.resolvedNames)) log.info(`Filter ${k} = ${v}`);
    log.info(
        `Mode: ${options.onlyNew ? 'delta (only new/changed)' : 'full'} | estados=${options.estados.join(',')} | sort=${resolved.filters.sortBy} | maxItems=${options.maxItems} | fetchDetail=${options.fetchDetail} | concurrency=${options.maxConcurrency} | recheckWindowDays=${options.recheckWindowDays}${options.openingFrom || options.openingTo ? ` | opening ${options.openingFrom ?? '...'}..${options.openingTo ?? '...'}` : ''}`,
    );

    const storeName = stateStoreName(options.deltaStateName);
    const state = await loadState(storeName, resolved.filtersSignature, options.resetState);
    const cold = isColdState(state);
    log.info(
        `Delta state store: ${storeName} (${cold ? 'cold - this run sets the baseline' : `${Object.keys(state.seen).length} known ids`}, watermark ${state.watermark ?? 'none'}, backlog floor ${state.backlogFloor ?? 'none'}, baseline floor ${state.baselineFloor ?? 'none'})`,
    );

    const walk = await walkListing({
        queries,
        maxItems: options.maxItems,
        onlyNew: options.onlyNew,
        seen: state.seen,
        watermark: state.watermark,
        backlogFloor: options.onlyNew ? state.backlogFloor : null,
        baselineFloor: options.onlyNew ? state.baselineFloor : null,
        eventTypes: options.eventTypes,
        openingFrom: options.openingFrom,
        openingTo: options.openingTo,
        recheckWindowDays: options.recheckWindowDays,
        fetchDetail: options.fetchDetail,
        now,
    });
    if (options.onlyNew) {
        // Candidates are in walk order (each estado newest-first); the last one
        // is the oldest row this walk reached - everything below is unexplored.
        recordWalkCoverage(state, cold, walk.truncatedByMaxItems, walk.candidates.at(-1)?.idNumber ?? null);
        if (walk.truncatedByMaxItems && cold) {
            log.info(
                `Baseline set at idGestion ${state.baselineFloor ?? 'n/a'}: this first run delivers the ${walk.candidates.length} most recently created processes; older ones are history and later runs return only what is new or changed after it.`,
            );
        } else if (walk.truncatedByMaxItems) {
            log.warning(
                `Backlog floor set to idGestion ${state.backlogFloor ?? 'n/a'} - the next delta run will continue below the block delivered now.`,
            );
        }
    }
    const matched = walk.totalMatching !== null ? walk.totalMatching.toLocaleString('en-US') : 'unknown';
    log.info(
        `Walk finished: ${walk.candidates.length} to deliver, ${walk.rechecks.length} known open records to re-check, ${walk.excluded.length} excluded, ${walk.pagesWalked} page(s), stop=${walk.stopReason}, ${matched} matching on the register.`,
    );
    await Actor.setStatusMessage(
        `Found ${walk.candidates.length} record(s) to deliver (${matched} match your filters on the register). Fetching detail...`,
    );

    const delivery = new Delivery(state, storeName, runAt, options, now);
    try {
        await delivery.deliverCandidates(walk);
        await delivery.recheckKnown(walk);
        await delivery.sweepVanished(walk);
    } finally {
        await delivery.close();
    }

    // Records that were walked but intentionally not delivered become "seen"
    // only once the run completed normally - never on a crash, so nothing is
    // lost. Rows outside the opening window are NOT remembered: they must
    // surface once they enter the window.
    for (const c of walk.excluded) {
        if (c.excludedBy === 'baseline' || c.excludedBy === 'eventType') {
            markSeen(state, c.idGestion, c.estado, c.previousHash ?? '');
        }
    }
    await saveState(storeName, state, runAt);

    const { records, stats } = delivery;
    const byType = countBy(records, (r) => r.event_type);
    const summary = {
        delivered: records.length,
        byEventType: byType,
        byEstado: countBy(records, (r) => r.estado),
        detailFetched: records.filter((r) => r.detailFetched).length,
        detailUnpublished: records.filter((r) => r.detailError === 'UNPUBLISHED').length,
        detailDeferred: stats.deferred,
        rechecked: stats.rechecked,
        recheckUnchanged: stats.recheckUnchanged,
        recheckFingerprinted: stats.hashFilled,
        swept: stats.swept,
        sweptUnpublished: stats.sweptUnpublished,
        totalMatchingOnRegister: walk.totalMatching,
        totalsByEstado: walk.totalsByEstado,
        pagesWalked: walk.pagesWalked,
        stopReason: walk.stopReason,
        truncatedByMaxItems: walk.truncatedByMaxItems,
        chargeLimitReached: stats.chargeLimitReached,
        excluded: countBy(walk.excluded, (c) => c.excludedBy ?? 'none'),
        mode: options.onlyNew ? 'delta' : 'full',
        deltaStateStore: storeName,
        knownIdsAfterRun: Object.keys(state.seen).length,
        watermark: state.watermark,
        backlogFloor: state.backlogFloor,
        baselineFloor: state.baselineFloor,
        estados: options.estados,
        resolvedFilters: resolved.resolvedNames,
        listingUrl: firstListingUrl,
        runAt,
    };
    await Actor.setValue('OUTPUT', summary);

    const parts = [`${summary.delivered} delivered`];
    if (byType.NEW_LISTING) parts.push(`${byType.NEW_LISTING} new`);
    if (byType.STATUS_CHANGE) parts.push(`${byType.STATUS_CHANGE} status changes`);
    if (byType.UPDATED) parts.push(`${byType.UPDATED} updated`);
    if (summary.detailUnpublished) parts.push(`${summary.detailUnpublished} without detail`);
    if (stats.deferred) parts.push(`${stats.deferred} deferred (detail page unreachable)`);
    if (walk.truncatedByMaxItems) parts.push('maxItems reached - more available');
    if (stats.chargeLimitReached) parts.push('spending limit reached');
    await Actor.setStatusMessage(`${parts.join(' · ')} · ${matched} matching on the register`, {
        isStatusMessageTerminal: true,
    });
    log.info(`Done: ${parts.join(', ')}.`);
}

await Actor.init();
try {
    await run();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.exception(error instanceof Error ? error : new Error(message), 'Run failed');
    await Actor.setValue('LAST_ERROR', { message, at: new Date().toISOString() });
    await Actor.fail(`Santa Fe Gestiones de Compra extraction failed: ${message}`);
}
await Actor.exit();
