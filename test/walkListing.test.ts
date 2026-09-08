import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseDetailPage } from '../src/parsers/detail.js';
import { encodeSeen } from '../src/state.js';
import type { EstadoCode, ListingFilters, ListingQuery } from '../src/types.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const read = (name: string) => readFileSync(`${fixturesDir}/${name}`, 'utf-8');
const AP = read('listing_ap_desc.json'); // 78 rows = the whole AP list (totalRecords 78)
const ET = read('listing_et_desc_60.json'); // 60 of 2,214 rows
const CO = read('listing_co_desc_60.json'); // 60 of 28,921 rows
const DETAIL_AP = read('detail_138825.html');
const DETAIL_ET_CIRCULAR = read('detail_138676_circular_et.html');
const DETAIL_NONE = read('detail_nonexistent.html');
const BLOCKED = '<html><body><h1>Sitio en mantenimiento</h1></body></html>';
const REFUSED = JSON.stringify({ success: false, errors: { reason: 'Parámetro inválido' }, data: [] });

interface Listing {
    data: { idGestion: string }[];
    totalRecords: string;
    extraData: Record<string, string>;
}
const ids = (json: string): string[] => (JSON.parse(json) as Listing).data.map((d) => d.idGestion);
/** Same rows with every idGestion lowered by `delta` (keeps the newest-first order, makes a "deeper page"). */
function rekey(json: string, delta: number): string {
    const page = JSON.parse(json) as Listing;
    page.data = page.data.map((row) => ({ ...row, idGestion: String(Number(row.idGestion) - delta) }));
    return JSON.stringify(page);
}
const EMPTY = (base: string): string => JSON.stringify({ ...(JSON.parse(base) as Listing), data: [] });

const fetchWithRetryMock = vi.fn<(path: string) => Promise<string>>();
const fetchOptionalMock = vi.fn<(path: string) => Promise<string | null>>();
vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: (path: string) => fetchWithRetryMock(path),
    fetchOptional: (path: string) => fetchOptionalMock(path),
}));

const { walkListing, enrichBatch, fetchGestiones, fingerprintOf, buildRecord } =
    await import('../src/fetchGestiones.js');

const FILTERS: ListingFilters = {
    anio: null,
    objeto: null,
    tipoGestion: [],
    tipoModalidad: null,
    comprador: null,
    solicitante: null,
    idEspecie: null,
    idFamilia: null,
    nroGestion: null,
    nroExpediente: null,
    sortBy: 'newest',
};
const query = (estado: EstadoCode, tipoGestion: string | null = null): ListingQuery => ({
    estado,
    tipoGestion,
    filters: FILTERS,
});
const ALL_EVENTS = new Set(['NEW_LISTING', 'STATUS_CHANGE', 'UPDATED'] as const);
const NOW = new Date('2026-09-08T06:45:00.000Z');

function params(path: string): URLSearchParams {
    return new URL(`https://x${path}`).searchParams;
}
/** Serve pages per estado: pages[estado][n] is the body for the n-th page (start = 60 * n for the 60-row fixtures). */
function serve(pages: Partial<Record<EstadoCode, string[]>>, rowsPerPage = 60): void {
    fetchWithRetryMock.mockImplementation(async (path) => {
        const p = params(path);
        const estado = p.get('estado') as EstadoCode;
        const n = Math.floor(Number(p.get('start')) / rowsPerPage);
        const list = pages[estado] ?? [];
        return list[n] ?? EMPTY(list[0] ?? CO);
    });
}
function walk(overrides: Partial<Parameters<typeof walkListing>[0]> = {}) {
    return walkListing({
        queries: [query('AP')],
        maxItems: 100,
        onlyNew: false,
        seen: {},
        watermark: null,
        eventTypes: ALL_EVENTS,
        openingFrom: null,
        openingTo: null,
        recheckWindowDays: 30,
        fetchDetail: true,
        now: NOW,
        ...overrides,
    });
}
const seenAll = (json: string, estado: EstadoCode, hash = 'h'): Record<string, string> =>
    Object.fromEntries(ids(json).map((id) => [id, encodeSeen(estado, hash)]));

