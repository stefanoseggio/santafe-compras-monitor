export type EstadoCode = 'AP' | 'ET' | 'CO';
export type EventType = 'NEW_LISTING' | 'STATUS_CHANGE' | 'UPDATED';
export type SortBy = 'newest' | 'openingSoonest' | 'openingLatest' | 'mostViewed';
/** Legacy v1 preset, still honoured and mapped onto an opening-date window around today. */
export type DateRangePreset = '24h' | '7d' | '30d';

export interface ActorInput {
    // ---- Filters (every one is applied server-side by the site's JSON API,
    // except openingFrom / openingTo and eventTypes which are client-side) ----
    estados?: EstadoCode[];
    anio?: number | string;
    objeto?: string;
    tipoGestion?: string[];
    tipoModalidad?: string;
    comprador?: string;
    solicitante?: string;
    rubro?: string;
    subrubro?: string;
    nroGestion?: string;
    nroExpediente?: string;
    openingFrom?: string;
    openingTo?: string;
    eventTypes?: EventType[];
    // ---- Monitoring / delta ----
    onlyNew?: boolean;
    sortBy?: SortBy;
    deltaStateName?: string;
    resetState?: boolean;
    recheckWindowDays?: number;
    // ---- Limits & performance ----
    maxItems?: number;
    fetchDetail?: boolean;
    maxConcurrency?: number;
    /** @deprecated use openingFrom / openingTo */
    dateRange?: DateRangePreset;
}

/** The server-side part of the query, shared by every estado walked in a run. */
export interface ListingFilters {
    anio: number | null;
    objeto: string | null;
    /** Letter codes from shared.getTipoEstatico (L, P, T, ...); one query per code, [] = all types. */
    tipoGestion: string[];
    tipoModalidad: string | null;
    /** idOrganismoLey12510 of the organismo licitante (buyer). */
    comprador: string | null;
    /** idOrganismoLey12510 of the organismo comitente (requesting body). */
    solicitante: string | null;
    /** idEspecie (rubro). */
    idEspecie: string | null;
    /** idFamilia (subrubro) - only meaningful together with idEspecie. */
    idFamilia: string | null;
    nroGestion: string | null;
    nroExpediente: string | null;
    sortBy: SortBy;
}

/** One concrete server-side query = one estado (x one tipoGestion code when several are selected). */
export interface ListingQuery {
    estado: EstadoCode;
    tipoGestion: string | null;
    filters: ListingFilters;
}

/** One row of AppAjax.php?a=consultas.getContrataciones (keys verified live 2026-09-08). */
export interface ListingItem {
    idGestion: string;
    tipoGestion: string;
    /** DD-MM-YYYY */
    fechaHoraApertura: string;
    /** YYYY-MM-DD HH:mm:ss, Argentina time */
    fechaHoraAperturaFija: string;
    /** "18-2026" */
    numeroAño?: string;
    numeroGestion: string;
    anioGestion: string;
    valorPliego: string;
    objeto: string;
    objetoCompleto?: string;
    idOrganismoGestion: string;
    comprador: string;
    tipoModalidad: string;
    numeroExpediente: string;
    /** Present on ET/CO rows only. */
    destinos?: string;
}

export interface GestionDocument {
    tipo: string;
    nombre: string;
    url: string;
}

/** The v1 `detail` object - kept verbatim on every record for backwards compatibility. */
export interface GestionDetail {
    fields: Record<string, string>;
    rubros: string[];
    documentos: GestionDocument[];
}

export type DocumentKind =
    | 'pliego'
    | 'circular'
    | 'llamado'
    | 'acta_apertura'
    | 'nomina_oferentes'
    | 'cuadro_comparativo'
    | 'informe_comision'
    | 'preadjudicacion'
    | 'adjudicacion'
    | 'orden_provision'
    | 'documento_provision'
    | 'planimetria'
    | 'otros';

export interface DocumentRecord {
    kind: DocumentKind;
    tipo: string;
    nombre: string;
    url: string;
    /** The site's own attachment id (from descargar.php?id=...). */
    id: string | null;
}

export interface RubroRecord {
    rubro: string | null;
    subrubro: string | null;
    raw: string;
}

export interface ExpedienteRecord {
    label: string;
    code: string;
    url: string | null;
}

export interface GestionRecord {
    // ---- Fields that existed in v1 (names unchanged) ----
    idGestion: string;
    estado: EstadoCode;
    tipoGestion: string | null;
    numeroGestion: string | null;
    anioGestion: string | null;
    fechaHoraApertura: string | null;
    objeto: string | null;
    comprador: string | null;
    valorPliego: string | null;
    numeroExpediente: string | null;
    detail: GestionDetail | null;
    // ---- Standardised B2B envelope (shared across this portfolio's fleet) ----
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
    data_source: string;

    // ---- Identity & listing twins ----
    idGestionNumber: number;
    numeroAnio: string | null;
    tipoGestionCode: string | null;
    tipoModalidad: string | null;
    idOrganismoGestion: string | null;
    objetoCompleto: string | null;
    destinos: string | null;
    fechaHoraAperturaFija: string | null;
    openingAt: string | null;
    openingDate: string | null;
    daysUntilOpening: number | null;
    isOpeningInFuture: boolean | null;
    valorPliegoAmount: number | null;
    valorPliegoCurrency: string | null;
    valorPliegoIsFree: boolean | null;
    previousEstado: EstadoCode | null;
    isElectronic: boolean;
    bidUrl: string | null;
    printPdfUrl: string;
    documentsUrl: string;

    // ---- Detail page (null / [] / false when fetchDetail=false or the page was unavailable) ----
    detailFetched: boolean;
    detailError: string | null;
    estadoLabel: string | null;
    estadoStage: string | null;
    estadoFromDetail: EstadoCode | null;
    publishedAtLocal: string | null;
    publishedAt: string | null;
    publishedDate: string | null;
    daysSincePublished: number | null;
    modalidad: string | null;
    alcance: string | null;
    descripcion: string | null;
    rubros: RubroRecord[];
    rubroNames: string[];
    subrubroNames: string[];
    organismoComitente: string[];
    organismoLicitante: string | null;
    submissionPlace: string | null;
    submissionDeadlineLocal: string | null;
    submissionDeadline: string | null;
    daysUntilDeadline: number | null;
    openingPlace: string | null;
    openingAtDetailLocal: string | null;
    openingNote: string | null;
    deliveryPlaceAndDate: string | null;
    contactInfo: string | null;
    contactEmails: string[];
    contactPhones: string[];
    valorPliegoDetail: string | null;
    montoOriginalText: string | null;
    montoOriginalAmount: number | null;
    montoOriginalCurrency: string | null;
    expedientes: ExpedienteRecord[];
    expediente: string | null;
    expedienteUrl: string | null;
    notes: string[];
    documents: DocumentRecord[];
    documentCount: number;
    documentKinds: string[];
    hasPliego: boolean;
    hasCircular: boolean;
    hasActaApertura: boolean;
    hasPreadjudicacion: boolean;
    hasAdjudicacion: boolean;
    hasOrdenProvision: boolean;
    hasCuadroComparativo: boolean;
    contentHash: string | null;
}

export const DATA_SOURCE_ATTRIBUTION =
    'Gestiones de Compra - Gobierno de la Provincia de Santa Fe (santafe.gov.ar/gestionesdecompras), CC BY-SA 2.5 AR';
