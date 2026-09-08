import { log } from 'apify';
import { InputError } from './errors.js';
import { resolveOrganismo, resolveRubro, resolveSubrubro } from './lookups.js';
import { shortHash, siteCalendarDate } from './normalize.js';
import { ESTADOS, TIPO_GESTION, TIPO_MODALIDAD } from './urls.js';
const ALL_EVENT_TYPES = ['NEW_LISTING', 'STATUS_CHANGE', 'UPDATED'];
const SORTS = ['newest', 'openingSoonest', 'openingLatest', 'mostViewed'];
const LEGACY_DATE_RANGE_DAYS = { '24h': 1, '7d': 7, '30d': 30 };
export const MAX_ITEMS_HARD_CAP = 100_000;
export const MAX_CONCURRENCY_HARD_CAP = 10;
export const MAX_RECHECK_WINDOW_DAYS = 365;
function text(value) {
    if (typeof value !== 'string')
        return null;
    const v = value.trim();
    return v === '' ? null : v;
}
function oneOf(value, allowed, fallback, field) {
    if (value === undefined || value === null || value === '')
        return fallback;
    if (typeof value === 'string' && allowed.includes(value))
        return value;
    throw new InputError(`${field} must be one of ${allowed.join(', ')} (got "${String(value)}")`);
}
function integer(value, field, fallback, min, max) {
    if (value === undefined || value === null || value === '')
        return fallback;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n))
        throw new InputError(`${field} must be an integer`);
    if (n < min || n > max)
        throw new InputError(`${field} must be between ${min} and ${max} (got ${n})`);
    return n;
}
/**
 * Accepts the Apify datepicker's absolute ("2026-07-01") and relative forms,
 * plus "today" / "now". A relative window counts BACK from today's calendar
 * date in Santa Fe by default ("7 days", "2 weeks", "3 months", "1 year");
 * prefix it with "+" or "in " to count FORWARD ("+30 days" = thirty days from
 * today), which is how "opening in the next month" is expressed for
 * `openingTo`. Returns YYYY-MM-DD.
 */
