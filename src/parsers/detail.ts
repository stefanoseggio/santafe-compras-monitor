import type { CheerioAPI } from 'cheerio';

import { blankToNull, fold } from '../normalize.js';
import type {
    DocumentKind,
    DocumentRecord,
    EstadoCode,
    ExpedienteRecord,
    GestionDetail,
    GestionDocument,
    RubroRecord,
} from '../types.js';
import { absoluteDocumentUrl } from '../urls.js';

export interface ParsedDetail {
    /** false for "La gestión no existe o no está publicada aún" (HTTP 200, no data blocks). */
    exists: boolean;
    /** "<h3>LICITACIÓN PÚBLICA Nº 18/2026</h3>" split into its parts. */
    title: string | null;
    tipoGestionName: string | null;
    numeroGestion: string | null;
    anioGestion: string | null;
    /** The v1 shape, kept verbatim on every record. */
    legacy: GestionDetail;
    estadoLabel: string | null;
    estadoStage: string | null;
    estadoCode: EstadoCode | null;
    publishedAtLocal: string | null;
    modalidad: string | null;
    alcance: string | null;
    objeto: string | null;
    descripcion: string | null;
    rubros: RubroRecord[];
    organismoComitente: string[];
    organismoLicitante: string | null;
    submissionPlace: string | null;
    submissionDeadlineLocal: string | null;
    openingPlace: string | null;
    openingAtLocal: string | null;
    openingNote: string | null;
    deliveryPlaceAndDate: string | null;
    contactInfo: string | null;
    valorPliego: string | null;
    montoOriginalText: string | null;
    expedientes: ExpedienteRecord[];
    /** Free-form "IMPORTANTE" style blocks some buyers add (no proper label). */
    notes: string[];
    documents: DocumentRecord[];
}

// Live-verified vocabulary of <h5> document headers (120-page sample, 2026-09-08):
// Pliego 94, Otros 49, Orden de Provisión 47, Cuadro Comparativo de Precios 43,
// Acta de Apertura 35, Informe de Preadjudicación 32, Norma Legal de
// Adjudicación 29, Llamado a Licitación 10, Circulares 4, Informe de Comisión 3,
// Documento de Provisión 2, Nómina de Oferentes 1, Planimetría 1.
const DOCUMENT_KINDS: [RegExp, DocumentKind][] = [
    [/^PLIEGO/, 'pliego'],
    [/CIRCULAR/, 'circular'],
    [/LLAMADO/, 'llamado'],
    [/ACTA DE APERTURA/, 'acta_apertura'],
    [/NOMINA DE OFERENTES/, 'nomina_oferentes'],
    [/CUADRO COMPARATIVO/, 'cuadro_comparativo'],
    [/INFORME DE COMISION/, 'informe_comision'],
    [/PREADJUDICACION/, 'preadjudicacion'],
    [/ADJUDICACION/, 'adjudicacion'],
    [/ORDEN DE PROVISION/, 'orden_provision'],
    [/DOCUMENTO DE PROVISION/, 'documento_provision'],
    [/PLANIMETRIA/, 'planimetria'],
];

export function documentKind(tipo: string): DocumentKind {
    const folded = fold(tipo);
    for (const [pattern, kind] of DOCUMENT_KINDS) if (pattern.test(folded)) return kind;
    return 'otros';
}

