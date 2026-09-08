import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

// End-to-end delta run of src/main.ts on a fully-known AP list: nothing new in
// the listing, but (a) one known record's detail page changed -> UPDATED,
// (b) one known record has no fingerprint yet -> fingerprinted silently,
// (c) one record that vanished from the AP list is now EN TRÁMITE -> STATUS_CHANGE,
// (d) one vanished record no longer exists -> forgotten. Only (a) and (c) are pushed.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const read = (name: string) => readFileSync(`${fixturesDir}/${name}`, 'utf-8');
const LISTING_AP = read('listing_ap_desc.json');
const DETAIL_AP = read('detail_138825.html');
const DETAIL_ET = read('detail_138676_circular_et.html');
const DETAIL_NONE = read('detail_nonexistent.html');
const AP_IDS = (JSON.parse(LISTING_AP) as { data: { idGestion: string }[] }).data.map((d) => d.idGestion);
const [STALE_ID, UNHASHED_ID] = AP_IDS;
const MOVED_ID = '138825'; // was AP on a previous run, not in today's AP list, EN TRÁMITE on its page
const GONE_ID = '100'; // was AP on a previous run, page now says "no existe"

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-09-08T06:45:00.000Z'));

const { parseDetailPage } = await import('../src/parsers/detail.js');
const { fingerprintOf } = await import('../src/fetchGestiones.js');
const CURRENT_HASH = fingerprintOf(parseDetailPage(cheerio.load(DETAIL_AP)));
const ET_HASH = fingerprintOf(parseDetailPage(cheerio.load(DETAIL_ET)));

const seed: Record<string, string> = Object.fromEntries(AP_IDS.map((id) => [id, `AP|${CURRENT_HASH}`]));
seed[STALE_ID] = 'AP|stale-fingerprint';
seed[UNHASHED_ID] = 'AP|';
seed[MOVED_ID] = `AP|${CURRENT_HASH}`;
seed[GONE_ID] = 'AP|whatever';

const kv = new Map<string, unknown>([
    [
        'state',
        {
            version: 2,
            seen: seed,
            lastRunAt: '2026-09-07T06:00:00.000Z',
            watermark: Number(AP_IDS[0]),
            backlogFloor: null,
            baselineFloor: null,
            filtersSignature: null,
        },
    ],
]);
const pushed: Record<string, unknown>[] = [];
const pushEvents: string[] = [];
let failMessage: string | null = null;

vi.mock('apify', () => {
    const store = {
        getValue: async (key: string) => kv.get(key) ?? null,
        setValue: async (key: string, value: unknown) => {
            kv.set(key, JSON.parse(JSON.stringify(value)));
        },
    };
    const noop = (): void => {};
    return {
        log: { info: noop, warning: noop, debug: noop, error: noop, exception: noop },
        Actor: {
            init: async () => {},
            exit: async () => {},
            fail: async (message: string) => {
                failMessage = message;
            },
            getInput: async () => ({
                estados: ['AP'],
                maxItems: 50,
                fetchDetail: true,
                onlyNew: true,
                recheckWindowDays: 60,
            }),
            openKeyValueStore: async () => store,
            setValue: async (key: string, value: unknown) => {
                kv.set(`default:${key}`, value);
            },
            setStatusMessage: async () => {},
            on: noop,
            off: noop,
            getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }) }),
            pushData: async (items: Record<string, unknown>[], eventName: string) => {
                pushed.push(...items);
                pushEvents.push(...items.map(() => eventName));
                return { chargedCount: items.length, eventChargeLimitReached: false, chargeableWithinLimit: {} };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: async () => LISTING_AP,
    fetchOptional: async (path: string) => {
        const id = new URL(`https://x${path}`).searchParams.get('idGestion');
        if (id === MOVED_ID) return DETAIL_ET;
        if (id === GONE_ID) return DETAIL_NONE;
        return DETAIL_AP;
    },
}));

describe('main.ts re-check and status sweep', () => {
    it('delivers only real amendments and transitions, fingerprints silently, forgets vanished pages', async () => {
        await import('../src/main.js');
        expect(failMessage).toBeNull();

        expect(pushed.map((r) => [r.idGestion, r.event_type, r.estado, r.previousEstado, r.is_new])).toEqual([
            [STALE_ID, 'UPDATED', 'AP', null, false],
            [MOVED_ID, 'STATUS_CHANGE', 'ET', 'AP', false],
        ]);
        expect(pushEvents).toEqual(['result', 'result']); // both carry the detail page
        const moved = pushed[1];
        expect(moved.tipoGestion).toBe('LICITACIÓN PÚBLICA'); // rebuilt from the detail page title
        expect(moved.numeroGestion).toBe('02');
        expect(moved.fechaHoraApertura).toBeNull(); // no listing row for a swept record
        expect(moved.hasCircular).toBe(true);

        const state = kv.get('state') as { seen: Record<string, string>; watermark: number };
        expect(state.seen[STALE_ID]).toBe(`AP|${CURRENT_HASH}`);
        expect(state.seen[UNHASHED_ID]).toBe(`AP|${CURRENT_HASH}`); // fingerprinted, not delivered
        expect(state.seen[MOVED_ID]).toBe(`ET|${ET_HASH}`);
        expect(state.seen[GONE_ID]).toBeUndefined();
        expect(Object.keys(state.seen).length).toBe(AP_IDS.length + 1);

        const output = kv.get('default:OUTPUT') as Record<string, unknown>;
        expect(output.delivered).toBe(2);
        expect(output.byEventType).toEqual({ UPDATED: 1, STATUS_CHANGE: 1 });
        expect(output.rechecked).toBe(AP_IDS.length);
        expect(output.recheckUnchanged).toBe(AP_IDS.length - 2);
        expect(output.recheckFingerprinted).toBe(1);
        expect(output.swept).toBe(1);
        expect(output.sweptUnpublished).toBe(1);
        expect(output.stopReason).toBe('end-of-results');
        expect(output.excluded).toEqual({ unchanged: AP_IDS.length });
    });
});
