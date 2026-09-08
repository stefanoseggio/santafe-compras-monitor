import { describe, expect, it } from 'vitest';

import { fetchDetailFor, fetchGestiones } from '../src/fetchGestiones.js';
import { resolveInput } from '../src/input.js';
import { liveLookups } from '../src/lookups.js';

// Live checks against the real Santa Fe register. Opt-in (npm run test:live)
// so a developer's routine `npm test` and CI never depend on an external host.
const NOW = new Date();

async function run(input: Parameters<typeof resolveInput>[0]) {
    const { queries, options, filters } = await resolveInput(input, NOW, liveLookups());
    const result = await fetchGestiones({
        queries,
        maxItems: options.maxItems,
        onlyNew: options.onlyNew,
        seen: {},
        watermark: null,
        eventTypes: options.eventTypes,
        openingFrom: options.openingFrom,
        openingTo: options.openingTo,
        recheckWindowDays: options.recheckWindowDays,
        fetchDetail: options.fetchDetail,
        maxConcurrency: options.maxConcurrency,
        now: NOW,
    });
    return { ...result, filters };
}

describe.skipIf(!process.env.LIVE)('live santafe.gov.ar integration', () => {
    it('fetches the newest upcoming openings with full detail', async () => {
        const { records, walk } = await run({ estados: ['AP'], maxItems: 5 });
        expect(records.length).toBe(5);
        expect(walk.totalsByEstado?.AP).toBeGreaterThan(0);
        expect(walk.totalsByEstado?.CO).toBeGreaterThan(20_000);
        expect(walk.walkedToEnd.has('AP')).toBe(false); // truncated by maxItems
        for (const r of records) {
            expect(r.idGestion).toMatch(/^\d+$/);
            expect(r.source_url).toContain('gestion.php?idGestion=');
            expect(r.openingAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(r.comprador).toBeTruthy();
            expect(r.detailFetched).toBe(true);
            expect(r.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(r.estadoFromDetail).toBeTruthy();
            expect(r.contentHash).toMatch(/^[0-9a-f]{40}$/);
        }
        expect(records.some((r) => r.montoOriginalAmount !== null)).toBe(true);
        expect(records.some((r) => r.documentCount > 0)).toBe(true);
        // newest-first: ids strictly descending in walk order
        const idsInWalk = walk.candidates.map((c) => c.idNumber);
        expect([...idsInWalk].sort((a, b) => b - a)).toEqual(idsInWalk);
    }, 90_000);

    it('server-side filters narrow the result (anio + tipoGestion) and paginate without duplicates', async () => {
        const { records, walk } = await run({
            estados: ['CO'],
            anio: 2025,
            tipoGestion: ['L'],
            maxItems: 20,
            fetchDetail: false,
        });
        expect(records.length).toBe(20);
        expect(walk.totalMatching).toBeGreaterThan(20);
        expect(walk.totalMatching).toBeLessThan(5000);
        expect(records.every((r) => r.anioGestion === '2025')).toBe(true);
        expect(records.every((r) => r.tipoGestionCode === 'L')).toBe(true);
        expect(new Set(records.map((r) => r.idGestion)).size).toBe(20);
    }, 90_000);

    it('resolves an organismo by name and filters the buyer server-side', async () => {
        const { records, filters } = await run({
            estados: ['CO'],
            comprador: 'Administración Provincial de Impuestos',
            maxItems: 5,
            fetchDetail: false,
        });
        expect(filters.comprador).toBe('27');
        expect(records.length).toBe(5);
        expect(records.every((r) => (r.comprador ?? '').toUpperCase().includes('IMPUESTOS'))).toBe(true);
    }, 60_000);

    it('resolves a rubro and sub-rubro by name (idEspecie + idFamilia)', async () => {
        const { walk, filters } = await run({
            estados: ['CO'],
            rubro: 'accesorios para animales',
            subrubro: 'semovientes',
            maxItems: 50,
            fetchDetail: false,
        });
        expect(filters.idEspecie).toBe('57');
        expect(filters.idFamilia).toBe('226');
        expect(walk.totalMatching).toBeGreaterThan(0);
        expect(walk.totalMatching).toBeLessThan(50);
    }, 60_000);

    it('a zero-result query ends cleanly instead of being mistaken for a block', async () => {
        const { records, walk } = await run({
            estados: ['AP', 'ET', 'CO'],
            nroExpediente: 'NO-SUCH-EXPEDIENTE-000000',
            fetchDetail: false,
        });
        expect(records).toEqual([]);
        expect(walk.stopReason).toBe('end-of-results');
        expect(walk.totalMatching).toBe(0);
    }, 60_000);

    it('a nonexistent idGestion is reported as unpublished, a real one parses', async () => {
        expect((await fetchDetailFor('999999999')).status).toBe('unpublished');
        const real = await fetchDetailFor('126068');
        expect(real.status).toBe('ok');
        if (real.status === 'ok') {
            expect(real.detail.estadoCode).toBe('CO');
            expect(real.detail.documents.some((d) => d.kind === 'preadjudicacion')).toBe(true);
        }
    }, 60_000);
});
