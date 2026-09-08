import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseListingResponse } from '../../src/parsers/listing.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));
const read = (name: string) => readFileSync(`${fixturesDir}/${name}`, 'utf-8');

describe('parseListingResponse', () => {
    it('parses a live AP page sorted newest-first with the three estado totals', () => {
        const page = parseListingResponse(read('listing_ap_desc.json'));
        expect(page.isListingPage).toBe(true);
        expect(page.items.length).toBe(78);
        expect(page.totalRecords).toBe(78);
        expect(page.totals).toEqual({ AP: 78, ET: 2214, CO: 28921 });
        expect(page.items[0].idGestion).toBe('139031');
        expect(page.items[0]['numeroAño']).toBe('06-2026');
        expect(page.items.at(-1)?.idGestion).toBe('138651');
    });

    it('keeps the ET/CO-only `destinos` column', () => {
        const page = parseListingResponse(read('listing_et_desc_60.json'));
        expect(page.items.length).toBe(60);
        expect(page.totalRecords).toBe(2214);
        expect(page.items.some((i) => typeof i.destinos === 'string')).toBe(true);
    });

    it('treats a page past the end (success:true, data:[]) as a legitimate empty listing', () => {
        const page = parseListingResponse(read('listing_past_end.json'));
        expect(page.isListingPage).toBe(true);
        expect(page.items).toEqual([]);
        expect(page.totalRecords).toBe(78);
    });

    it('rejects anything that is not the API shape: HTML, an empty 500 body, success:false, a missing extraData', () => {
        expect(parseListingResponse('<html><body>Mantenimiento</body></html>').isListingPage).toBe(false);
        expect(parseListingResponse('').isListingPage).toBe(false);
        const refused = parseListingResponse(
            JSON.stringify({ success: false, errors: { reason: 'Parámetro inválido' }, data: [] }),
        );
        expect(refused.isListingPage).toBe(false);
        expect(refused.reason).toBe('Parámetro inválido');
        expect(parseListingResponse(JSON.stringify({ success: true, data: [], extraData: '' })).isListingPage).toBe(
            false,
        );
        expect(
            parseListingResponse(
                JSON.stringify({
                    success: true,
                    data: [{ foo: 1 }],
                    extraData: { apTotal: '1', etTotal: '1', coTotal: '1' },
                }),
            ).isListingPage,
        ).toBe(false);
    });
});
