import { log } from 'apify';
import { BASE_URL } from './urls.js';
// santafe.gov.ar needs no User-Agent, cookie, proxy or JS (verified live
// 2026-09-08: a bare request with an empty User-Agent gets HTTP 200). A
// browser UA is sent anyway so a future header-based WAF, like the one
// GrantConnect grew, does not silently break the actor.
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
};
export class HttpError extends Error {
    status;
    url;
    constructor(status, url) {
        super(`HTTP ${status} for ${url}`);
        this.status = status;
        this.url = url;
        this.name = 'HttpError';
    }
}
const DEFAULTS = {
    maxRetries: 4,
    baseDelayMs: 1000,
    // A 2,000-row listing page answers in ~3 s and a detail page in ~0.1-0.3 s;
    // 45 s leaves room for a slow Apache moment without hanging the run.
    timeoutMs: 45_000,
};
export function absoluteUrl(path) {
    return new URL(path, BASE_URL).href;
}
async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function isRetriableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
/**
 * GET a site path and return the body. Retries with jittered exponential
 * backoff on network errors, timeouts, 408/425/429 and 5xx only. Other 4xx
 * are deterministic and surface immediately as HttpError so the caller can
 * decide (fail the run vs. degrade one record). Note the API answers an
 * invalid `sort` value with an EMPTY 500 (live-verified) - that is retried
 * as a 5xx and then fails the run, which is the right outcome for a site
 * change.
 */
export async function fetchWithRetry(path, options = {}) {
    const { maxRetries, baseDelayMs, timeoutMs } = { ...DEFAULTS, ...options };
    const url = absoluteUrl(path);
    let lastError = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: BROWSER_HEADERS,
                redirect: 'follow',
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok)
                return await response.text();
            if (!isRetriableStatus(response.status))
                throw new HttpError(response.status, url);
            lastError = new HttpError(response.status, url);
        }
        catch (error) {
            if (error instanceof HttpError && !isRetriableStatus(error.status))
                throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
            log.debug(`Retrying ${url} in ${delay}ms after: ${lastError.message}`);
            await sleep(delay);
        }
    }
    throw lastError;
}
/** Like fetchWithRetry but resolves to null when the resource is gone (404/410). */
export async function fetchOptional(path, options = {}) {
    try {
        return await fetchWithRetry(path, options);
    }
    catch (error) {
        if (error instanceof HttpError && (error.status === 404 || error.status === 410))
            return null;
        throw error;
    }
}
/**
 * Run `fn` over `items` with at most `concurrency` calls in flight, preserving
 * input order in the result. Errors propagate after in-flight calls settle.
 */
export async function mapWithConcurrency(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;
    let firstError = null;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (next < items.length && firstError === null) {
            const index = next++;
            try {
                results[index] = await fn(items[index], index);
            }
            catch (error) {
                firstError ??= error;
            }
        }
    });
    await Promise.all(workers);
    if (firstError !== null)
        throw firstError;
    return results;
}
//# sourceMappingURL=http.js.map