describe('walkListing against live-captured listing pages', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
        fetchOptionalMock.mockReset();
    });

    it('cold full run: every AP row is a NEW_LISTING candidate, totals are read, the list ends at its own total', async () => {
        serve({ AP: [AP] });
        const result = await walk();
        expect(result.candidates.map((c) => c.idGestion)).toEqual(ids(AP));
        expect(result.candidates.every((c) => c.eventType === 'NEW_LISTING' && c.isNew && c.estado === 'AP')).toBe(
            true,
        );
        expect(result.totalsByEstado).toEqual({ AP: 78, ET: 2214, CO: 28921 });
        expect(result.totalMatching).toBe(78);
        expect(result.stopReason).toBe('end-of-results');
        expect(result.pagesWalked).toBe(1); // 78 rows = totalRecords: no extra request needed
        expect(result.walkedToEnd.has('AP')).toBe(true);
        expect(result.excluded).toEqual([]);
        expect(params(fetchWithRetryMock.mock.calls[0][0]).get('sort')).toBe('idGestion');
        expect(params(fetchWithRetryMock.mock.calls[0][0]).get('dir')).toBe('DESC');
    });

    it('walks several estados (and tipoGestion codes) as separate server-side queries, summing their totals', async () => {
        serve({ AP: [AP], ET: [ET], CO: [CO] });
        const result = await walk({ queries: [query('AP', 'L'), query('AP', 'P'), query('ET')], maxItems: 1000 });
        const calls = fetchWithRetryMock.mock.calls.map(
            ([p]) => `${params(p).get('estado')}/${params(p).get('tipoGestion')}`,
        );
        expect(calls.slice(0, 3)).toEqual(['AP/L', 'AP/P', 'ET/null']);
        expect(result.totalMatching).toBe(78 + 2214);
        expect(result.candidates.filter((c) => c.estado === 'ET').length).toBe(60);
        expect(result.walkedToEnd.has('ET')).toBe(true); // the mock ends ET with an empty page
    });

    it('de-duplicates ids that repeat across pages or queries', async () => {
        serve({ CO: [CO, CO] }); // page 2 repeats every id of page 1
        const result = await walk({ queries: [query('CO')] });
        expect(result.candidates.length).toBe(60);
        expect(new Set(result.candidates.map((c) => c.idGestion)).size).toBe(60);
    });

    it('stops at maxItems, flags the truncation, and never marks the overflow', async () => {
        serve({ AP: [AP] });
        const result = await walk({ maxItems: 10 });
        expect(result.candidates.length).toBe(10);
        expect(result.candidates.map((c) => c.idGestion)).toEqual(ids(AP).slice(0, 10));
        expect(result.truncatedByMaxItems).toBe(true);
        expect(result.stopReason).toBe('max-items');
        expect(result.walkedToEnd.size).toBe(0);
    });

    it('delta: a fully-known list yields nothing and early-stops after 2 known pages without walking further', async () => {
        serve({ CO: [CO, rekey(CO, 1000), rekey(CO, 2000), rekey(CO, 3000)] });
        const seen = { ...seenAll(CO, 'CO'), ...seenAll(rekey(CO, 1000), 'CO'), ...seenAll(rekey(CO, 2000), 'CO') };
        const result = await walk({ queries: [query('CO')], onlyNew: true, seen, recheckWindowDays: 0 });
        expect(result.candidates).toEqual([]);
        expect(result.stopReason).toBe('delta-early-stop');
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
        expect(result.excluded.length).toBe(120);
        expect(result.excluded.every((c) => c.excludedBy === 'unchanged')).toBe(true);
        expect(result.rechecks).toEqual([]);
        expect(result.walkedToEnd.has('CO')).toBe(false);
    });

    it('delta: an id last seen in another estado list comes back as STATUS_CHANGE, an unseen id as new', async () => {
        serve({ ET: [ET] });
        const seen = seenAll(ET, 'ET');
        const [moved, fresh] = ids(ET);
        seen[moved] = encodeSeen('AP', 'h'); // opened since the last run
        delete seen[fresh];
        const result = await walk({ queries: [query('ET')], onlyNew: true, seen, recheckWindowDays: 0 });
        expect(result.candidates.map((c) => [c.idGestion, c.eventType, c.isNew, c.previousEstado])).toEqual([
            [moved, 'STATUS_CHANGE', false, 'AP'],
            [fresh, 'NEW_LISTING', true, null],
        ]);
    });

    it('delta: known open records inside the recheck window are queued for a detail re-read, bounded by opening date, detail and event type', async () => {
        serve({ AP: [AP] });
        const seen = seenAll(AP, 'AP');
        const all = await walk({ onlyNew: true, seen, recheckWindowDays: 30 });
        expect(all.candidates).toEqual([]);
        // every AP row opens in the future (>= now - 30 days) -> all re-checked
        expect(all.rechecks.length).toBe(78);
        expect(all.rechecks[0].previousHash).toBe('h');

        expect((await walk({ onlyNew: true, seen, recheckWindowDays: 0 })).rechecks).toEqual([]);
        expect((await walk({ onlyNew: true, seen, fetchDetail: false })).rechecks).toEqual([]);
        expect((await walk({ onlyNew: true, seen, eventTypes: new Set(['NEW_LISTING'] as const) })).rechecks).toEqual(
            [],
        );

        // A CO row that opened in 2026-08 is outside a 5-day window
        serve({ CO: [CO] });
        const co = await walk({ queries: [query('CO')], onlyNew: true, seen: seenAll(CO, 'CO'), recheckWindowDays: 5 });
        expect(co.rechecks.length).toBeLessThan(60);
        expect(co.rechecks.every((c) => (c.openingAt ?? '') >= '2026-09-03')).toBe(true);
    });

    it('delta: the watermark bounds the walk once every row on a page is far below the previous run’s newest id', async () => {
        serve({ CO: [CO, rekey(CO, 1000), rekey(CO, 2000)] });
        // Newest CO id in the fixture is 138923; a watermark 2,000 ids higher makes page 1 entirely "old".
        const result = await walk({ queries: [query('CO')], onlyNew: true, seen: {}, watermark: 140_923 });
        expect(result.stopReason).toBe('delta-watermark');
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
        // ...but the (unseen) rows on that page were still collected - the watermark only stops paging.
        expect(result.candidates.length).toBe(60);
    });

    it('applies the opening-date window and the event-type filter client-side, and window-excluded rows never keep a delta walk alive', async () => {
        serve({ AP: [AP] });
        const inWindow = await walk({ openingFrom: '2026-09-08', openingTo: '2026-09-15' });
        expect(inWindow.candidates.length).toBeGreaterThan(0);
        expect(inWindow.candidates.length).toBeLessThan(78);
        expect(inWindow.candidates.every((c) => (c.openingAt ?? '') >= '2026-09-08')).toBe(true);
        expect(inWindow.excluded.every((c) => c.excludedBy === 'openingDate')).toBe(true);

        const onlyUpdates = await walk({ eventTypes: new Set(['UPDATED'] as const) });
        expect(onlyUpdates.candidates).toEqual([]);
        expect(onlyUpdates.excluded.every((c) => c.excludedBy === 'eventType')).toBe(true);

        // Delta on CO with a window that excludes everything: pages count as known and the walk stops after 2.
        fetchWithRetryMock.mockReset();
        serve({ CO: [CO, rekey(CO, 1000), rekey(CO, 2000), rekey(CO, 3000)] });
        const windowed = await walk({ queries: [query('CO')], onlyNew: true, seen: {}, openingFrom: '2030-01-01' });
        expect(windowed.candidates).toEqual([]);
        expect(windowed.stopReason).toBe('delta-early-stop');
        expect(fetchWithRetryMock.mock.calls.length).toBe(2);
        expect(windowed.excluded.every((c) => c.excludedBy === 'openingDate')).toBe(true);
    });

    it('delta: a backlog floor from a truncated walk suppresses the early-stop inside the already-delivered block', async () => {
        // Pages 1-2 = the block a previous (maxItems-truncated) run delivered; page 3 = rows that run never reached.
        const PAGE2 = rekey(CO, 1000);
        const PAGE3 = rekey(CO, 2000);
        serve({ CO: [CO, PAGE2, PAGE3] });
        const seen = { ...seenAll(CO, 'CO'), ...seenAll(PAGE2, 'CO') };
        const watermark = 138_923;

        // Without a floor the two known pages trigger the early-stop and page 3 is stranded forever.
        const stranded = await walk({ queries: [query('CO')], onlyNew: true, seen, watermark, recheckWindowDays: 0 });
        expect(stranded.stopReason).toBe('delta-early-stop');
        expect(stranded.candidates).toEqual([]);

        // With the floor (below every delivered row) the walk keeps going and finds page 3.
        const recovered = await walk({
            queries: [query('CO')],
            onlyNew: true,
            seen,
            watermark,
            backlogFloor: 136_700, // the truncated walk had reached into page 3
            recheckWindowDays: 0,
        });
        expect(recovered.candidates.length).toBe(60);
        expect(recovered.candidates.every((c) => c.idNumber < 137_000)).toBe(true);
        expect(recovered.stopReason).toBe('end-of-results');
    });

    it('delta: a baseline floor from a truncated COLD run keeps older unseen rows out - history, not backlog', async () => {
        // The cold run delivered the 10 newest AP rows; the other 68 must stay undelivered forever.
        serve({ AP: [AP] });
        const delivered = ids(AP).slice(0, 10);
        const seen = Object.fromEntries(delivered.map((id) => [id, encodeSeen('AP', 'h')]));
        const baselineFloor = Number(delivered.at(-1));

        const drained = await walk({ onlyNew: true, seen, watermark: 139_031 });
        expect(drained.candidates.length).toBe(68); // without a baseline the register would drain

        const baseline = await walk({ onlyNew: true, seen, watermark: 139_031, baselineFloor });
        expect(baseline.candidates).toEqual([]);
        expect(baseline.excluded.filter((c) => c.excludedBy === 'baseline').length).toBe(68);
        expect(baseline.excluded.filter((c) => c.excludedBy === 'unchanged').length).toBe(10);
        expect(baseline.stopReason).toBe('end-of-results');
    });

    it('refuses to mistake a maintenance page or a refused query for "nothing new" - it retries, then fails loudly', async () => {
        fetchWithRetryMock.mockResolvedValue(BLOCKED);
        await expect(walk()).rejects.toThrow(/not a Gestiones de Compra listing/);
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(3);

        fetchWithRetryMock.mockReset();
        fetchWithRetryMock.mockResolvedValue(REFUSED);
        await expect(walk()).rejects.toThrow(/Parámetro inválido/);
    });
});

