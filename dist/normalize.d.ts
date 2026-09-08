export declare const SITE_TIME_ZONE = "America/Argentina/Cordoba";
export declare const SITE_UTC_OFFSET_MINUTES: number;
/** Calendar date (YYYY-MM-DD) of an instant as seen from Santa Fe. */
export declare function siteCalendarDate(instant: Date): string;
/** Santa Fe wall-clock -> UTC instant. */
export declare function siteLocalToUtc(year: number, month: number, day: number, hour?: number, minute?: number, second?: number): Date;
/**
 * The listing's `fechaHoraAperturaFija` ("2026-09-04 09:30:00", Santa Fe
 * time) -> UTC ISO instant. Rows with the epoch placeholder "1969-12-31"
 * (seen live on a few very old CO rows) yield null.
 */
export declare function parseSiteDateTime(value: string | null | undefined): string | null;
/**
 * The detail page's "DD-MM-YYYY HH:mm Hs." stamps (Fecha de Publicación,
 * Fecha y hora límite de presentación de ofertas, Fecha y hora de apertura
 * de ofertas - the latter often followed by " - <note>") -> UTC ISO instant.
 * A bare "DD-MM-YYYY" degrades to local midnight.
 */
export declare function parseSiteDetailDateTime(value: string | null | undefined): string | null;
/** "DD-MM-YYYY" (the listing's `fechaHoraApertura`) -> "YYYY-MM-DD". */
export declare function parseSiteDate(value: string | null | undefined): string | null;
/** Calendar date (Santa Fe) of a UTC ISO instant. */
export declare function isoToSiteDate(iso: string | null): string | null;
/** Signed whole days from `fromIso` (YYYY-MM-DD) to `toIso`; negative when `toIso` is in the past. */
export declare function daysBetween(fromIso: string | null, toIso: string | null): number | null;
export interface Money {
    amount: number;
    currency: 'ARS' | 'USD';
}
/**
 * Argentine money strings: "$  207.302.040,00" (ARS), "U$S 60.000,00" (USD),
 * "$ 8209,50 (PESOS ...)", "$  0 -", "$  480.-", "$  7.00". The thousands
 * separator is "." and the decimal separator "," - except that a bare
 * "7.00" / "480.-" style (two digits after a single dot, no comma) is a
 * decimal. Text-only values ("NO APLICA", "SIN COSTO") yield null.
 */
export declare function parseMoney(value: string | null | undefined): Money | null;
/**
 * "Valor del pliego" is free text on this register. Returns true when the
 * text says the bid documents are free / not applicable, false when a price
 * is quoted, null when the field is empty or undecidable.
 */
export declare function valorPliegoIsFree(value: string | null | undefined): boolean | null;
/** Strip accents/case for tolerant matching of Spanish labels and names. */
export declare function fold(value: string): string;
export declare function isElectronicExpediente(value: string | null | undefined): boolean;
export declare function extractEmails(value: string | null | undefined): string[];
export declare function extractPhones(value: string | null | undefined): string[];
/** "RUBRO / SUBRUBRO" -> parts (the site always joins them with " / "). */
export declare function splitRubro(raw: string): {
    rubro: string | null;
    subrubro: string | null;
};
/** The register renders "-" / "--" for an absent value. */
export declare function blankToNull(value: string | null | undefined): string | null;
/** Stable short hash (FNV-1a) used to derive a delta-state store name from the filter set. */
export declare function shortHash(input: string): string;
/** SHA-1 of a canonical JSON serialisation - the per-record content fingerprint stored in the delta state. */
export declare function contentFingerprint(value: unknown): string;
//# sourceMappingURL=normalize.d.ts.map