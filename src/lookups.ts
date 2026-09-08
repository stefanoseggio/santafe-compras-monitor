import { log } from 'apify';

import { InputError } from './errors.js';
import { fetchWithRetry } from './http.js';
import { fold } from './normalize.js';
import { COMBO_PATHS } from './urls.js';

export interface LookupEntry {
    id: string;
    name: string;
}

/**
 * The site's combo endpoints, used to translate a human name typed in the
 * input into the id the listing API filters on. Injected so tests never
 * touch the network.
 */
export interface LookupClient {
    organismos(): Promise<LookupEntry[]>;
    rubros(): Promise<LookupEntry[]>;
    subrubros(idEspecie: string): Promise<LookupEntry[]>;
}

interface ComboResponse {
    success?: unknown;
    data?: unknown;
}

async function fetchCombo(path: string, idKey: string, nameKey: string, what: string): Promise<LookupEntry[]> {
    const body = await fetchWithRetry(path);
    let raw: ComboResponse;
    try {
        raw = JSON.parse(body) as ComboResponse;
    } catch {
        throw new Error(`The ${what} list endpoint did not return JSON (site changed or under maintenance): ${path}`);
    }
    if (raw.success !== true || !Array.isArray(raw.data)) {
        throw new Error(`The ${what} list endpoint returned an unexpected shape: ${path}`);
    }
    const entries: LookupEntry[] = [];
    for (const row of raw.data as Record<string, unknown>[]) {
        const id = row?.[idKey];
        const name = row?.[nameKey];
        if (typeof id === 'string' && typeof name === 'string') entries.push({ id, name: name.trim() });
    }
    return entries;
}

/** Live client with a per-run cache (each list is fetched at most once). */
export function liveLookups(): LookupClient {
    const cache = new Map<string, Promise<LookupEntry[]>>();
    const cached = async (key: string, load: () => Promise<LookupEntry[]>): Promise<LookupEntry[]> => {
        let p = cache.get(key);
        if (!p) {
            p = load();
            cache.set(key, p);
        }
        return p;
    };
    return {
        organismos: async () =>
            cached('organismos', async () =>
                fetchCombo(COMBO_PATHS.organismos, 'idOrganismoLey12510', 'nombre', 'organismo'),
            ),
        rubros: async () =>
            cached('rubros', async () => fetchCombo(COMBO_PATHS.rubros, 'idEspecie', 'nombre', 'rubro')),
        subrubros: async (idEspecie) =>
            cached(`subrubros:${idEspecie}`, async () =>
                fetchCombo(COMBO_PATHS.subrubros(idEspecie), 'idFamilia', 'nombre', 'subrubro'),
            ),
    };
}

/**
 * Resolve an input value to an id: a numeric string is taken as the id
 * itself; anything else is matched against the list by name, accent- and
 * case-insensitively - an exact match wins, otherwise a unique substring
 * match; ambiguity or no match is an InputError that lists the options.
 */
export function resolveByName(field: string, value: string, entries: LookupEntry[]): { id: string; name: string } {
    const needle = fold(value);
    if (/^\d+$/.test(needle)) {
        const known = entries.find((e) => e.id === needle);
        return { id: needle, name: known?.name ?? needle };
    }
    const exact = entries.filter((e) => fold(e.name) === needle);
    if (exact.length === 1) return exact[0];
    const partial = entries.filter((e) => fold(e.name).includes(needle));
    if (partial.length === 1) return partial[0];
    if (partial.length === 0) {
        throw new InputError(`${field} "${value}" matches none of the ${entries.length} names the site lists`);
    }
    const options = partial
        .slice(0, 8)
        .map((e) => `${e.name} (${e.id})`)
        .join('; ');
    throw new InputError(
        `${field} "${value}" is ambiguous - ${partial.length} names match. Use the id or a longer name: ${options}`,
    );
}

export async function resolveOrganismo(
    field: string,
    value: string,
    lookups: LookupClient,
): Promise<{ id: string; name: string }> {
    if (/^\d+$/.test(value.trim())) return { id: value.trim(), name: value.trim() };
    const resolved = resolveByName(field, value, await lookups.organismos());
    log.info(`${field} "${value}" resolved to organismo ${resolved.id} (${resolved.name}).`);
    return resolved;
}

export async function resolveRubro(value: string, lookups: LookupClient): Promise<{ id: string; name: string }> {
    if (/^\d+$/.test(value.trim())) return { id: value.trim(), name: value.trim() };
    const resolved = resolveByName('rubro', value, await lookups.rubros());
    log.info(`rubro "${value}" resolved to idEspecie ${resolved.id} (${resolved.name}).`);
    return resolved;
}

export async function resolveSubrubro(
    value: string,
    idEspecie: string,
    lookups: LookupClient,
): Promise<{ id: string; name: string }> {
    if (/^\d+$/.test(value.trim())) return { id: value.trim(), name: value.trim() };
    const resolved = resolveByName('subrubro', value, await lookups.subrubros(idEspecie));
    log.info(`subrubro "${value}" resolved to idFamilia ${resolved.id} (${resolved.name}).`);
    return resolved;
}