describe('enrichBatch / buildRecord / fingerprint', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
        fetchOptionalMock.mockReset();
    });

    it('builds a full record with the v1 fields, the envelope, normalised twins and detail fields', async () => {
        serve({ AP: [AP] });
        fetchOptionalMock.mockResolvedValue(DETAIL_AP);
        const { records } = await fetchGestiones({
            queries: [query('AP')],
            maxItems: 2,
            onlyNew: false,
            seen: {},
            watermark: null,
            eventTypes: ALL_EVENTS,
            openingFrom: null,
            openingTo: null,
            recheckWindowDays: 30,
            fetchDetail: true,
            maxConcurrency: 2,
            now: NOW,
        });
        expect(records.length).toBe(2);
        const r = records[0];
        // v1 fields, unchanged names
        expect(r.idGestion).toBe('139031');
        expect(r.estado).toBe('AP');
        expect(r.tipoGestion).toBe('LICITACIÓN PÚBLICA');
        expect(r.numeroGestion).toBe('06');
        expect(r.anioGestion).toBe('2026');
        expect(r.fechaHoraApertura).toBe('28-09-2026');
        expect(r.detail?.fields.Estado).toBe('PARA APERTURA');
        expect(r.detail?.documentos.length).toBe(3);
        // envelope
        expect(r.record_id).toBe('139031');
        expect(r.event_type).toBe('NEW_LISTING');
        expect(r.is_new).toBe(true);
        expect(r.scraped_at).toBe(NOW.toISOString());
        expect(r.source_url).toBe('https://www.santafe.gov.ar/gestionesdecompras/site/gestion.php?idGestion=139031');
        expect(r.data_source).toContain('CC BY-SA 2.5 AR');
        // normalised listing twins
        expect(r.idGestionNumber).toBe(139031);
        expect(r.numeroAnio).toBe('06-2026');
        expect(r.tipoGestionCode).toBe('L');
        expect(r.openingAt).toBe('2026-09-28T13:00:00.000Z');
        expect(r.openingDate).toBe('2026-09-28');
        expect(r.daysUntilOpening).toBe(20);
        expect(r.isOpeningInFuture).toBe(true);
        expect(r.numeroExpediente).toBe(''); // v1 kept the listing's raw (often blank) expediente
        expect(r.isElectronic).toBe(false);
        expect(r.bidUrl).toBeNull();
        expect(r.printPdfUrl).toBe(
            'https://www.santafe.gov.ar/gestionesdecompras/site/output.php?a=gestiones.ver&idGestion=139031&print=1',
        );
        // detail twins (from the 138825 fixture served for every id)
        expect(r.detailFetched).toBe(true);
        expect(r.detailError).toBeNull();
        expect(r.estadoLabel).toBe('PARA APERTURA');
        expect(r.estadoFromDetail).toBe('AP');
        expect(r.publishedAt).toBe('2026-08-20T14:06:00.000Z');
        expect(r.publishedDate).toBe('2026-08-20');
        expect(r.daysSincePublished).toBe(19);
        expect(r.submissionDeadline).toBe('2026-09-04T12:30:00.000Z');
        expect(r.montoOriginalAmount).toBe(207302040);
        expect(r.montoOriginalCurrency).toBe('ARS');
        expect(r.valorPliegoIsFree).toBe(true);
        expect(r.rubroNames).toEqual(['PROD.MEDICINALES-PROD.QUIM.-INSUMOS P/ENV.MEDICINALES']);
        expect(r.subrubroNames).toEqual(['INSUMOS DE LABORATORIO', 'PRODUCTOS QUIMICOS PARA LABORATORIO']);
        expect(r.organismoComitente).toEqual(['MINISTERIO DE SALUD - (DGA)']);
        expect(r.documentCount).toBe(3);
        expect(r.hasPliego).toBe(true);
        expect(r.hasCircular).toBe(false);
        expect(r.documentKinds).toEqual(['pliego', 'otros']);
        expect(r.contentHash).toMatch(/^[0-9a-f]{40}$/);
    });

    it('flags electronic procedures from the listing expediente and builds the gestionvirtual bid link', async () => {
        serve({ AP: [AP] });
        fetchOptionalMock.mockResolvedValue(DETAIL_AP);
        const { candidates } = await walk({ maxItems: 5 });
        const enriched = await enrichBatch(candidates, { fetchDetail: true, maxConcurrency: 5, now: NOW });
        const r = enriched.find((e) => e.record.idGestion === '139027')?.record;
        expect(r?.numeroExpediente).toBe('EE-2026-00006835-APPSF-PE');
        expect(r?.isElectronic).toBe(true);
        expect(r?.bidUrl).toBe(
            'https://gestionvirtual.santafe.gob.ar/#/bandeja_proveedores/create/form/680a87a12a055d2295ea39a0?expedienteCode=EE-2026-00006835-APPSF-PE',
        );
    });

    it('degrades to a summary record (detailFetched=false, UNPUBLISHED) when the detail page says the process does not exist', async () => {
        serve({ AP: [AP] });
        fetchOptionalMock.mockResolvedValue(DETAIL_NONE);
        const { candidates } = await walk({ maxItems: 1 });
        const [e] = await enrichBatch(candidates, { fetchDetail: true, maxConcurrency: 1, now: NOW });
        expect(e.detail).toEqual({ status: 'unpublished' });
        expect(e.record.detailFetched).toBe(false);
        expect(e.record.detailError).toBe('UNPUBLISHED');
        expect(e.record.comprador).toBe('MINISTERIO DE GOBIERNO E INNOVACIÓN PÚBLICA'); // listing fields survive
        expect(e.record.contentHash).toBeNull();
        expect(e.record.detail).toBeNull();
    });

    it('reports a transient detail failure as an error result (the caller leaves it unseen) and a 404 as unpublished', async () => {
        serve({ AP: [AP] });
        const { candidates } = await walk({ maxItems: 2 });
        fetchOptionalMock.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(null);
        const enriched = await enrichBatch(candidates, { fetchDetail: true, maxConcurrency: 1, now: NOW });
        expect(enriched[0].detail?.status).toBe('error');
        expect(enriched[0].record.detailError).toBe('fetch failed');
        expect(enriched[1].detail?.status).toBe('unpublished');
    });

    it('listing-only mode never touches the detail endpoint and yields hash-less summary records', async () => {
        serve({ AP: [AP] });
        const { candidates } = await walk({ maxItems: 3 });
        const enriched = await enrichBatch(candidates, { fetchDetail: false, maxConcurrency: 5, now: NOW });
        expect(enriched.length).toBe(3);
        expect(
            enriched.every(
                (e) => !e.record.detailFetched && e.record.detailError === null && e.record.contentHash === null,
            ),
        ).toBe(true);
        expect(fetchOptionalMock).not.toHaveBeenCalled();
    });

    it('the content fingerprint changes when a document is added (a circular) and is stable otherwise', () => {
        const withCircular = parseDetailPage(cheerio.load(DETAIL_ET_CIRCULAR));
        const without = parseDetailPage(
            cheerio.load(DETAIL_ET_CIRCULAR.replace(/<h5[^>]*>Circulares<\/h5>[\s\S]*?<\/div>/, '')),
        );
        expect(withCircular.documents.length).toBe(3);
        expect(without.documents.length).toBe(2);
        expect(fingerprintOf(withCircular)).not.toBe(fingerprintOf(without));
        expect(fingerprintOf(withCircular)).toBe(fingerprintOf(parseDetailPage(cheerio.load(DETAIL_ET_CIRCULAR))));
    });

    it('builds a record from the detail page alone for a status-sweep candidate (no listing row)', () => {
        const detail = parseDetailPage(cheerio.load(DETAIL_ET_CIRCULAR));
        const record = buildRecord(
            {
                item: null,
                idGestion: '138676',
                idNumber: 138676,
                estado: 'ET',
                previousEstado: 'AP',
                previousHash: 'old',
                eventType: 'STATUS_CHANGE',
                isNew: false,
                openingAt: null,
                excludedBy: null,
            },
            { status: 'ok', detail },
            NOW,
        );
        expect(record.event_type).toBe('STATUS_CHANGE');
        expect(record.previousEstado).toBe('AP');
        expect(record.tipoGestion).toBe('LICITACIÓN PÚBLICA');
        expect(record.tipoGestionCode).toBe('L');
        expect(record.numeroGestion).toBe('02');
        expect(record.anioGestion).toBe('2026');
        expect(record.numeroAnio).toBe('02-2026');
        expect(record.fechaHoraApertura).toBeNull();
        expect(record.openingAt).toBe('2026-08-31T15:00:00.000Z'); // from the detail page
        expect(record.comprador).toBe('ADMINISTRACIÓN PROVINCIAL DE IMPUESTOS');
        expect(record.numeroExpediente).toBe('EE-2026-00001797-APPSF-OD');
        expect(record.isElectronic).toBe(true);
        expect(record.hasCircular).toBe(true);
        expect(record.montoOriginalAmount).toBe(91752000);
    });
});
