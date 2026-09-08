import type { EstadoCode, ListingQuery } from './types.js';
export declare const BASE_URL = "https://www.santafe.gov.ar";
export declare const SITE_ROOT = "https://www.santafe.gov.ar/gestionesdecompras/site/";
export declare const ESTADOS: EstadoCode[];
export declare const ESTADO_LABELS: Record<EstadoCode, string>;
export declare const TIPO_GESTION: Record<string, string>;
export declare const TIPO_MODALIDAD: Record<string, string>;
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
export declare function listingPath(query: ListingQuery, start: number, limit: number): string;
/** Human-readable listing URL (first page) for logs, status messages and the run summary. */
export declare function listingUrl(query: ListingQuery): string;
/** The public detail page. Never append `&contar=1` - that variant increments the site's view counter. */
export declare function detailPath(idGestion: string): string;
export declare function detailUrl(idGestion: string): string;
/** Print-ready PDF of the whole record (application/pdf, ~30 KB). */
export declare function printPdfUrl(idGestion: string): string;
/** Documents-only view of the record. */
export declare function documentsUrl(idGestion: string): string;
export declare function bidUrl(numeroExpediente: string): string;
/** Resolve a document href from the detail page (./../descargar.php?...) to an absolute URL. */
export declare function absoluteDocumentUrl(href: string): string;
export declare const COMBO_PATHS: {
    organismos: string;
    rubros: string;
    subrubros: (idEspecie: string) => string;
};
//# sourceMappingURL=urls.d.ts.map