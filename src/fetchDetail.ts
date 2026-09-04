import { log } from 'apify';
import * as cheerio from 'cheerio';

import { fetchWithRetry } from './http.js';
import { parseDetail } from './parsers/detail.js';
import type { GestionDetail } from './types.js';

const DETAIL_URL = 'https://www.santafe.gov.ar/gestionesdecompras/site/gestion.php';

export async function fetchDetail(idGestion: string): Promise<GestionDetail | null> {
    try {
        const response = await fetchWithRetry(`${DETAIL_URL}?idGestion=${idGestion}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        return parseDetail($);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`Fallo el detalle de idGestion=${idGestion} tras reintentos: ${message}`);
        return null;
    }
}
