import type { DateRangePreset } from './dateFilter.js';

export type EstadoCode = 'AP' | 'ET' | 'CO';

// This domain has no signal as specific as e.g. a conviction record's
// "this IS a sanction" - a `CO` (Concluido) process's own detail page
// exposes no awardee/adjudicatario field and its `Estado` label reads a
// flat "CONCLUIDA" regardless of outcome (award, deserted, revoked), so
// there is no defensible way to distinguish "awarded" from "concluded with
// no award" without new scraping this pass doesn't do. Every record is
// therefore `NEW_LISTING` - see AGENTS.md for the live check behind this.
export type EventType = 'NEW_LISTING';

export interface ActorInput {
    estados: EstadoCode[];
    fetchDetail: boolean;
    maxItems: number;
    onlyNew: boolean;
    dateRange?: DateRangePreset;
}

export interface ListingItem {
    idGestion: string;
    tipoGestion: string;
    fechaHoraApertura: string;
    fechaHoraAperturaFija: string;
    numeroGestion: string;
    anioGestion: string;
    valorPliego: string;
    objeto: string;
    idOrganismoGestion: string;
    comprador: string;
    tipoModalidad: string;
    numeroExpediente: string;
}

export interface GestionDocument {
    tipo: string;
    nombre: string;
    url: string;
}

export interface GestionDetail {
    fields: Record<string, string>;
    rubros: string[];
    documentos: GestionDocument[];
}

export interface GestionRecord {
    idGestion: string;
    estado: EstadoCode;
    tipoGestion: string;
    numeroGestion: string;
    anioGestion: string;
    fechaHoraApertura: string;
    objeto: string;
    comprador: string;
    valorPliego: string;
    numeroExpediente: string;
    detail: GestionDetail | null;
    // B2B integration metadata - standardized across this portfolio's fleet
    // so downstream webhook/Zapier/Make consumers need no per-actor parser.
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
}