function collapse(text: string): string {
    // Some buyers paste rich text with zero-width spaces / NBSPs into the page.
    return text
        .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Look a label up tolerant of accents/case ("Fecha de Publicación" == "FECHA DE PUBLICACION"). */
function field(fields: Record<string, string>, label: string): string | null {
    const wanted = fold(label);
    for (const [key, value] of Object.entries(fields)) if (fold(key) === wanted) return blankToNull(value);
    return null;
}

export function estadoCodeFromLabel(label: string | null): EstadoCode | null {
    if (!label) return null;
    const folded = fold(label);
    if (folded.startsWith('PARA APERTURA')) return 'AP';
    if (folded.startsWith('EN TRAMITE')) return 'ET';
    if (folded.startsWith('CONCLUIDA')) return 'CO';
    return null;
}

/** "EN TRÁMITE  - Análisis de ofertas - Control de documentación" -> the part after the first " - ". */
function estadoStageOf(label: string | null): string | null {
    if (!label) return null;
    const idx = label.indexOf(' - ');
    return idx === -1 ? null : blankToNull(label.slice(idx + 3));
}

/** "04-09-2026 09:30 Hs. -  (*** NUEVA FECHA ***)" -> { when: "04-09-2026 09:30 Hs.", note: "(*** NUEVA FECHA ***)" } */
function splitDateAndNote(value: string | null): { when: string | null; note: string | null } {
    if (!value) return { when: null, note: null };
    const idx = value.indexOf(' - ');
    if (idx === -1) {
        const trimmed = value.replace(/\s*-\s*$/, '');
        return { when: blankToNull(trimmed), note: null };
    }
    return { when: blankToNull(value.slice(0, idx)), note: blankToNull(value.slice(idx + 3)) };
}

/** "LICITACIÓN PÚBLICA Nº 18/2026" -> parts. */
function parseTitle(title: string | null): { tipo: string | null; numero: string | null; anio: string | null } {
    if (!title) return { tipo: null, numero: null, anio: null };
    const match = title.match(/^(.*?)\s+N[º°o.]*\s*(\S+?)\/(\d{4})\s*$/i);
    if (!match) return { tipo: title, numero: null, anio: null };
    return { tipo: collapse(match[1]) || null, numero: match[2], anio: match[3] };
}

/**
 * The detail page is a flat sequence of `<div class="col-12 mb-4">` blocks
 * (live-verified 2026-09-08 on AP/ET/CO pages): most are
 * `<b>Label:</b><span>Value</span>`; Rubros / Subrubros, Organismo comitente
 * and Expedientes use one or more `<div>` for multiple values (Expedientes
 * wraps the code in a link to the expedientes-web tracker); the Documentos
 * block is `<h4>Documentos</h4>` + `<h5>Tipo</h5>` headers each followed by
 * `<div><a href title>Nombre</a></div>` links; a few buyers append free-form
 * blocks with a malformed `<b>IMPORTANTE<b>` label - those become `notes`.
 * A nonexistent/unpublished id renders HTTP 200 with the sentence
 * "La gestión no existe o no está publicada aún" and no blocks at all.
 */
export function parseDetailPage($: CheerioAPI): ParsedDetail {
    const fields: Record<string, string> = {};
    let rubrosRaw: string[] = [];
    const documentos: GestionDocument[] = [];
    const documents: DocumentRecord[] = [];
    const expedientes: ExpedienteRecord[] = [];
    const organismoComitente: string[] = [];
    const notes: string[] = [];

    const content = $('.content').first();
    const contentText = collapse(content.text());
    const title = blankToNull(content.find('h3').first().text());
    const marker =
        content.find('h4').filter((_i, el) => fold($(el).text()).includes('DATOS DE LA GESTION')).length > 0 ||
        title !== null;
    const exists = marker && !fold(contentText).includes('NO EXISTE O NO EST');

    $('div.col-12.mb-4').each((_i, el) => {
        const $block = $(el);

        if ($block.children('h4').filter((_j, h4) => fold($(h4).text()) === 'DOCUMENTOS').length > 0) {
            let currentTipo = '';
            $block.children().each((_k, child) => {
                const $child = $(child);
                if (child.tagName === 'h5') {
                    currentTipo = collapse($child.text());
                    return;
                }
                if (child.tagName === 'div') {
                    const $a = $child.find('a').first();
                    if ($a.length === 0) return;
                    const href = $a.attr('href');
                    if (!href) return;
                    const nombre = collapse($a.attr('title') ?? $a.text());
                    const url = absoluteDocumentUrl(href);
                    documentos.push({ tipo: currentTipo, nombre, url });
                    let id: string | null = null;
                    try {
                        id = new URL(url).searchParams.get('id');
                    } catch {
                        id = null;
                    }
                    documents.push({ kind: documentKind(currentTipo), tipo: currentTipo, nombre, url, id });
                }
            });
            return;
        }

        const $label = $block.children('b').first();
        if ($label.length === 0) return;
        // Free-form blocks: `<b> IMPORTANTE <b> <span>...` (nested/unclosed <b>) or a label without a colon.
        const rawLabel = collapse($label.clone().children().remove().end().text());
        if ($label.find('b, span, div').length > 0 || !rawLabel.endsWith(':')) {
            const note = collapse($block.text());
            if (note) notes.push(note);
            return;
        }
        const label = rawLabel.replace(/:$/, '').trim();
        if (!label) return;

        const $span = $block.children('span').first();
        if ($span.length > 0) {
            fields[label] = collapse($span.text());
            return;
        }

        const $divs = $block.children('div');
        const values = $divs
            .map((_j, div) => collapse($(div).text()))
            .get()
            .filter(Boolean);
        if (values.length === 0) return;
        fields[label] = values.join('; ');

        const foldedLabel = fold(label);
        if (foldedLabel.startsWith('RUBROS')) rubrosRaw = values;
        else if (foldedLabel.startsWith('ORGANISMO COMITENTE')) organismoComitente.push(...values);
        else if (foldedLabel.startsWith('EXPEDIENTE')) {
            $divs.each((_j, div) => {
                const $div = $(div);
                const text = collapse($div.text());
                if (!text) return;
                const $a = $div.find('a').first();
                const colon = text.indexOf(':');
                const labelPart = colon === -1 ? 'EXPEDIENTE' : collapse(text.slice(0, colon));
                const code =
                    $a.length > 0 ? collapse($a.text()) : collapse(colon === -1 ? text : text.slice(colon + 1));
                if (!code) return;
                expedientes.push({ label: labelPart, code, url: $a.attr('href') ?? null });
            });
        }
    });

    const estadoLabel = field(fields, 'Estado');
    const opening = splitDateAndNote(field(fields, 'Fecha y hora de apertura de ofertas'));
    const titleParts = parseTitle(title);

    return {
        exists,
        title,
        tipoGestionName: titleParts.tipo,
        numeroGestion: titleParts.numero,
        anioGestion: titleParts.anio,
        legacy: { fields, rubros: rubrosRaw, documentos },
        estadoLabel,
        estadoStage: estadoStageOf(estadoLabel),
        estadoCode: estadoCodeFromLabel(estadoLabel),
        publishedAtLocal: field(fields, 'Fecha de Publicación'),
        modalidad: field(fields, 'Modalidad'),
        alcance: field(fields, 'Alcance'),
        objeto: field(fields, 'Objeto de la gestión'),
        descripcion: field(fields, 'Descripción'),
        rubros: rubrosRaw.map((raw) => {
            const idx = raw.indexOf(' / ');
            return idx === -1
                ? { rubro: raw, subrubro: null, raw }
                : { rubro: raw.slice(0, idx).trim() || null, subrubro: raw.slice(idx + 3).trim() || null, raw };
        }),
        organismoComitente,
        organismoLicitante: field(fields, 'Organismo licitante'),
        submissionPlace: field(fields, 'Lugar de presentación de ofertas'),
        submissionDeadlineLocal: field(fields, 'Fecha y hora límite de presentación de ofertas'),
        openingPlace: field(fields, 'Lugar de apertura de ofertas'),
        openingAtLocal: opening.when,
        openingNote: opening.note,
        deliveryPlaceAndDate: splitTrailingDash(field(fields, 'Lugar y fecha de entrega')),
        contactInfo: field(fields, 'Contacto para información'),
        valorPliego: field(fields, 'Valor del pliego'),
        montoOriginalText: field(fields, 'Monto Original'),
        expedientes,
        notes,
        documents,
    };
}

/** "MICROBIOLOGIA HNZN - " -> "MICROBIOLOGIA HNZN"; "ANEXO ... - 31-08-2026" is kept whole. */
function splitTrailingDash(value: string | null): string | null {
    if (!value) return null;
    return blankToNull(value.replace(/(\s*-\s*)+$/, ''));
}

/** v1-compatible entry point: the `detail` object exactly as version 1 emitted it. */
export function parseDetail($: CheerioAPI): GestionDetail {
    return parseDetailPage($).legacy;
}
