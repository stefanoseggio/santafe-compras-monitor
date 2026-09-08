import type { EstadoCode, ListingQuery, SortBy } from './types.js';

export const BASE_URL = 'https://www.santafe.gov.ar';
export const SITE_ROOT = `${BASE_URL}/gestionesdecompras/site/`;
const APP_AJAX = '/gestionesdecompras/site/AppAjax.php';

export const ESTADOS: EstadoCode[] = ['AP', 'ET', 'CO'];

export const ESTADO_LABELS: Record<EstadoCode, string> = {
    AP: 'PARA APERTURA',
    ET: 'EN TRÁMITE',
    CO: 'CONCLUIDA',
};

// shared.getTipoEstatico&tipo=TipoGestion&combo=true, captured 2026-09-08.
export const TIPO_GESTION: Record<string, string> = {
    B: 'CONCURSO PÚBLICO',
    V: 'CONCURSO PRIVADO',
    C: 'CONCURSO DE PRECIOS',
    T: 'CONTRATACIÓN DIRECTA',
    I: 'CONCURSOS DE PROYECTOS INTEGRALES',
    D: 'GESTION DIRECTA',
    A: 'LICITACIÓN ACELERADA',
    L: 'LICITACIÓN PÚBLICA',
    P: 'LICITACIÓN PRIVADA',
    S: 'SUBASTA O REMATE PÚBLICO',
    X: 'PROCEDIMIENTO COMPETITIVO AGIL',
    Y: 'ENTES PORTUARIOS - CONTRATACIONES',
    O: 'OTROS',
};

// shared.getTipoModalidad&combo=true, captured 2026-09-08.
export const TIPO_MODALIDAD: Record<string, string> = {
    '1': 'Sin Modalidad',
    '2': 'Convenio Marco',
    '3': 'Contratación Unificada',
    '4': 'Orden de Compra Abierta',
    '5': 'Subasta Inversa',
    '6': 'Llave en Mano',
    '7': 'Consumo Convenio Marco',
    '9999': 'Por Defecto',
};

const SORT_PARAMS: Record<SortBy, { sort: string; dir: 'ASC' | 'DESC' }> = {
    newest: { sort: 'idGestion', dir: 'DESC' },
    openingSoonest: { sort: 'fechaHoraApertura', dir: 'ASC' },
    openingLatest: { sort: 'fechaHoraApertura', dir: 'DESC' },
    mostViewed: { sort: 'consultada', dir: 'DESC' },
};

/**
 * Builds the read-only JSON listing URL the site's own search page calls.
 * Every parameter was live-verified 2026-09-08 with result counts (see
 * AGENTS.md): `estado`, `anio`, `objeto`, `tipoGestion` (ONE letter code -
 * comma-joined values are ignored), `tipoModalidad`, `comprador` and
 * `solicitante` (idOrganismoLey12510), `idEspecie`, `idFamilia` (the site's
 * own sub-rubro select is misnamed `form-select` and does nothing; the
 * backend honours `idFamilia`), `nroGestion`, `nroExpediente`, `sort`+`dir`,
 * `start`+`limit`.
 */
export function listingPath(query: ListingQuery, start: number, limit: number): string {
    const { filters } = query;
    const params = new URLSearchParams();
    params.set('a', 'consultas.getContrataciones');
    params.set('estado', query.estado);
    if (filters.anio !== null) params.set('anio', String(filters.anio));
    if (filters.objeto) params.set('objeto', filters.objeto);
    if (query.tipoGestion) params.set('tipoGestion', query.tipoGestion);
    if (filters.tipoModalidad) params.set('tipoModalidad', filters.tipoModalidad);
    if (filters.comprador) params.set('comprador', filters.comprador);
    if (filters.solicitante) params.set('solicitante', filters.solicitante);
    if (filters.idEspecie) params.set('idEspecie', filters.idEspecie);
    if (filters.idFamilia) params.set('idFamilia', filters.idFamilia);
    if (filters.nroGestion) params.set('nroGestion', filters.nroGestion);
    if (filters.nroExpediente) params.set('nroExpediente', filters.nroExpediente);
    const { sort, dir } = SORT_PARAMS[filters.sortBy];
    params.set('sort', sort);
    params.set('dir', dir);
    params.set('start', String(start));
    params.set('limit', String(limit));
    return `${APP_AJAX}?${params.toString()}`;
}

/** Human-readable listing URL (first page) for logs, status messages and the run summary. */
export function listingUrl(query: ListingQuery): string {
    return `${BASE_URL}${listingPath(query, 0, 50)}`;
}

/** The public detail page. Never append `&contar=1` - that variant increments the site's view counter. */
export function detailPath(idGestion: string): string {
    return `/gestionesdecompras/site/gestion.php?idGestion=${encodeURIComponent(idGestion)}`;
}

export function detailUrl(idGestion: string): string {
    return `${BASE_URL}${detailPath(idGestion)}`;
}

/** Print-ready PDF of the whole record (application/pdf, ~30 KB). */
export function printPdfUrl(idGestion: string): string {
    return `${SITE_ROOT}output.php?a=gestiones.ver&idGestion=${encodeURIComponent(idGestion)}&print=1`;
}

/** Documents-only view of the record. */
export function documentsUrl(idGestion: string): string {
    return `${SITE_ROOT}gestion.php?idGestion=${encodeURIComponent(idGestion)}&solodocs=1`;
}

// The site's own "Ofertar" button target (base_exp_url in site/index.php,
// 2026-08-28 build) for electronic procedures on gestionvirtual.
const BID_BASE_URL = 'https://gestionvirtual.santafe.gob.ar/#/bandeja_proveedores/create/form/680a87a12a055d2295ea39a0';

export function bidUrl(numeroExpediente: string): string {
    return `${BID_BASE_URL}?expedienteCode=${encodeURIComponent(numeroExpediente)}`;
}

/** Resolve a document href from the detail page (./../descargar.php?...) to an absolute URL. */
export function absoluteDocumentUrl(href: string): string {
    return new URL(href, SITE_ROOT).toString();
}

export const COMBO_PATHS = {
    organismos: `${APP_AJAX}?a=shared.getOrganismosLey`,
    rubros: `${APP_AJAX}?a=shared.getEspeciesPrincipales`,
    subrubros: (idEspecie: string): string =>
        `${APP_AJAX}?a=shared.getFamiliasByEspecie&idEspecie=${encodeURIComponent(idEspecie)}`,
};
