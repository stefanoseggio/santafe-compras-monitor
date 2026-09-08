import { log } from 'apify';
import * as cheerio from 'cheerio';

import { fetchOptional, fetchWithRetry, mapWithConcurrency } from './http.js';
import {
    contentFingerprint,
    daysBetween,
    extractEmails,
    extractPhones,
    fold,
    isElectronicExpediente,
    isoToSiteDate,
    parseMoney,
    parseSiteDateTime,
    parseSiteDetailDateTime,
    siteCalendarDate,
    valorPliegoIsFree,
} from './normalize.js';
import type { ParsedDetail } from './parsers/detail.js';
import { parseDetailPage } from './parsers/detail.js';
import type { ListingPage } from './parsers/listing.js';
import { parseListingResponse } from './parsers/listing.js';
import { decodeSeen } from './state.js';
import type { EstadoCode, EventType, GestionRecord, ListingItem, ListingQuery } from './types.js';
import { DATA_SOURCE_ATTRIBUTION } from './types.js';
import { bidUrl, detailPath, detailUrl, documentsUrl, listingPath, printPdfUrl, TIPO_GESTION } from './urls.js';

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
     * idGestion of the oldest row the FIRST delta run delivered when its walk
     * was cut short. Unseen rows at or below it are history and are excluded
     * ('baseline') instead of being delivered on later runs.
     */
    baselineFloor?: number | null;
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
    /** true when more deliverable records matched than maxItems allowed. */
    truncatedByMaxItems: boolean;
    /** Every idGestion met on any page this run. */
    walkedIds: Set<string>;
    /** Estados whose every query ran to the end of its list (so absence from them is meaningful). */
    walkedToEnd: Set<EstadoCode>;
}

// The API honours `limit` up to at least 5,000 (live 2026-09-08: 2,000 rows
// in ~3 s, 5,000 in ~5 s). 2,000 keeps the whole open register (AP ~80,
// ET ~2,200) within one or two requests while a CO delta walk stays at two
// or three pages.
export const PAGE_SIZE = 2000;
// idGestion is allocated at creation and only approximately follows the
// publication order (live: 139028 was published after 139030), so the
// watermark stop keeps a generous margin of ids below the previous run's
// newest delivered id before it trusts that a page is entirely old.
const WATERMARK_MARGIN_IDS = 500;
const CONSECUTIVE_KNOWN_PAGES_TO_STOP = 2;
const PAGE_CAP = 200; // 400,000 rows - a runaway guard, never reached in practice
const NOT_A_LISTING_RETRIES = 2;

function walkResult(
    partial: Pick<WalkResult, 'candidates' | 'excluded' | 'rechecks' | 'walkedIds' | 'walkedToEnd'>,
    totals: Record<EstadoCode, number> | null,
    estados: EstadoCode[],
    pagesWalked: number,
    stopReason: StopReason,
    truncatedByMaxItems: boolean,
): WalkResult {
    const totalMatching = totals ? estados.reduce((sum, e) => sum + totals[e], 0) : null;
    return { ...partial, totalMatching, totalsByEstado: totals, pagesWalked, stopReason, truncatedByMaxItems };
}

async function loadListingPage(query: ListingQuery, start: number, limit: number): Promise<ListingPage> {
    const path = listingPath(query, start, limit);
    for (let attempt = 0; ; attempt++) {
        const body = await fetchWithRetry(path, { timeoutMs: 60_000 });
        const parsed = parseListingResponse(body);
        if (parsed.isListingPage) return parsed;
        if (attempt >= NOT_A_LISTING_RETRIES) {
            throw new Error(
                `santafe.gov.ar returned something that is not a Gestiones de Compra listing for estado=${query.estado} start=${start}${parsed.reason ? ` (site says: "${parsed.reason}")` : ''} - blocked, under maintenance, or the API changed. Aborting instead of reporting "nothing new". URL: ${path}`,
            );
        }
        log.warning(
            `estado=${query.estado} start=${start} did not look like a listing response - retrying (${attempt + 1}/${NOT_A_LISTING_RETRIES}).`,
        );
    }
}

