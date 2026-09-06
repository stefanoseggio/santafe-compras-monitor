import { Actor, log } from 'apify';

import { fetchDetail } from './fetchDetail.js';
import { fetchListing } from './fetchListing.js';
import { loadState, saveDatasetState } from './state.js';
import type { ActorInput, GestionRecord } from './types.js';

const RESULT_EVENT_NAME = 'result';
const DETAIL_URL_BASE = 'https://www.santafe.gov.ar/gestionesdecompras/site/gestion.php';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const {
        estados = ['AP'],
        fetchDetail: shouldFetchDetail = true,
        maxItems = 200,
        onlyNew = false,
        dateRange,
    } = input;

    const now = new Date();
    const scrapedAt = now.toISOString();

    let state = await loadState();
    const seenIdsByEstado: Record<string, ReadonlySet<string>> = {};
    for (const estado of estados) {
        seenIdsByEstado[estado] = new Set(state.seenIds[estado] ?? []);
    }

    const { entries, allIdsByEstado } = await fetchListing(estados, maxItems, seenIdsByEstado, onlyNew, dateRange, now);
    log.info(`Total gestiones listadas: ${entries.length} (onlyNew=${onlyNew}, dateRange=${dateRange ?? 'none'})`);

    // Persist state before the push/charge loop below, matching this
    // portfolio's established delta-engine shape: every id walked this run
    // (not just the ones that pass onlyNew/dateRange) gets marked seen, so
    // a dateRange-filtered-out record isn't re-reported as "new" next run
    // just because it didn't make it into this run's output.
    for (const estado of estados) {
        state = await saveDatasetState(state, estado, allIdsByEstado[estado] ?? [], scrapedAt);
    }

    let pushed = 0;
    for (const { estado, item, isNew } of entries) {
        const detail = shouldFetchDetail ? await fetchDetail(item.idGestion) : null;

        const record: GestionRecord = {
            idGestion: item.idGestion,
            estado,
            tipoGestion: item.tipoGestion,
            numeroGestion: item.numeroGestion,
            anioGestion: item.anioGestion,
            fechaHoraApertura: item.fechaHoraApertura,
            objeto: item.objeto,
            comprador: item.comprador,
            valorPliego: item.valorPliego,
            numeroExpediente: item.numeroExpediente,
            detail,
            record_id: item.idGestion,
            event_type: 'NEW_LISTING',
            scraped_at: scrapedAt,
            is_new: isNew,
            source_url: `${DETAIL_URL_BASE}?idGestion=${item.idGestion}`,
        };

        await Actor.pushData(record);
        pushed += 1;

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            return;
        }
    }

    log.info(`Cargados ${pushed} items al dataset.`);
}
