import { describe, expect, it } from 'vitest';

import {
    blankToNull,
    contentFingerprint,
    daysBetween,
    extractEmails,
    extractPhones,
    fold,
    isElectronicExpediente,
    isoToSiteDate,
    parseMoney,
    parseSiteDate,
    parseSiteDateTime,
    parseSiteDetailDateTime,
    shortHash,
    siteCalendarDate,
    splitRubro,
    valorPliegoIsFree,
} from '../src/normalize.js';

describe('Santa Fe clock (fixed UTC-3, no DST)', () => {
    it('converts the listing timestamp to UTC', () => {
        expect(parseSiteDateTime('2026-09-04 09:30:00')).toBe('2026-09-04T12:30:00.000Z');
        expect(parseSiteDateTime('2026-09-08 23:00:00')).toBe('2026-09-09T02:00:00.000Z');
        expect(parseSiteDateTime('1969-12-31 20:00:00')).toBeNull(); // epoch placeholder on old rows
        expect(parseSiteDateTime('04-09-2026')).toBeNull();
        expect(parseSiteDateTime(null)).toBeNull();
    });

    it('converts the detail-page "DD-MM-YYYY HH:mm Hs." stamps, with or without a trailing note', () => {
        expect(parseSiteDetailDateTime('20-08-2026 11:06 Hs.')).toBe('2026-08-20T14:06:00.000Z');
        expect(parseSiteDetailDateTime('08-09-2026 07:00 Hs. -')).toBe('2026-09-08T10:00:00.000Z');
        expect(parseSiteDetailDateTime('02-07-2026 10:00 Hs. - (*** NUEVA FECHA')).toBe('2026-07-02T13:00:00.000Z');
        expect(parseSiteDetailDateTime('31-08-2026')).toBe('2026-08-31T03:00:00.000Z');
        expect(parseSiteDetailDateTime('nonsense')).toBeNull();
    });

    it('handles listing dates, calendar days and day arithmetic', () => {
        expect(parseSiteDate('04-09-2026')).toBe('2026-09-04');
        expect(parseSiteDate('2026-09-04')).toBeNull();
        expect(siteCalendarDate(new Date('2026-09-08T01:30:00.000Z'))).toBe('2026-09-07'); // 22:30 the day before in Santa Fe
        expect(siteCalendarDate(new Date('2026-09-08T03:30:00.000Z'))).toBe('2026-09-08');
        expect(isoToSiteDate('2026-09-04T12:30:00.000Z')).toBe('2026-09-04');
        expect(daysBetween('2026-09-08', '2026-09-28')).toBe(20);
        expect(daysBetween('2026-09-08', '2026-09-01')).toBe(-7);
        expect(daysBetween(null, '2026-09-01')).toBeNull();
    });
});

describe('money', () => {
    it('parses ARS and USD amounts written the Argentine way', () => {
        expect(parseMoney('$  207.302.040,00')).toEqual({ amount: 207302040, currency: 'ARS' });
        expect(parseMoney('U$S 60.000,00')).toEqual({ amount: 60000, currency: 'USD' });
        expect(parseMoney('$  8209,50 (PESOS OCHO MIL DOSCIENTOS NUEVE CON CINCUENTA CENTAVOS)')).toEqual({
            amount: 8209.5,
            currency: 'ARS',
        });
        expect(parseMoney('$  600 (PESOS SEISCIENTOS).')).toEqual({ amount: 600, currency: 'ARS' });
        expect(parseMoney('$  480.-')).toEqual({ amount: 480, currency: 'ARS' });
        expect(parseMoney('$  7.00')).toEqual({ amount: 7, currency: 'ARS' });
        expect(parseMoney('$  0 -')).toEqual({ amount: 0, currency: 'ARS' });
        expect(parseMoney('NO APLICA')).toBeNull();
        expect(parseMoney('')).toBeNull();
    });

    it('decides whether the pliego is free from the site’s free-text conventions', () => {
        expect(valorPliegoIsFree('NO APLICA')).toBe(true);
        expect(valorPliegoIsFree('SIN COSTO SEGÚN DECRETO Nº1605/2024')).toBe(true);
        expect(valorPliegoIsFree('S/V')).toBe(true);
        expect(valorPliegoIsFree('$  0 -')).toBe(true);
        expect(valorPliegoIsFree('$  8209,50 (PESOS ...)')).toBe(false);
        expect(valorPliegoIsFree('')).toBeNull();
        expect(valorPliegoIsFree('-')).toBeNull();
        expect(valorPliegoIsFree('TRES MIL NOVECIENTOS TREINTA Y SEIS.-')).toBeNull();
    });
});

describe('text helpers', () => {
    it('folds accents and case for label/name matching', () => {
        expect(fold('Fecha de Publicación')).toBe('FECHA DE PUBLICACION');
        expect(fold('  administración   provincial ')).toBe('ADMINISTRACION PROVINCIAL');
    });

    it('extracts institutional e-mails and Argentine phone numbers from the contact text', () => {
        expect(extractEmails('A TRAVÉS DE CORREO ELECTRÓNICO A: COMPRASIAPIP@SANTAFE.GOV.AR')).toEqual([
            'comprasiapip@santafe.gov.ar',
        ]);
        expect(extractPhones('+54 9 342 45196329 O 342-4910056')).toEqual(['+54 9 342 45196329', '342-4910056']);
        expect(extractPhones('(0342) 450-6600 INTERNO 1302 - 1593 - COMPRASMGP@SANTAFE.GOV.AR')).toEqual([
            '(0342) 450-6600',
        ]);
        expect(extractPhones(null)).toEqual([]);
    });

    it('recognises electronic (gestionvirtual) expedientes the way the site does', () => {
        expect(isElectronicExpediente('EE-2026-00001797-APPSF-OD')).toBe(true);
        expect(isElectronicExpediente('LPU-2026-00000002-APPSF-OD#API#API-ADM-CYS')).toBe(true);
        expect(isElectronicExpediente('13301-0318366-7')).toBe(false);
        expect(isElectronicExpediente('')).toBe(false);
    });

    it('splits rubros, blanks and hashes deterministically', () => {
        expect(splitRubro('TELA / TELA')).toEqual({ rubro: 'TELA', subrubro: 'TELA' });
        expect(splitRubro('SOLO RUBRO')).toEqual({ rubro: 'SOLO RUBRO', subrubro: null });
        expect(blankToNull('  - ')).toBeNull();
        expect(blankToNull(' x  y ')).toBe('x y');
        expect(shortHash('a')).toBe(shortHash('a'));
        expect(shortHash('a')).not.toBe(shortHash('b'));
        expect(contentFingerprint({ a: 1 })).toMatch(/^[0-9a-f]{40}$/);
        expect(contentFingerprint({ a: 1 })).not.toBe(contentFingerprint({ a: 2 }));
    });
});
