import { log } from 'apify';

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
}

// The site's own search page (site/index.php) drives this same read-only
// JSON endpoint via query-string params, no session/postback needed.
// `estado` codes verified live: AP = Apertura Proxima, ET = En Tramite,
// CO = Concluido (matching the response's own `extraData.{ap,et,co}Total`
// breakdown). `anio` was tested and doesn't appear to filter results in
// any observable way, so it's omitted here rather than implying a filter
// that doesn't actually work.
export async function fetchListing(estados: EstadoCode[], maxItems: number): Promise<ListingEntry[]> {
    const results: ListingEntry[] = [];

    for (const estado of estados) {
        if (results.length >= maxItems) break;

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
                if (results.length >= maxItems) break;
                results.push({ estado, item });
            }
            log.info(`estado=${estado} start=${start}: ${page.data.length} gestiones (total reportado: ${page.totalRecords ?? '?'})`);

            if (page.data.length < PAGE_SIZE || results.length >= maxItems) break;
            start += PAGE_SIZE;
        }
    }

    return results;
}
