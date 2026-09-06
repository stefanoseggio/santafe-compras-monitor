import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const LISTING_AP = readFileSync(`${fixturesDir}/listing_ap.json`, 'utf-8');
const LISTING_AP_IDS = (JSON.parse(LISTING_AP) as { data: { idGestion: string }[] }).data.map((d) => d.idGestion);
const NO_MORE_RESULTS = JSON.stringify({ success: true, data: [] });

const fetchWithRetryMock = vi.fn<(url: string) => Promise<Response>>();
vi.mock('../src/http.js', () => ({ fetchWithRetry: (url: string) => fetchWithRetryMock(url) }));

const { fetchListing } = await import('../src/fetchListing.js');

// Real fixture (test/fixtures/listing_ap.json) has 5 real AP items, all
// dated 2026-09-04: two at 09:30:00 and three at 10:00:00.
const NOW_MID_RUN = new Date('2026-09-04T09:00:00.000Z'); // before every fixture item - used where dateRange isn't exercised

describe('fetchListing delta (onlyNew) safe post-filter, against a real captured fixture', () => {
    beforeEach(() => {
        fetchWithRetryMock.mockReset();
    });

    it('cold run (empty seen-set): marks every record is_new=true', async () => {
        fetchWithRetryMock.mockImplementation(async () => new Response(LISTING_AP));

        const { entries, allIdsByEstado } = await fetchListing(
            ['AP'],
            100,
            { AP: new Set() },
            false,
            undefined,
            NOW_MID_RUN,
        );

        expect(entries).toHaveLength(LISTING_AP_IDS.length);
        expect(entries.every((e) => e.isNew)).toBe(true);
        expect(allIdsByEstado.AP).toEqual(LISTING_AP_IDS);
    });

    it('onlyNew with a fully-seen state: returns zero records, but still walks the full listing (no early-stop)', async () => {
        fetchWithRetryMock.mockImplementation(async () => new Response(LISTING_AP));
        const seenIds = new Set(LISTING_AP_IDS);

        const { entries, allIdsByEstado } = await fetchListing(
            ['AP'],
            100,
            { AP: seenIds },
            true,
            undefined,
            NOW_MID_RUN,
        );

        expect(entries).toEqual([]);
        // Proves this is a post-filter, not an early-stop: the page was
        // still fully fetched and every id on it recorded, even though
        // none of them survive the onlyNew filter.
        expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
        expect(allIdsByEstado.AP).toEqual(LISTING_AP_IDS);
    });

    it('onlyNew with a partially-seen state: returns only the unseen ids, preserving listing order', async () => {
        fetchWithRetryMock.mockImplementation(async () => new Response(LISTING_AP));
        const seenIds = new Set(LISTING_AP_IDS.slice(0, 3));

        const { entries } = await fetchListing(['AP'], 100, { AP: seenIds }, true, undefined, NOW_MID_RUN);

        expect(entries.map((e) => e.item.idGestion)).toEqual(LISTING_AP_IDS.slice(3));
        expect(entries.every((e) => e.isNew)).toBe(true);
    });

    it('maxItems still bounds the raw walk (unchanged from before onlyNew existed), independent of onlyNew', async () => {
        fetchWithRetryMock.mockImplementation(async (url: string) => {
            const start = Number(new URL(url).searchParams.get('start'));
            return start === 0 ? new Response(LISTING_AP) : new Response(NO_MORE_RESULTS);
        });

        const { entries, allIdsByEstado } = await fetchListing(
            ['AP'],
            2,
            { AP: new Set() },
            false,
            undefined,
            NOW_MID_RUN,
        );

        expect(entries).toHaveLength(2);
        expect(allIdsByEstado.AP).toEqual(LISTING_AP_IDS.slice(0, 2));
    });

    it('dateRange filtering excludes records whose fechaHoraApertura falls outside the window', async () => {
        fetchWithRetryMock.mockImplementation(async () => new Response(LISTING_AP));
        // One day + 15min after the two 09:30 items (>24h away, excluded)
        // but 23h45min after the three 10:00 items (<=24h away, included).
        const now = new Date('2026-09-05T09:45:00.000Z');

        const { entries } = await fetchListing(['AP'], 100, { AP: new Set() }, false, '24h', now);

        expect(entries.map((e) => e.item.idGestion).sort()).toEqual(LISTING_AP_IDS.slice(2).sort());
        expect(entries).toHaveLength(3);
    });

    it('onlyNew and dateRange combine (both must pass)', async () => {
        fetchWithRetryMock.mockImplementation(async () => new Response(LISTING_AP));
        const now = new Date('2026-09-05T09:45:00.000Z');
        // Mark one of the three in-window (10:00) ids as already seen.
        const seenIds = new Set([LISTING_AP_IDS[2]]);

        const { entries } = await fetchListing(['AP'], 100, { AP: seenIds }, true, '24h', now);

        expect(entries.map((e) => e.item.idGestion).sort()).toEqual([LISTING_AP_IDS[3], LISTING_AP_IDS[4]].sort());
    });
});
