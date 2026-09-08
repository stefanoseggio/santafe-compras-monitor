import type { CheerioAPI } from 'cheerio';
import type { DocumentKind, DocumentRecord, EstadoCode, ExpedienteRecord, GestionDetail, RubroRecord } from '../types.js';
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
export declare function documentKind(tipo: string): DocumentKind;
export declare function estadoCodeFromLabel(label: string | null): EstadoCode | null;
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
export declare function parseDetailPage($: CheerioAPI): ParsedDetail;
/** v1-compatible entry point: the `detail` object exactly as version 1 emitted it. */
export declare function parseDetail($: CheerioAPI): GestionDetail;
//# sourceMappingURL=detail.d.ts.map