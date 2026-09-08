import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// End-to-end run of src/main.ts with the Apify SDK and the HTTP layer mocked:
// proves the delta state is persisted ONLY for records actually stored, so a
// spending limit (or crash) half-way never loses processes for the next run.

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const LISTING_AP = readFileSync(`${fixturesDir}/listing_ap_desc.json`, 'utf-8');
const AP_IDS = (JSON.parse(LISTING_AP) as { data: { idGestion: string }[] }).data.map((d) => d.idGestion);

const kv = new Map<string, unknown>();
const pushed: Record<string, unknown>[] = [];
const pushEvents: string[] = [];
const statusMessages: string[] = [];
let failMessage: string | null = null;
const CHARGE_LIMIT = 4; // the customer's budget allows 4 records

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
            getInput: async () => ({ estados: ['AP'], maxItems: 10, fetchDetail: false, onlyNew: true }),
            openKeyValueStore: async () => store,
            setValue: async (key: string, value: unknown) => {
                kv.set(`default:${key}`, value);
            },
            setStatusMessage: async (message: string) => {
                statusMessages.push(message);
            },
            on: noop,
            off: noop,
            getChargingManager: () => ({ getPricingInfo: () => ({ isPayPerEvent: true }) }),
            pushData: async (items: Record<string, unknown>[], eventName: string) => {
                const room = Math.max(0, CHARGE_LIMIT - pushed.length);
                const stored = items.slice(0, room);
                pushed.push(...stored);
                pushEvents.push(...stored.map(() => eventName));
                return {
                    chargedCount: stored.length,
                    eventChargeLimitReached: pushed.length >= CHARGE_LIMIT,
                    chargeableWithinLimit: {},
                };
            },
        },
    };
});

vi.mock('../src/http.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/http.js')>()),
    fetchWithRetry: async () => LISTING_AP,
    fetchOptional: async () => null,
}));

describe('main.ts delivery semantics', () => {
    it('persists the seen-map only for delivered records, oldest-first, and stops at the spending limit', async () => {
        await import('../src/main.js');

        expect(failMessage).toBeNull();
        expect(pushed.length).toBe(CHARGE_LIMIT);
        expect(pushEvents.every((e) => e === 'result-summary')).toBe(true); // fetchDetail=false -> summary price

        // The walk took the 10 newest ids; delivery is oldest-first, so the 4 stored
        // records are the 4 LOWEST of those 10 and the undelivered ones are the
        // newest - exactly where the next walk starts.
        const top10 = AP_IDS.slice(0, 10);
        const expectedDelivered = [...top10].sort((a, b) => Number(a) - Number(b)).slice(0, CHARGE_LIMIT);
        expect(pushed.map((r) => r.idGestion)).toEqual(expectedDelivered);
        expect(pushed.every((r) => r.event_type === 'NEW_LISTING' && r.is_new === true && r.estado === 'AP')).toBe(
            true,
        );

        const state = kv.get('state') as {
            seen: Record<string, string>;
            watermark: number | null;
            backlogFloor: number | null;
            baselineFloor: number | null;
            lastRunAt: string;
        };
        expect(state).toBeDefined();
        expect(Object.keys(state.seen).sort()).toEqual([...expectedDelivered].sort());
        expect(Object.values(state.seen).every((v) => v === 'AP|')).toBe(true); // listing-only: no fingerprint yet
        // A COLD run (empty store) cut short by maxItems (10 < 78 rows) defines the
        // baseline: the oldest row it reached becomes the floor - and leaves no backlog.
        expect(state.baselineFloor).toBe(Number(top10.at(-1)));
        expect(state.backlogFloor).toBeNull();
        // The watermark is the highest DELIVERED id - the undelivered (newer) rows must still be walked next run.
        expect(state.watermark).toBe(Number(expectedDelivered.at(-1)));
        expect(state.watermark).toBeLessThan(Number(AP_IDS[0]));
        expect(state.lastRunAt).toBeTruthy();

        const output = kv.get('default:OUTPUT') as {
            delivered: number;
            chargeLimitReached: boolean;
            mode: string;
            truncatedByMaxItems: boolean;
            totalMatchingOnRegister: number;
            byEventType: Record<string, number>;
        };
        expect(output.delivered).toBe(CHARGE_LIMIT);
        expect(output.chargeLimitReached).toBe(true);
        expect(output.truncatedByMaxItems).toBe(true);
        expect(output.mode).toBe('delta');
        expect(output.totalMatchingOnRegister).toBe(78);
        expect(output.byEventType).toEqual({ NEW_LISTING: 4 });
        expect(statusMessages.at(-1)).toMatch(/4 delivered .* spending limit reached/);
    });
});
