// Pure normalisation helpers for the raw strings the Santa Fe register
// renders. Every function is total: invalid input yields null, never throws.
import { createHash } from 'node:crypto';
// The register is operated from Santa Fe, Argentina. Argentina has used a
// fixed UTC-3 offset (America/Argentina/Cordoba) with no daylight saving
// since 2009, so a constant offset is exact - no Intl/DST machinery needed.
// Verified live 2026-09-08: detail pages published "07-09-2026 13:00 Hs."
// were visible at 06:45 UTC on 08-09, consistent with UTC-3.
export const SITE_TIME_ZONE = 'America/Argentina/Cordoba';
export const SITE_UTC_OFFSET_MINUTES = -3 * 60;
/** Calendar date (YYYY-MM-DD) of an instant as seen from Santa Fe. */
export function siteCalendarDate(instant) {
    return new Date(instant.getTime() + SITE_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}
/** Santa Fe wall-clock -> UTC instant. */
export function siteLocalToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - SITE_UTC_OFFSET_MINUTES * 60_000);
}
function validYmd(y, m, d) {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d))
        return false;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31)
        return false;
    return true;
}
/**
 * The listing's `fechaHoraAperturaFija` ("2026-09-04 09:30:00", Santa Fe
 * time) -> UTC ISO instant. Rows with the epoch placeholder "1969-12-31"
 * (seen live on a few very old CO rows) yield null.
 */
export function parseSiteDateTime(value) {
    if (!value)
        return null;
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match)
        return null;
    const [y, m, d, hh, mm, ss] = match.slice(1).map((v) => Number(v ?? 0));
    if (!validYmd(y, m, d))
        return null;
    return siteLocalToUtc(y, m, d, hh, mm, ss).toISOString();
}
/**
 * The detail page's "DD-MM-YYYY HH:mm Hs." stamps (Fecha de Publicación,
 * Fecha y hora límite de presentación de ofertas, Fecha y hora de apertura
 * de ofertas - the latter often followed by " - <note>") -> UTC ISO instant.
 * A bare "DD-MM-YYYY" degrades to local midnight.
 */