/**
 * Walk every query (one per estado, newest-created first under `newest`
 * order) and decide, per row, whether it must be delivered, re-read, or
 * skipped. Never fetches detail pages.
 */
export async function walkListing(options: WalkOptions): Promise<WalkResult> {
    const { queries, maxItems, onlyNew, seen, watermark, eventTypes, openingFrom, openingTo, now } = options;
    const backlogFloor = options.backlogFloor ?? null;
    const baselineFloor = onlyNew ? (options.baselineFloor ?? null) : null;
    const sortedNewest = queries[0]?.filters.sortBy === 'newest';
    const candidates: Candidate[] = [];
    const excluded: Candidate[] = [];
    const rechecks: Candidate[] = [];
    const walkedIds = new Set<string>();
    const walkedToEnd = new Set<EstadoCode>();
    const estadosInWalk = [...new Set(queries.map((q) => q.estado))];
    const queriesPerEstado = new Map<EstadoCode, number>();
    const endedPerEstado = new Map<EstadoCode, number>();
    for (const q of queries) queriesPerEstado.set(q.estado, (queriesPerEstado.get(q.estado) ?? 0) + 1);
    const partial = { candidates, excluded, rechecks, walkedIds, walkedToEnd };

    // The watermark stop must never fire above an outstanding backlog: take
    // the lower of the two bounds when a floor is set.
    const cutoffBase =
        [watermark, backlogFloor].filter((v): v is number => v !== null).sort((a, b) => a - b)[0] ?? null;
    const watermarkCutoff = cutoffBase === null ? null : cutoffBase - WATERMARK_MARGIN_IDS;
    if (backlogFloor !== null) {
        log.info(
            `Previous delta walk was cut short - walking past the known block down to idGestion ${backlogFloor} before trusting the early-stop.`,
        );
    }
    const recheckSinceIso =
        options.recheckWindowDays > 0
            ? new Date(now.getTime() - options.recheckWindowDays * 86_400_000).toISOString()
            : null;
    const recheckEnabled = onlyNew && options.fetchDetail && eventTypes.has('UPDATED') && recheckSinceIso !== null;

    let totals: Record<EstadoCode, number> | null = null;
    let pagesWalked = 0;
    let lastEarlyStop: StopReason | null = null;

    for (const query of queries) {
        const { estado } = query;
        let start = 0;
        let consecutiveKnownPages = 0;
        let stoppedEarly = false;
        for (;;) {
            // In full mode we only need as many rows as are still deliverable;
            // in delta mode a full page is needed to judge whether it is known.
            const limit = onlyNew ? PAGE_SIZE : Math.min(PAGE_SIZE, Math.max(50, maxItems - candidates.length));
            const listing = await loadListingPage(query, start, limit);
            pagesWalked += 1;
            totals ??= listing.totals;
            const pageNo = Math.floor(start / PAGE_SIZE) + 1;
            if (listing.items.length === 0) {
                log.info(
                    `estado=${estado}${query.tipoGestion ? ` tipo=${query.tipoGestion}` : ''} start=${start}: no rows - end of list.`,
                );
                endedPerEstado.set(estado, (endedPerEstado.get(estado) ?? 0) + 1);
                break;
            }

            let pageHasChanges = false;
            let pageAllBelowWatermark = watermarkCutoff !== null;
            let pageAllBelowFloor = true; // vacuously true when no floor is set
            for (const item of listing.items) {
                if (walkedIds.has(item.idGestion)) continue; // duplicate across pages/queries
                walkedIds.add(item.idGestion);
                const idNumber = Number(item.idGestion);

                const previous = decodeSeen(seen[item.idGestion]);
                let eventType: EventType = 'NEW_LISTING';
                let isNew = false;
                let changed = false;
                let previousEstado: EstadoCode | null = null;
                if (previous === null) {
                    isNew = true;
                    changed = true;
                } else if (previous.estado !== null && previous.estado !== estado) {
                    eventType = 'STATUS_CHANGE';
                    changed = true;
                    previousEstado = previous.estado;
                }
                // Unseen rows at or below the baseline are history, not news: they
                // neither get delivered nor keep the walk alive.
                const belowBaseline = isNew && baselineFloor !== null && idNumber <= baselineFloor;
                const openingAt = parseSiteDateTime(item.fechaHoraAperturaFija);
                const openingDate = isoToSiteDate(openingAt);
                const windowSet = openingFrom !== null || openingTo !== null;
                const outsideWindow =
                    windowSet &&
                    (openingDate === null ||
                        (openingFrom !== null && openingDate < openingFrom) ||
                        (openingTo !== null && openingDate > openingTo));

                if (changed && !belowBaseline && !outsideWindow) pageHasChanges = true;
                if (watermarkCutoff === null || idNumber >= watermarkCutoff) pageAllBelowWatermark = false;
                if (backlogFloor !== null && idNumber >= backlogFloor) pageAllBelowFloor = false;

                const candidate: Candidate = {
                    item,
                    idGestion: item.idGestion,
                    idNumber,
                    estado,
                    previousEstado,
                    previousHash: previous?.hash ?? null,
                    eventType,
                    isNew,
                    openingAt,
                    excludedBy: null,
                };
                if (onlyNew && !changed) candidate.excludedBy = 'unchanged';
                else if (belowBaseline) candidate.excludedBy = 'baseline';
                else if (outsideWindow) candidate.excludedBy = 'openingDate';
                else if (!eventTypes.has(eventType)) candidate.excludedBy = 'eventType';

                if (candidate.excludedBy === 'unchanged') {
                    excluded.push(candidate);
                    // A known open process may have gained a circular, an acta or a
                    // preadjudicación without any visible change in the listing -
                    // only its detail page tells. Bound the re-reads by opening date.
                    if (
                        recheckEnabled &&
                        !outsideWindow &&
                        openingAt !== null &&
                        openingAt >= (recheckSinceIso as string)
                    ) {
                        rechecks.push(candidate);
                    }
                    continue;
                }
                if (candidate.excludedBy) {
                    excluded.push(candidate);
                    continue;
                }
                if (candidates.length >= maxItems) {
                    log.warning(
                        `maxItems=${maxItems} reached in estado=${estado} at start=${start} - at least one more matching record was NOT delivered this run. In delta mode the walk position is remembered and the next run continues past the already-delivered block; raise maxItems to catch up faster.`,
                    );
                    return walkResult(partial, totals, estadosInWalk, pagesWalked, 'max-items', true);
                }
                candidates.push(candidate);
            }

            const totalNote =
                listing.totalRecords !== null ? ` of ${listing.totalRecords.toLocaleString('en-US')}` : '';
            log.info(
                `estado=${estado}${query.tipoGestion ? ` tipo=${query.tipoGestion}` : ''} page ${pageNo} (start=${start}): ${listing.items.length} rows${totalNote}, ${candidates.length} to deliver so far, ${rechecks.length} to re-check.`,
            );

            start += listing.items.length;
            const reachedEnd = listing.totalRecords !== null && start >= listing.totalRecords;
            if (reachedEnd) {
                endedPerEstado.set(estado, (endedPerEstado.get(estado) ?? 0) + 1);
                break;
            }

            if (onlyNew) {
                // A fully-known page only counts towards the early-stop once the walk
                // is below any outstanding backlog floor: the block of rows delivered
                // by the truncated run sits ABOVE the rows it never reached.
                if (pageHasChanges) consecutiveKnownPages = 0;
                else if (pageAllBelowFloor) consecutiveKnownPages += 1;
                if (consecutiveKnownPages >= CONSECUTIVE_KNOWN_PAGES_TO_STOP) {
                    log.info(
                        `estado=${estado}: delta early-stop after ${CONSECUTIVE_KNOWN_PAGES_TO_STOP} consecutive pages with nothing new or changed.`,
                    );
                    stoppedEarly = true;
                    lastEarlyStop = 'delta-early-stop';
                    break;
                }
                if (sortedNewest && pageAllBelowWatermark) {
                    log.info(
                        `estado=${estado}: delta watermark stop - every row on this page is more than ${WATERMARK_MARGIN_IDS} ids below the previous run's newest record.`,
                    );
                    stoppedEarly = true;
                    lastEarlyStop = 'delta-watermark';
                    break;
                }
            }
            if (pagesWalked >= PAGE_CAP) {
                log.warning(`Page cap (${PAGE_CAP}) reached - stopping the walk.`);
                return walkResult(partial, totals, estadosInWalk, pagesWalked, 'page-cap', true);
            }
        }
        if (!stoppedEarly && (endedPerEstado.get(estado) ?? 0) >= (queriesPerEstado.get(estado) ?? 0)) {
            walkedToEnd.add(estado);
        }
    }

    return walkResult(partial, totals, estadosInWalk, pagesWalked, lastEarlyStop ?? 'end-of-results', false);
}

