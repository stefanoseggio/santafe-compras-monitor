import { log } from 'apify';

import type { DateRangePreset } from './dateFilter.js';
import { isWithinDateRange, parseSantaFeDate } from './dateFilter.js';
import { fetchWithRetry } from './http.js';
import type { EstadoCode, ListingItem } from './types.js';

const LISTING_URL = 'https://www.santafe.gov.ar/gestionesdecompras/site/AppAjax.php';
const PAGE_SIZE = 50;

interface ListingResponse {
    success: boolean;
    data: ListingItem[];
    totalRecords?: string;
}

export interface ListingEntry {
    estado: EstadoCode;
    item: ListingItem;
    isNew: boolean;
}

export interface FetchListingResult {
    entries: ListingEntry[];
    allIdsByEstado: Record<string, string[]>;
}

// The site's own search page (site/index.php) drives this same read-only
// JSON endpoint via query-string params, no session/postback needed.
// `estado` codes verified live: AP = Apertura Proxima, ET = En Tramite, CO
// = Concluido (matching the response's own `extraData.{ap,et,co}Total`
// breakdown). `anio` was tested and doesn't appear to filter results in
// any observable way, so it's omitted here rather than implying a filter
// that doesn't actually work.
//
// DELTA ENGINE NOTE - no early-stop pagination: verified live 2026-09-06
// that this listing is NOT reliably sorted newest-first for any estado.
// `estado=AP` is sorted strictly ascending by `fechaHoraAperturaFija` (the
// *soonest upcoming opening* first) - a brand-new AP record with an
// opening date weeks out lands near the END of the list, not the front, so
// an early-stop guard would falsely conclude "nothing new" the moment it
// hit a run of already-seen ids near the top. `estado=ET`/`CO` show no
// correlation between list position and either `idGestion` or any date
// field at all (confirmed by direct query - consecutive positions jump
// between unrelated ids and dates in both directions); their order is
// stable within a session but not tied to recency. So `onlyNew` here is a
// SAFE POST-FILTER: this function always walks pages exactly as it did
// before this input existed (stopping only on `maxItems` or end-of-data,
// same as always), and filtering to unseen-only happens after the full
// walk, in the caller - never by skipping pages early.
export async function fetchListing(
    estados: EstadoCode[],
    maxItems: number,
    seenIdsByEstado: Record<string, ReadonlySet<string>>,
    onlyNew: boolean,
    dateRange: DateRangePreset | undefined,
    now: Date,
): Promise<FetchListingResult> {
    const rawEntries: { estado: EstadoCode; item: ListingItem }[] = [];
    const allIdsByEstado: Record<string, string[]> = {};

    for (const estado of estados) {
        allIdsByEstado[estado] = [];
        if (rawEntries.length >= maxItems) break;

        let start = 0;
        for (;;) {
            const url = `${LISTING_URL}?a=consultas.getContrataciones&estado=${estado}&start=${start}&limit=${PAGE_SIZE}`;
            const response = await fetchWithRetry(url);
            const page = (await response.json()) as ListingResponse;

            if (!page.success || page.data.length === 0) {
                log.info(`estado=${estado}: sin mas resultados en start=${start}.`);
                break;
            }

            for (const item of page.data) {
                if (rawEntries.length >= maxItems) break;
                allIdsByEstado[estado].push(item.idGestion);
                rawEntries.push({ estado, item });
            }
            log.info(
                `estado=${estado} start=${start}: ${page.data.length} gestiones (total reportado: ${page.totalRecords ?? '?'})`,
            );

            if (page.data.length < PAGE_SIZE || rawEntries.length >= maxItems) break;
            start += PAGE_SIZE;
        }
    }

    // Post-filter pass - the full walk above never short-circuits on
    // `onlyNew`/`dateRange`, see the note above for why.
    const entries: ListingEntry[] = [];
    for (const { estado, item } of rawEntries) {
        const seenIds = seenIdsByEstado[estado] ?? new Set<string>();
        const isNew = !seenIds.has(item.idGestion);
        if (onlyNew && !isNew) continue;
        if (dateRange && !isWithinDateRange(parseSantaFeDate(item.fechaHoraAperturaFija), dateRange, now)) continue;
        entries.push({ estado, item, isNew });
    }

    return { entries, allIdsByEstado };
}