export function parseSiteDetailDateTime(value) {
    if (!value)
        return null;
    const match = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!match)
        return null;
    const d = Number(match[1]);
    const m = Number(match[2]);
    const y = Number(match[3]);
    if (!validYmd(y, m, d))
        return null;
    const hh = match[4] === undefined ? 0 : Number(match[4]);
    const mm = match[5] === undefined ? 0 : Number(match[5]);
    if (hh > 23 || mm > 59)
        return null;
    return siteLocalToUtc(y, m, d, hh, mm).toISOString();
}
/** "DD-MM-YYYY" (the listing's `fechaHoraApertura`) -> "YYYY-MM-DD". */
export function parseSiteDate(value) {
    if (!value)
        return null;
    const match = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (!match)
        return null;
    const [d, m, y] = match.slice(1).map(Number);
    if (!validYmd(y, m, d))
        return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Calendar date (Santa Fe) of a UTC ISO instant. */
export function isoToSiteDate(iso) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? siteCalendarDate(new Date(t)) : null;
}
/** Signed whole days from `fromIso` (YYYY-MM-DD) to `toIso`; negative when `toIso` is in the past. */
export function daysBetween(fromIso, toIso) {
    if (!fromIso || !toIso)
        return null;
    const a = Date.parse(`${fromIso}T00:00:00Z`);
    const b = Date.parse(`${toIso}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b))
        return null;
    return Math.round((b - a) / 86_400_000);
}
/**
 * Argentine money strings: "$  207.302.040,00" (ARS), "U$S 60.000,00" (USD),
 * "$ 8209,50 (PESOS ...)", "$  0 -", "$  480.-", "$  7.00". The thousands
 * separator is "." and the decimal separator "," - except that a bare
 * "7.00" / "480.-" style (two digits after a single dot, no comma) is a
 * decimal. Text-only values ("NO APLICA", "SIN COSTO") yield null.
 */
export function parseMoney(value) {
    if (!value)
        return null;
    const v = value.replace(/\s+/g, ' ').trim();
    let currency = null;
    if (/U\$S|USD|D[OÓ]LARES/i.test(v))
        currency = 'USD';
    else if (/\$|PESOS|ARS/i.test(v))
        currency = 'ARS';
    if (!currency)
        return null;
    const numMatch = v.replace(/^[^\d]*/, '').match(/^(\d[\d.]*)(?:,(\d{1,2}))?/);
    if (!numMatch)
        return null;
    let intPart = numMatch[1];
    let decPart = numMatch[2] ?? '';
    if (!decPart) {
        // "7.00" / "480.-": a single dot followed by 1-2 digits at the end is a decimal point
        const dotDecimal = intPart.match(/^(\d+)\.(\d{1,2})$/);
        if (dotDecimal) {
            intPart = dotDecimal[1];
            decPart = dotDecimal[2];
        }
    }
    const amount = Number(`${intPart.replace(/\./g, '')}.${decPart || '0'}`);
    return Number.isFinite(amount) ? { amount, currency } : null;
}
/**
 * "Valor del pliego" is free text on this register. Returns true when the
 * text says the bid documents are free / not applicable, false when a price
 * is quoted, null when the field is empty or undecidable.
 */
export function valorPliegoIsFree(value) {
    if (!value)
        return null;
    const v = value.trim().toUpperCase();
    if (v === '' || v === '-' || v === '--')
        return null;
    const money = parseMoney(v);
    if (money && money.amount > 0)
        return false;
    if (money && money.amount === 0)
        return true;
    if (/NO APLICA|NO CORRESPONDE|SIN CARGO|SIN COSTO|SIN VALOR|S\/V|GRATUIT|NO TIENE COSTO/.test(v))
        return true;
    return null;
}
/** Strip accents/case for tolerant matching of Spanish labels and names. */
export function fold(value) {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
// Electronic procedures are handled on gestionvirtual.santafe.gob.ar; the
// site itself decides whether to show an "Ofertar" button with this exact
// pattern (copied from modules/consultas/js/index.js, 2026-08-28 build).
const ELECTRONIC_EXPEDIENTE = /^[A-Za-z]{1,6}-\d{1,4}-\d{1,8}-APPSF-[A-Za-z]{1,2}(#[A-Za-z]{1,6})*/;
export function isElectronicExpediente(value) {
    return !!value && ELECTRONIC_EXPEDIENTE.test(value.trim());
}
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Argentine phone fragments: "+54 9 342 45196329", "(0342) 450-6600", "342-4910056", "342 5083261"
const PHONE_RE = /(?:\+54[\s-]*)?(?:9[\s-]*)?\(?0?\d{2,4}\)?[\s-]*\d{3,4}[\s-]?\d{3,5}/g;
export function extractEmails(value) {
    if (!value)
        return [];
    return [...new Set((value.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}
export function extractPhones(value) {
    if (!value)
        return [];
    const withoutEmails = value.replace(EMAIL_RE, ' ');
    return [...new Set((withoutEmails.match(PHONE_RE) ?? []).map((p) => p.replace(/\s+/g, ' ').trim()))].filter((p) => p.replace(/\D/g, '').length >= 8);
}
/** "RUBRO / SUBRUBRO" -> parts (the site always joins them with " / "). */
export function splitRubro(raw) {
    const idx = raw.indexOf(' / ');
    if (idx === -1)
        return { rubro: raw.trim() || null, subrubro: null };
    return { rubro: raw.slice(0, idx).trim() || null, subrubro: raw.slice(idx + 3).trim() || null };
}
/** The register renders "-" / "--" for an absent value. */
export function blankToNull(value) {
    if (value === undefined || value === null)
        return null;
    const v = value.replace(/\s+/g, ' ').trim();
    return v === '' || v === '-' || v === '--' ? null : v;
}
/** Stable short hash (FNV-1a) used to derive a delta-state store name from the filter set. */
export function shortHash(input) {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        // eslint-disable-next-line no-bitwise
        h ^= input.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
/** SHA-1 of a canonical JSON serialisation - the per-record content fingerprint stored in the delta state. */
export function contentFingerprint(value) {
    return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}
//# sourceMappingURL=normalize.js.map