export type DetailResult =
    { status: 'ok'; detail: ParsedDetail } | { status: 'unpublished' } | { status: 'error'; message: string };

/**
 * Fetch and parse one detail page. A nonexistent / not-yet-published id
 * (HTTP 200 with "La gestión no existe o no está publicada aún", or a 404)
 * is 'unpublished'; a network/5xx failure after retries is 'error' - the
 * caller leaves such records unseen so the next run retries them.
 */
export async function fetchDetailFor(idGestion: string): Promise<DetailResult> {
    try {
        const html = await fetchOptional(detailPath(idGestion), { timeoutMs: 30_000 });
        if (html === null) return { status: 'unpublished' };
        const detail = parseDetailPage(cheerio.load(html));
        if (!detail.exists) return { status: 'unpublished' };
        return { status: 'ok', detail };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`Detail fetch failed for idGestion=${idGestion}: ${message}`);
        return { status: 'error', message };
    }
}

/** The part of a detail page that, when it changes, means the process was amended. */
export function fingerprintOf(detail: ParsedDetail): string {
    return contentFingerprint({
        estado: detail.estadoLabel,
        published: detail.publishedAtLocal,
        deadline: detail.submissionDeadlineLocal,
        opening: detail.openingAtLocal,
        openingNote: detail.openingNote,
        openingPlace: detail.openingPlace,
        submissionPlace: detail.submissionPlace,
        delivery: detail.deliveryPlaceAndDate,
        monto: detail.montoOriginalText,
        valorPliego: detail.valorPliego,
        objeto: detail.objeto,
        descripcion: detail.descripcion,
        modalidad: detail.modalidad,
        alcance: detail.alcance,
        rubros: detail.rubros.map((r) => r.raw),
        comitente: detail.organismoComitente,
        licitante: detail.organismoLicitante,
        contacto: detail.contactInfo,
        expedientes: detail.expedientes.map((e) => e.code),
        notes: detail.notes,
        documents: detail.documents.map((d) => `${d.kind}|${d.id ?? ''}|${d.nombre}`),
    });
}

