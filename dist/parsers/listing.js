function toCount(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
/**
 * Parse and validate a `consultas.getContrataciones` response. Live-verified
 * shape (2026-09-08): `{success:true, errors:{reason:""}, data:[...],
 * type:"1", totalRecords:"78", extraData:{apTotal:"78", etTotal:"2214",
 * coTotal:"28921"}}`; every row carries a numeric-string `idGestion`.
 */
export function parseListingResponse(body) {
    const notListing = { isListingPage: false, items: [], totalRecords: null, totals: null, reason: null };
    let raw;
    try {
        raw = JSON.parse(body);
    }
    catch {
        return notListing;
    }
    if (!raw || typeof raw !== 'object')
        return notListing;
    const reason = typeof raw.errors?.reason === 'string' && raw.errors.reason ? raw.errors.reason : null;
    if (raw.success !== true || !Array.isArray(raw.data))
        return { ...notListing, reason };
    const extra = raw.extraData;
    if (!extra || typeof extra !== 'object')
        return { ...notListing, reason };
    const totals = {
        AP: toCount(extra.apTotal),
        ET: toCount(extra.etTotal),
        CO: toCount(extra.coTotal),
    };
    if (totals.AP === null || totals.ET === null || totals.CO === null)
        return { ...notListing, reason };
    const items = [];
    for (const row of raw.data) {
        if (!row || typeof row !== 'object')
            return { ...notListing, reason };
        const item = row;
        if (typeof item.idGestion !== 'string' || !/^\d+$/.test(item.idGestion))
            return { ...notListing, reason };
        items.push(item);
    }
    return {
        isListingPage: true,
        items,
        totalRecords: toCount(raw.totalRecords),
        totals: totals,
        reason,
    };
}
//# sourceMappingURL=listing.js.map