export function resolveDate(value, now, field) {
    const v = text(value);
    if (!v)
        return null;
    if (/^(today|now)$/i.test(v))
        return siteCalendarDate(now);
    const absolute = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (absolute) {
        const [, , m, d] = absolute.map(Number);
        if (m < 1 || m > 12 || d < 1 || d > 31)
            throw new InputError(`${field} "${v}" is not a valid date`);
        return v;
    }
    const relative = v.match(/^(?:(\+|-|in\s+)\s*)?(\d+)\s*(day|week|month|year)s?(?:\s+ago)?$/i);
    if (!relative) {
        throw new InputError(`${field} must be YYYY-MM-DD, "today", or a relative window like "7 days" (back) or "+30 days" (forward) - got "${v}"`);
    }
    const sign = relative[1] && relative[1].trim() !== '-' ? 1 : -1;
    const amount = Number(relative[2]) * sign;
    const unit = relative[3].toLowerCase();
    const [y, m, d] = siteCalendarDate(now).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (unit === 'day')
        date.setUTCDate(date.getUTCDate() + amount);
    else if (unit === 'week')
        date.setUTCDate(date.getUTCDate() + amount * 7);
    else if (unit === 'month')
        date.setUTCMonth(date.getUTCMonth() + amount);
    else
        date.setUTCFullYear(date.getUTCFullYear() + amount);
    return date.toISOString().slice(0, 10);
}
function shiftDays(now, days) {
    const [y, m, d] = siteCalendarDate(now).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
export async function resolveInput(raw, now, lookups) {
    const resolvedNames = {};
    // ---- estados ----
    const estadosRaw = Array.isArray(raw.estados) && raw.estados.length > 0 ? raw.estados : ['AP'];
    const estados = [];
    for (const e of estadosRaw) {
        const code = String(e).trim().toUpperCase();
        if (!ESTADOS.includes(code))
            throw new InputError(`estados contains unknown value "${String(e)}" (use AP, ET, CO)`);
        if (!estados.includes(code))
            estados.push(code);
    }
    // ---- server-side filters ----
    const anio = raw.anio === undefined || raw.anio === null || raw.anio === ''
        ? null
        : integer(raw.anio, 'anio', 0, 2000, 2100);
    const objeto = text(raw.objeto);
    const tipoGestion = [];
    for (const t of Array.isArray(raw.tipoGestion) ? raw.tipoGestion : []) {
        const code = String(t).trim().toUpperCase();
        if (code === '')
            continue;
        if (!TIPO_GESTION[code]) {
            throw new InputError(`tipoGestion contains unknown code "${String(t)}" - valid codes: ${Object.entries(TIPO_GESTION)
                .map(([k, v]) => `${k} (${v})`)
                .join(', ')}`);
        }
        if (!tipoGestion.includes(code))
            tipoGestion.push(code);
    }
    tipoGestion.sort();
    const tipoModalidad = text(raw.tipoModalidad);
    if (tipoModalidad && !TIPO_MODALIDAD[tipoModalidad]) {
        throw new InputError(`tipoModalidad "${tipoModalidad}" is not a modality code - valid codes: ${Object.entries(TIPO_MODALIDAD)
            .map(([k, v]) => `${k} (${v})`)
            .join(', ')}`);
    }
    const compradorRaw = text(raw.comprador);
    const solicitanteRaw = text(raw.solicitante);
    const rubroRaw = text(raw.rubro);
    const subrubroRaw = text(raw.subrubro);
    let comprador = null;
    let solicitante = null;
    let idEspecie = null;
    let idFamilia = null;
    if (compradorRaw) {
        const r = await resolveOrganismo('comprador', compradorRaw, lookups);
        comprador = r.id;
        resolvedNames.comprador = r.name;
    }
    if (solicitanteRaw) {
        const r = await resolveOrganismo('solicitante', solicitanteRaw, lookups);
        solicitante = r.id;
        resolvedNames.solicitante = r.name;
    }
    if (rubroRaw) {
        const r = await resolveRubro(rubroRaw, lookups);
        idEspecie = r.id;
        resolvedNames.rubro = r.name;
    }
    if (subrubroRaw) {
        if (!idEspecie)
            throw new InputError('subrubro needs a rubro (the site filters sub-rubros within one rubro)');
        const r = await resolveSubrubro(subrubroRaw, idEspecie, lookups);
        idFamilia = r.id;
        resolvedNames.subrubro = r.name;
    }
    const nroGestion = text(raw.nroGestion);
    const nroExpediente = text(raw.nroExpediente);
    // ---- client-side opening-date window (+ legacy dateRange) ----
    let openingFrom = resolveDate(raw.openingFrom, now, 'openingFrom');
    let openingTo = resolveDate(raw.openingTo, now, 'openingTo');
    if (!openingFrom && !openingTo && raw.dateRange) {
        const days = LEGACY_DATE_RANGE_DAYS[String(raw.dateRange)];
        if (days === undefined)
            throw new InputError(`dateRange must be 24h, 7d or 30d (got "${String(raw.dateRange)}")`);
        openingFrom = shiftDays(now, -days);
        openingTo = shiftDays(now, days);
        log.warning(`dateRange is deprecated - use openingFrom / openingTo (interpreted as openingFrom=${openingFrom}, openingTo=${openingTo}).`);
    }
    if (openingFrom && openingTo && openingFrom > openingTo)
        throw new InputError('openingFrom is after openingTo');
    // ---- event types, order, delta ----
    const eventTypesRaw = Array.isArray(raw.eventTypes) && raw.eventTypes.length > 0 ? raw.eventTypes : ALL_EVENT_TYPES;
    for (const t of eventTypesRaw) {
        if (!ALL_EVENT_TYPES.includes(t))
            throw new InputError(`eventTypes contains unknown value "${String(t)}"`);
    }
    const sortBy = oneOf(raw.sortBy, SORTS, 'newest', 'sortBy');
    const onlyNew = raw.onlyNew === true;
    if (onlyNew && sortBy !== 'newest') {
        throw new InputError('onlyNew (delta mode) walks the register newest-first to stop early - use sortBy "newest" (or turn onlyNew off)');
    }
    const maxItems = Math.min(integer(raw.maxItems, 'maxItems', 100, 1, Number.MAX_SAFE_INTEGER), MAX_ITEMS_HARD_CAP);
    const maxConcurrency = Math.max(1, Math.min(MAX_CONCURRENCY_HARD_CAP, integer(raw.maxConcurrency, 'maxConcurrency', 5, 0, Number.MAX_SAFE_INTEGER)));
    const recheckWindowDays = integer(raw.recheckWindowDays, 'recheckWindowDays', 30, 0, MAX_RECHECK_WINDOW_DAYS);
    const fetchDetail = raw.fetchDetail !== false;
    const filters = {
        anio,
        objeto,
        tipoGestion,
        tipoModalidad,
        comprador,
        solicitante,
        idEspecie,
        idFamilia,
        nroGestion,
        nroExpediente,
        sortBy,
    };
    const queries = [];
    for (const estado of estados) {
        for (const tipo of tipoGestion.length > 0 ? tipoGestion : [null])
            queries.push({ estado, tipoGestion: tipo, filters });
    }
    // Everything that changes which rows come back - but not how many
    // (maxItems), how rich they are (fetchDetail), the moving opening
    // window, or the order - defines the delta store.
    const signatureSource = JSON.stringify({
        estados: [...estados].sort(),
        anio,
        objeto: objeto?.toLowerCase() ?? null,
        tipoGestion,
        tipoModalidad,
        comprador,
        solicitante,
        idEspecie,
        idFamilia,
        nroGestion,
        nroExpediente,
        eventTypes: [...eventTypesRaw].sort(),
    });
    const filtersSignature = shortHash(signatureSource);
    const deltaStateName = text(raw.deltaStateName) ?? `auto-${filtersSignature}`;
    if (!/^[A-Za-z0-9-]{1,30}$/.test(deltaStateName)) {
        throw new InputError('deltaStateName may only contain letters, digits and dashes (max 30 characters)');
    }
    return {
        filters,
        queries,
        options: {
            estados,
            maxItems,
            fetchDetail,
            onlyNew,
            maxConcurrency,
            eventTypes: new Set(eventTypesRaw),
            deltaStateName,
            resetState: raw.resetState === true,
            recheckWindowDays,
            openingFrom,
            openingTo,
        },
        filtersSignature,
        resolvedNames,
    };
}
//# sourceMappingURL=input.js.map