export type EstadoCode = 'AP' | 'ET' | 'CO';

export interface ActorInput {
    estados: EstadoCode[];
    fetchDetail: boolean;
    maxItems: number;
}

export interface ListingItem {
    idGestion: string;
    tipoGestion: string;
    fechaHoraApertura: string;
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
    detailUrl: string;
    detail: GestionDetail | null;
    scrapedAt: string;
}
