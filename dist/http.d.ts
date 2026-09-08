export declare class HttpError extends Error {
    readonly status: number;
    readonly url: string;
    constructor(status: number, url: string);
}
export interface FetchOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
}
export declare function absoluteUrl(path: string): string;
/**
 * GET a site path and return the body. Retries with jittered exponential
 * backoff on network errors, timeouts, 408/425/429 and 5xx only. Other 4xx
 * are deterministic and surface immediately as HttpError so the caller can
 * decide (fail the run vs. degrade one record). Note the API answers an
 * invalid `sort` value with an EMPTY 500 (live-verified) - that is retried
 * as a 5xx and then fails the run, which is the right outcome for a site
 * change.
 */
export declare function fetchWithRetry(path: string, options?: FetchOptions): Promise<string>;
/** Like fetchWithRetry but resolves to null when the resource is gone (404/410). */
export declare function fetchOptional(path: string, options?: FetchOptions): Promise<string | null>;
/**
 * Run `fn` over `items` with at most `concurrency` calls in flight, preserving
 * input order in the result. Errors propagate after in-flight calls settle.
 */
export declare function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
//# sourceMappingURL=http.d.ts.map