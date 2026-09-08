import { describe, expect, it } from 'vitest';

import { resolveDate, resolveInput } from '../src/input.js';
import type { LookupClient } from '../src/lookups.js';
import { resolveByName } from '../src/lookups.js';

const NOW = new Date('2026-09-08T06:45:00.000Z'); // 03:45 on 8 Sep in Santa Fe

const lookups: LookupClient = {
    organismos: async () => [
        { id: '27', name: 'ADMINISTRACIÓN PROVINCIAL DE IMPUESTOS' },
        { id: '46', name: 'HOSPITAL DE NIÑOS ZONA NORTE DR. ROBERTO M. CARRA' },
        { id: '53', name: 'HOSPITAL DE NIÑOS DR. ORLANDO ALASSIA' },
    ],
    rubros: async () => [
        { id: '57', name: 'ACCESORIOS PARA ANIMALES' },
        { id: '75', name: 'SERVICIO DE MANTENIMIENTO, REPARACION Y LIMPIEZA' },
    ],
    subrubros: async (idEspecie) =>
        idEspecie === '57'
            ? [
                  { id: '367', name: 'ACCESORIOS PARA CANES' },
                  { id: '226', name: 'ACCESORIOS PARA SEMOVIENTES' },
              ]
            : [],
};

describe('resolveDate', () => {
    it('accepts absolute dates, backward and forward relative windows, counting from the Santa Fe calendar day', () => {
        expect(resolveDate('2026-07-01', NOW, 'x')).toBe('2026-07-01');
        expect(resolveDate('7 days', NOW, 'x')).toBe('2026-09-01');
        expect(resolveDate('2 weeks', NOW, 'x')).toBe('2026-08-25');
        expect(resolveDate('3 months', NOW, 'x')).toBe('2026-06-08');
        expect(resolveDate('1 year', NOW, 'x')).toBe('2025-09-08');
        expect(resolveDate('+30 days', NOW, 'x')).toBe('2026-10-08');
        expect(resolveDate('in 1 month', NOW, 'x')).toBe('2026-10-08');
        expect(resolveDate('-1 day', NOW, 'x')).toBe('2026-09-07');
        expect(resolveDate('', NOW, 'x')).toBeNull();
        expect(() => resolveDate('next tuesday', NOW, 'x')).toThrow(/Invalid input/);
        expect(() => resolveDate('2026-13-01', NOW, 'x')).toThrow(/not a valid date/);
    });
});

