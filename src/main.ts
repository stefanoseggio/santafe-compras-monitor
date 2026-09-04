import { Actor, log } from 'apify';

import { fetchDetail } from './fetchDetail.js';
import { fetchListing } from './fetchListing.js';
import type { ActorInput, GestionRecord } from './types.js';

const RESULT_EVENT_NAME = 'result';
const DETAIL_URL_BASE = 'https://www.santafe.gov.ar/gestionesdecompras/site/gestion.php';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { estados = ['AP'], fetchDetail: shouldFetchDetail = true, maxItems = 200 } = input;

    const listing = await fetchListing(estados, maxItems);
    log.info(`Total gestiones listadas: ${listing.length}`);

    let pushed = 0;
    for (const { estado, item } of listing) {
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
            detailUrl: `${DETAIL_URL_BASE}?idGestion=${item.idGestion}`,
            detail,
            scrapedAt: new Date().toISOString(),
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
