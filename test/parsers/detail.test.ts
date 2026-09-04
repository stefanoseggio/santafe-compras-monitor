import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseDetail } from '../../src/parsers/detail.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('parseDetail', () => {
    it('extracts simple label/value fields from a real detail page', () => {
        const $ = loadFixture('detail_138825.html');
        const detail = parseDetail($);

        expect(detail.fields['Fecha de Publicación']).toBe('20-08-2026 11:06 Hs.');
        expect(detail.fields.Modalidad).toBe('SIN MODALIDAD');
        expect(detail.fields.Estado).toBe('PARA APERTURA');
        expect(detail.fields.Alcance).toBe('NACIONAL');
        expect(detail.fields['Objeto de la gestión']).toBe('PANELES DE DIAGNOSTICO SINDROMICO');
        expect(detail.fields['Monto Original']).toBe('$  207.302.040,00');
    });

    it('extracts multi-value Rubros as an array, separate from the joined fields map', () => {
        const $ = loadFixture('detail_138825.html');
        const detail = parseDetail($);

        expect(detail.rubros).toHaveLength(2);
        expect(detail.rubros[0]).toContain('PROD.MEDICINALES');
        expect(detail.fields['Rubros / Subrubros']).toBe(detail.rubros.join('; '));
    });

    it('extracts documentos grouped by tipo, with resolved absolute URLs', () => {
        const $ = loadFixture('detail_138825.html');
        const detail = parseDetail($);

        expect(detail.documentos).toHaveLength(3);
        const pliegos = detail.documentos.filter((d) => d.tipo === 'Pliego');
        expect(pliegos).toHaveLength(2);
        expect(pliegos[0].nombre).toBe('PLIEGO UNICO DE B. Y C. GRALES');
        expect(pliegos[0].url).toMatch(/^https:\/\/www\.santafe\.gov\.ar\/gestionesdecompras\/descargar\.php/);

        const otros = detail.documentos.filter((d) => d.tipo === 'Otros');
        expect(otros).toHaveLength(1);
        expect(otros[0].nombre).toBe('DECISORIO');
    });
});