describe('resolveInput', () => {
    it('applies the documented defaults for an empty input', async () => {
        const r = await resolveInput({}, NOW, lookups);
        expect(r.options).toMatchObject({
            estados: ['AP'],
            maxItems: 100,
            fetchDetail: true,
            onlyNew: false,
            maxConcurrency: 5,
            resetState: false,
            recheckWindowDays: 30,
            openingFrom: null,
            openingTo: null,
        });
        expect(r.filters.sortBy).toBe('newest');
        expect(r.queries).toEqual([{ estado: 'AP', tipoGestion: null, filters: r.filters }]);
        expect([...r.options.eventTypes].sort()).toEqual(['NEW_LISTING', 'STATUS_CHANGE', 'UPDATED']);
        expect(r.options.deltaStateName).toMatch(/^auto-[0-9a-f]{8}$/);
    });

    it('builds one server-side query per estado and tipoGestion code, in a stable order', async () => {
        const r = await resolveInput(
            { estados: ['ET', 'AP', 'ET'], tipoGestion: ['p', 'L'], anio: 2026 },
            NOW,
            lookups,
        );
        expect(r.options.estados).toEqual(['ET', 'AP']);
        expect(r.filters.tipoGestion).toEqual(['L', 'P']);
        expect(r.filters.anio).toBe(2026);
        expect(r.queries.map((q) => `${q.estado}/${q.tipoGestion}`)).toEqual(['ET/L', 'ET/P', 'AP/L', 'AP/P']);
    });

    it('resolves organismo, rubro and subrubro names to the ids the API filters on', async () => {
        const r = await resolveInput(
            {
                comprador: 'administracion provincial de impuestos',
                solicitante: '46',
                rubro: 'limpieza',
            },
            NOW,
            lookups,
        );
        expect(r.filters.comprador).toBe('27');
        expect(r.filters.solicitante).toBe('46');
        expect(r.filters.idEspecie).toBe('75');
        expect(r.resolvedNames.comprador).toBe('ADMINISTRACIÓN PROVINCIAL DE IMPUESTOS');
        expect(r.resolvedNames.rubro).toBe('SERVICIO DE MANTENIMIENTO, REPARACION Y LIMPIEZA');
        // subrubro list depends on the rubro: 'canes' does not exist under rubro 75
        await expect(resolveInput({ rubro: '75', subrubro: 'canes' }, NOW, lookups)).rejects.toThrow(/matches none/);
        const ok = await resolveInput({ rubro: '57', subrubro: 'canes' }, NOW, lookups);
        expect(ok.filters.idFamilia).toBe('367');
    });

    it('refuses ambiguous names with the list of matches, and a subrubro without a rubro', async () => {
        await expect(resolveInput({ comprador: 'hospital de niños' }, NOW, lookups)).rejects.toThrow(
            /ambiguous.*ALASSIA/,
        );
        await expect(resolveInput({ subrubro: '367' }, NOW, lookups)).rejects.toThrow(/subrubro needs a rubro/);
        expect(resolveByName('x', 'ZONA NORTE', await lookups.organismos()).id).toBe('46');
    });

    it('maps the legacy dateRange onto a symmetric opening window and validates the window', async () => {
        const r = await resolveInput({ dateRange: '7d' }, NOW, lookups);
        expect(r.options.openingFrom).toBe('2026-09-01');
        expect(r.options.openingTo).toBe('2026-09-15');
        const explicit = await resolveInput(
            { openingFrom: '2026-09-01', openingTo: '+30 days', dateRange: '24h' },
            NOW,
            lookups,
        );
        expect(explicit.options.openingFrom).toBe('2026-09-01');
        expect(explicit.options.openingTo).toBe('2026-10-08');
        await expect(
            resolveInput({ openingFrom: '2026-09-10', openingTo: '2026-09-01' }, NOW, lookups),
        ).rejects.toThrow(/openingFrom is after openingTo/);
    });

    it('rejects malformed values with a clear message', async () => {
        await expect(resolveInput({ estados: ['XX' as never] }, NOW, lookups)).rejects.toThrow(/estados/);
        await expect(resolveInput({ tipoGestion: ['Z'] }, NOW, lookups)).rejects.toThrow(/tipoGestion.*valid codes/);
        await expect(resolveInput({ tipoModalidad: '42' }, NOW, lookups)).rejects.toThrow(/tipoModalidad/);
        await expect(resolveInput({ anio: 1999 }, NOW, lookups)).rejects.toThrow(/anio must be between/);
        await expect(resolveInput({ eventTypes: ['BOGUS' as never] }, NOW, lookups)).rejects.toThrow(/eventTypes/);
        await expect(resolveInput({ onlyNew: true, sortBy: 'mostViewed' }, NOW, lookups)).rejects.toThrow(/newest/);
        await expect(resolveInput({ deltaStateName: 'has spaces!' }, NOW, lookups)).rejects.toThrow(/deltaStateName/);
        await expect(resolveInput({ maxItems: 0 }, NOW, lookups)).rejects.toThrow(/maxItems/);
        await expect(resolveInput({ recheckWindowDays: 999 }, NOW, lookups)).rejects.toThrow(/recheckWindowDays/);
    });

    it('clamps performance knobs to safe ranges', async () => {
        const r = await resolveInput({ maxItems: 10_000_000, maxConcurrency: 99 }, NOW, lookups);
        expect(r.options.maxItems).toBe(100_000);
        expect(r.options.maxConcurrency).toBe(10);
        expect((await resolveInput({ maxConcurrency: 0 }, NOW, lookups)).options.maxConcurrency).toBe(1);
    });

    it('derives the delta store from the filter set only - not from the opening window, maxItems, fetchDetail or the recheck window', async () => {
        const a = await resolveInput(
            {
                estados: ['AP', 'ET'],
                objeto: 'Limpieza',
                maxItems: 10,
                fetchDetail: false,
                openingFrom: '7 days',
                recheckWindowDays: 5,
            },
            NOW,
            lookups,
        );
        const b = await resolveInput(
            { estados: ['ET', 'AP'], objeto: 'limpieza', maxItems: 500, fetchDetail: true, openingTo: '+3 days' },
            NOW,
            lookups,
        );
        const c = await resolveInput({ estados: ['AP'], objeto: 'limpieza' }, NOW, lookups);
        expect(a.filtersSignature).toBe(b.filtersSignature);
        expect(a.filtersSignature).not.toBe(c.filtersSignature);
        expect((await resolveInput({ deltaStateName: 'salud-watch' }, NOW, lookups)).options.deltaStateName).toBe(
            'salud-watch',
        );
    });
});