function tipoGestionCode(name: string | null): string | null {
    if (!name) return null;
    const folded = fold(name);
    for (const [code, label] of Object.entries(TIPO_GESTION)) if (fold(label) === folded) return code;
    return null;
}

export function buildRecord(
    candidate: Candidate,
    detailResult: DetailResult | null,
    now: Date,
    scrapedAt = now.toISOString(),
): GestionRecord {
    const { item, idGestion, estado, eventType, isNew } = candidate;
    const detail = detailResult?.status === 'ok' ? detailResult.detail : null;
    const todayIso = siteCalendarDate(now);

    const tipoGestion = item?.tipoGestion ?? detail?.tipoGestionName ?? null;
    const numeroGestion = item?.numeroGestion ?? detail?.numeroGestion ?? null;
    const anioGestion = item?.anioGestion ?? detail?.anioGestion ?? null;
    const openingAt = candidate.openingAt ?? parseSiteDetailDateTime(detail?.openingAtLocal);
    const openingDate = isoToSiteDate(openingAt);
    const numeroExpediente = item?.numeroExpediente || detail?.expedientes[0]?.code || null;
    const electronic = isElectronicExpediente(numeroExpediente);
    const valorPliegoText = item?.valorPliego ?? detail?.valorPliego ?? null;
    const valorPliegoMoney = parseMoney(valorPliegoText);
    const monto = parseMoney(detail?.montoOriginalText);
    const publishedAt = parseSiteDetailDateTime(detail?.publishedAtLocal);
    const publishedDate = isoToSiteDate(publishedAt);
    const submissionDeadline = parseSiteDetailDateTime(detail?.submissionDeadlineLocal);
    const kinds = new Set((detail?.documents ?? []).map((d) => d.kind));
    const numeroAnio = item?.['numeroAño'] ?? (numeroGestion && anioGestion ? `${numeroGestion}-${anioGestion}` : null);

    let detailError: string | null = null;
    if (detailResult?.status === 'unpublished') detailError = 'UNPUBLISHED';
    else if (detailResult?.status === 'error') detailError = detailResult.message;

    return {
        idGestion,
        estado,
        tipoGestion,
        numeroGestion,
        anioGestion,
        fechaHoraApertura: item?.fechaHoraApertura ?? null,
        objeto: item?.objeto ?? detail?.objeto ?? null,
        comprador: item?.comprador ?? detail?.organismoLicitante ?? null,
        valorPliego: valorPliegoText,
        numeroExpediente: item?.numeroExpediente ?? numeroExpediente,
        detail: detail?.legacy ?? null,

        record_id: idGestion,
        event_type: eventType,
        scraped_at: scrapedAt,
        is_new: isNew,
        source_url: detailUrl(idGestion),
        data_source: DATA_SOURCE_ATTRIBUTION,

        idGestionNumber: candidate.idNumber,
        numeroAnio,
        tipoGestionCode: tipoGestionCode(tipoGestion),
        tipoModalidad: item?.tipoModalidad ?? detail?.modalidad ?? null,
        idOrganismoGestion: item?.idOrganismoGestion ?? null,
        objetoCompleto: item?.objetoCompleto ?? null,
        destinos: item?.destinos ?? null,
        fechaHoraAperturaFija: item?.fechaHoraAperturaFija ?? null,
        openingAt,
        openingDate,
        daysUntilOpening: daysBetween(todayIso, openingDate),
        isOpeningInFuture: openingAt === null ? null : openingAt > now.toISOString(),
        valorPliegoAmount: valorPliegoMoney?.amount ?? null,
        valorPliegoCurrency: valorPliegoMoney?.currency ?? null,
        valorPliegoIsFree: valorPliegoIsFree(valorPliegoText),
        previousEstado: candidate.previousEstado,
        isElectronic: electronic,
        bidUrl: electronic && numeroExpediente ? bidUrl(numeroExpediente) : null,
        printPdfUrl: printPdfUrl(idGestion),
        documentsUrl: documentsUrl(idGestion),

        detailFetched: detail !== null,
        detailError,
        estadoLabel: detail?.estadoLabel ?? null,
        estadoStage: detail?.estadoStage ?? null,
        estadoFromDetail: detail?.estadoCode ?? null,
        publishedAtLocal: detail?.publishedAtLocal ?? null,
        publishedAt,
        publishedDate,
        daysSincePublished: daysBetween(publishedDate, todayIso),
        modalidad: detail?.modalidad ?? null,
        alcance: detail?.alcance ?? null,
        descripcion: detail?.descripcion ?? null,
        rubros: detail?.rubros ?? [],
        rubroNames: [...new Set((detail?.rubros ?? []).map((r) => r.rubro).filter((r): r is string => r !== null))],
        subrubroNames: [
            ...new Set((detail?.rubros ?? []).map((r) => r.subrubro).filter((r): r is string => r !== null)),
        ],
        organismoComitente: detail?.organismoComitente ?? [],
        organismoLicitante: detail?.organismoLicitante ?? null,
        submissionPlace: detail?.submissionPlace ?? null,
        submissionDeadlineLocal: detail?.submissionDeadlineLocal ?? null,
        submissionDeadline,
        daysUntilDeadline: daysBetween(todayIso, isoToSiteDate(submissionDeadline)),
        openingPlace: detail?.openingPlace ?? null,
        openingAtDetailLocal: detail?.openingAtLocal ?? null,
        openingNote: detail?.openingNote ?? null,
        deliveryPlaceAndDate: detail?.deliveryPlaceAndDate ?? null,
        contactInfo: detail?.contactInfo ?? null,
        contactEmails: extractEmails(`${detail?.contactInfo ?? ''} ${detail?.submissionPlace ?? ''}`),
        contactPhones: extractPhones(detail?.contactInfo),
        valorPliegoDetail: detail?.valorPliego ?? null,
        montoOriginalText: detail?.montoOriginalText ?? null,
        montoOriginalAmount: monto?.amount ?? null,
        montoOriginalCurrency: monto?.currency ?? null,
        expedientes: detail?.expedientes ?? [],
        expediente: detail?.expedientes[0]?.code ?? null,
        expedienteUrl: detail?.expedientes[0]?.url ?? null,
        notes: detail?.notes ?? [],
        documents: detail?.documents ?? [],
        documentCount: detail?.documents.length ?? 0,
        documentKinds: [...kinds],
        hasPliego: kinds.has('pliego'),
        hasCircular: kinds.has('circular'),
        hasActaApertura: kinds.has('acta_apertura'),
        hasPreadjudicacion: kinds.has('preadjudicacion'),
        hasAdjudicacion: kinds.has('adjudicacion'),
        hasOrdenProvision: kinds.has('orden_provision'),
        hasCuadroComparativo: kinds.has('cuadro_comparativo'),
        contentHash: detail ? fingerprintOf(detail) : null,
    };
}

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
export async function enrichBatch(
    candidates: readonly Candidate[],
    options: EnrichOptions,
): Promise<EnrichedCandidate[]> {
    const scrapedAt = options.now.toISOString();
    if (!options.fetchDetail) {
        return candidates.map((candidate) => ({
            candidate,
            detail: null,
            record: buildRecord(candidate, null, options.now, scrapedAt),
        }));
    }
    const details = await mapWithConcurrency(candidates, options.maxConcurrency, async (c) =>
        fetchDetailFor(c.idGestion),
    );
    return candidates.map((candidate, i) => ({
        candidate,
        detail: details[i],
        record: buildRecord(candidate, details[i], options.now, scrapedAt),
    }));
}

export interface FetchGestionesOptions extends WalkOptions, EnrichOptions {}

/**
 * Convenience one-shot: walk + enrich everything. main.ts streams in batches
 * instead (so state is persisted only for delivered records); this is the
 * simpler entry point used by the live integration tests.
 */
export async function fetchGestiones(
    options: FetchGestionesOptions,
): Promise<{ records: GestionRecord[]; walk: WalkResult }> {
    const walk = await walkListing(options);
    const enriched = await enrichBatch(walk.candidates, options);
    return { records: enriched.map((e) => e.record), walk };
}
