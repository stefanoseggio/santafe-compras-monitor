import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { documentKind, estadoCodeFromLabel, parseDetail, parseDetailPage } from '../../src/parsers/detail.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('parseDetail (v1-compatible `detail` object)', () => {
    it('extracts simple label/value fields from a real detail page', () => {
        const detail = parseDetail(loadFixture('detail_138825.html'));
        expect(detail.fields['Fecha de Publicación']).toBe('20-08-2026 11:06 Hs.');
        expect(detail.fields.Modalidad).toBe('SIN MODALIDAD');
        expect(detail.fields.Estado).toBe('PARA APERTURA');
        expect(detail.fields.Alcance).toBe('NACIONAL');
        expect(detail.fields['Objeto de la gestión']).toBe('PANELES DE DIAGNOSTICO SINDROMICO');
        expect(detail.fields['Monto Original']).toBe('$ 207.302.040,00');
    });

    it('extracts multi-value Rubros as an array, separate from the joined fields map', () => {
        const detail = parseDetail(loadFixture('detail_138825.html'));
        expect(detail.rubros).toHaveLength(2);
        expect(detail.rubros[0]).toContain('PROD.MEDICINALES');
        expect(detail.fields['Rubros / Subrubros']).toBe(detail.rubros.join('; '));
    });

    it('extracts documentos grouped by tipo, with resolved absolute URLs', () => {
        const detail = parseDetail(loadFixture('detail_138825.html'));
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

describe('parseDetailPage (structured v2 fields) against live-captured pages', () => {
    it('reads an AP page: title parts, estado, dates, places, monto, documents', () => {
        const d = parseDetailPage(loadFixture('detail_138825.html'));
        expect(d.exists).toBe(true);
        expect(d.title).toBe('LICITACIÓN PÚBLICA Nº 18/2026');
        expect(d.tipoGestionName).toBe('LICITACIÓN PÚBLICA');
        expect(d.numeroGestion).toBe('18');
        expect(d.anioGestion).toBe('2026');
        expect(d.estadoLabel).toBe('PARA APERTURA');
        expect(d.estadoCode).toBe('AP');
        expect(d.estadoStage).toBeNull();
        expect(d.publishedAtLocal).toBe('20-08-2026 11:06 Hs.');
        expect(d.submissionDeadlineLocal).toBe('04-09-2026 09:30 Hs.');
        expect(d.openingAtLocal).toBe('04-09-2026 09:30 Hs.');
        expect(d.openingNote).toBeNull();
        expect(d.openingPlace).toBe('OF. DE COMPRAS HNZN');
        expect(d.submissionPlace).toBe('OF. DE COMPRAS HNZN');
        expect(d.deliveryPlaceAndDate).toBe('MICROBIOLOGIA HNZN');
        expect(d.montoOriginalText).toBe('$ 207.302.040,00');
        expect(d.valorPliego).toBe('NO APLICA');
        expect(d.organismoComitente).toEqual(['MINISTERIO DE SALUD - (DGA)']);
        expect(d.organismoLicitante).toBe('HOSPITAL PROVINCIAL DE NIÑOS ZONA NORTE DR. ROBERTO M. CARRA ROSARIO');
        expect(d.rubros).toEqual([
            {
                rubro: 'PROD.MEDICINALES-PROD.QUIM.-INSUMOS P/ENV.MEDICINALES',
                subrubro: 'INSUMOS DE LABORATORIO',
                raw: 'PROD.MEDICINALES-PROD.QUIM.-INSUMOS P/ENV.MEDICINALES / INSUMOS DE LABORATORIO',
            },
            {
                rubro: 'PROD.MEDICINALES-PROD.QUIM.-INSUMOS P/ENV.MEDICINALES',
                subrubro: 'PRODUCTOS QUIMICOS PARA LABORATORIO',
                raw: 'PROD.MEDICINALES-PROD.QUIM.-INSUMOS P/ENV.MEDICINALES / PRODUCTOS QUIMICOS PARA LABORATORIO',
            },
        ]);
        expect(d.documents.map((x) => [x.kind, x.id])).toEqual([
            ['pliego', '170795'],
            ['pliego', '170797'],
            ['otros', '170798'],
        ]);
        expect(d.expedientes).toEqual([]);
        expect(d.notes).toEqual([]);
    });

    it('reads contact, the electronic expediente with its tracker link, and a deadline distinct from the opening', () => {
        const d = parseDetailPage(loadFixture('detail_139013_contact_electronic.html'));
        expect(d.contactInfo).toBe('+54 9 342 45196329 O 342-4910056');
        expect(d.submissionPlace).toBe('A TRAVÉS DE CORREO ELECTRÓNICO A: COMPRASIAPIP@SANTAFE.GOV.AR');
        expect(d.submissionDeadlineLocal).toBe('07-09-2026 23:00 Hs.');
        expect(d.openingAtLocal).toBe('08-09-2026 07:00 Hs.');
        expect(d.expedientes).toEqual([
            {
                label: 'EXPEDIENTE NÚMERO',
                code: 'EE-2026-00044356-APPSF-OD',
                url: 'https://www.santafe.gov.ar/expedientes-web/expediente-timbo/?anioTimbo=2026&numeroTimbo=00044356&tipoReparticion=APPSF&reparticionTimbo=OD&tipoTimbo=1&buscarTimbo=Buscar',
            },
        ]);
        expect(d.legacy.fields.Expedientes).toBe('EXPEDIENTE NÚMERO: EE-2026-00044356-APPSF-OD');
        expect(d.montoOriginalText).toBe('$ 11.663.750,00');
        expect(d.deliveryPlaceAndDate).toBe('FABRICA DE COLCHONES UNIDAD N°11 - PIÑERO');
    });

    it('reads an ET page with a circular aclaratoria and a link inside the submission place', () => {
        const d = parseDetailPage(loadFixture('detail_138676_circular_et.html'));
        expect(d.estadoLabel).toBe('EN TRÁMITE');
        expect(d.estadoCode).toBe('ET');
        expect(d.documents.map((x) => x.kind)).toEqual(['pliego', 'pliego', 'circular']);
        expect(d.documents[2].nombre).toBe('CIRCULAR ACLARATORIA');
        expect(d.submissionPlace).toContain('HTTPS://GESTIONVIRTUAL.SANTAFE.GOB.AR');
        expect(d.deliveryPlaceAndDate).toBe(
            'DEPARTAMENTO DE COMPRAS Y SUMINISTROS DE LA A.P.I., SITO EN ITUZAINGÓ N° 1258, QUINTO PISO, DE LA CIUDAD DE SANTA FE. - 31-08-2026',
        );
        expect(d.valorPliego).toBeNull(); // empty <span>
        expect(d.montoOriginalText).toBe('$ 91.752.000,00');
    });

    it('reads a concluded 2022 page: priced pliego, legacy SIE expediente, acta + preadjudicación', () => {
        const d = parseDetailPage(loadFixture('detail_126068_co_acta_preadj.html'));
        expect(d.estadoCode).toBe('CO');
        expect(d.valorPliego).toBe('$ 8209,50 (PESOS OCHO MIL DOSCIENTOS NUEVE CON CINCUENTA CENTAVOS)');
        expect(d.expedientes[0].code).toBe('13301-0318366-7');
        expect(d.expedientes[0].url).toContain('/index.php/apps/sie?');
        expect(d.documents.map((x) => x.kind)).toEqual(['pliego', 'pliego', 'acta_apertura', 'preadjudicacion']);
    });

    it('reads a USD budget and turns malformed "IMPORTANTE" blocks into notes without crashing', () => {
        const d = parseDetailPage(loadFixture('detail_139031_usd_notes.html'));
        expect(d.montoOriginalText).toBe('U$S 60.000,00');
        expect(d.contactInfo).toBe('(0342) 450-6600 INTERNO 1302 - 1593 - COMPRASMGP@SANTAFE.GOV.AR');
        expect(d.notes.length).toBe(3);
        expect(d.notes[0]).toContain('CRONOGRAMA DE RECEPCI');
        expect(d.notes[2]).toContain('compras.santafe.gob.ar/tutoriales');
        expect(d.documents.map((x) => x.kind)).toEqual(['pliego', 'pliego', 'otros', 'otros']);
        expect(d.expedientes[0]).toMatchObject({ label: 'EXPEDIENTE PRINCIPAL', code: 'EE-2026-00006835-APPSF-PE' });
    });

    it('classifies the full award-stage document set of a concluded tender', () => {
        const d = parseDetailPage(loadFixture('detail_137923_co_full_docs.html'));
        const kinds = new Set(d.documents.map((x) => x.kind));
        expect(kinds).toEqual(
            new Set([
                'pliego',
                'llamado',
                'acta_apertura',
                'cuadro_comparativo',
                'informe_comision',
                'preadjudicacion',
                'adjudicacion',
                'orden_provision',
                'otros',
            ]),
        );
        expect(
            d.documents.every((x) => x.url.startsWith('https://www.santafe.gov.ar/gestionesdecompras/descargar.php?')),
        ).toBe(true);
    });

    it('splits a staged estado label ("EN TRÁMITE - Análisis de ofertas - ...") into code + stage', () => {
        const d = parseDetailPage(loadFixture('detail_137081_estado_stage.html'));
        expect(d.estadoCode).toBe('ET');
        expect(d.estadoStage).toBe('Análisis de ofertas - Control de documentación');
        expect(d.exists).toBe(true);
    });

    it('recognises the "no existe o no está publicada aún" page as nonexistent', () => {
        const d = parseDetailPage(loadFixture('detail_nonexistent.html'));
        expect(d.exists).toBe(false);
        expect(d.title).toBeNull();
        expect(d.legacy).toEqual({ fields: {}, rubros: [], documentos: [] });
    });

    it('maps document headers and estado labels tolerant of accents and case', () => {
        expect(documentKind('Informe de Preadjudicación')).toBe('preadjudicacion');
        expect(documentKind('NORMA LEGAL DE ADJUDICACION')).toBe('adjudicacion');
        expect(documentKind('Nómina de Oferentes')).toBe('nomina_oferentes');
        expect(documentKind('Planimetría')).toBe('planimetria');
        expect(documentKind('Something new')).toBe('otros');
        expect(estadoCodeFromLabel('EN TRAMITE')).toBe('ET');
        expect(estadoCodeFromLabel('Concluida')).toBe('CO');
        expect(estadoCodeFromLabel('DESIERTA')).toBeNull();
    });
});
