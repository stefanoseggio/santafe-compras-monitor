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
/** Live client with a per-run cache (each list is fetched at most once). */
export declare function liveLookups(): LookupClient;
/**
 * Resolve an input value to an id: a numeric string is taken as the id
 * itself; anything else is matched against the list by name, accent- and
 * case-insensitively - an exact match wins, otherwise a unique substring
 * match; ambiguity or no match is an InputError that lists the options.
 */
export declare function resolveByName(field: string, value: string, entries: LookupEntry[]): {
    id: string;
    name: string;
};
export declare function resolveOrganismo(field: string, value: string, lookups: LookupClient): Promise<{
    id: string;
    name: string;
}>;
export declare function resolveRubro(value: string, lookups: LookupClient): Promise<{
    id: string;
    name: string;
}>;
export declare function resolveSubrubro(value: string, idEspecie: string, lookups: LookupClient): Promise<{
    id: string;
    name: string;
}>;
//# sourceMappingURL=lookups.d.ts.map