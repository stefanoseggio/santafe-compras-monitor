import { describe, expect, it } from 'vitest';

import { fetchDetail } from '../src/fetchDetail.js';
import { fetchListing } from '../src/fetchListing.js';

// Live checks against the real site - skipped in CI (same lesson as the
// other actors in this portfolio: don't make CI depend on an external
// host with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchListing + fetchDetail against the real Santa Fe API', () => {
    it('fetches a real listing page with well-formed items', async () => {
        const entries = await fetchListing(['AP'], 10);

        expect(entries.length).toBeGreaterThan(0);
        expect(entries.length).toBeLessThanOrEqual(10);
        for (const { estado, item } of entries) {
            expect(estado).toBe('AP');
            expect(item.idGestion).toMatch(/^\d+$/);
            expect(item.objeto).toBeTruthy();
        }
    }, 30_000);

    it('paginates across multiple listing pages when maxItems exceeds one page', async () => {
        const entries = await fetchListing(['ET'], 75);
        expect(entries.length).toBeGreaterThan(50); // proves it advanced past the 50-item page size
        const ids = entries.map((e) => e.item.idGestion);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates across pages
    }, 30_000);

    it('fetches and parses a real detail page end-to-end', async () => {
        const entries = await fetchListing(['AP'], 1);
        expect(entries.length).toBe(1);

        const detail = await fetchDetail(entries[0].item.idGestion);
        expect(detail).not.toBeNull();
        expect(Object.keys(detail!.fields).length).toBeGreaterThan(0);
    }, 30_000);
});
