async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// Native fetch(), no proxy needed - verified live 2026-09-04: reachable
// from a plain datacenter IP, unlike pba-tenders-monitor's and
// cordoba-compras-monitor's targets.
export async function fetchWithRetry(url: string, maxRetries = 4, baseDelayMs = 1000): Promise<Response> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, { redirect: 'follow' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt);
            }
        }
    }
    throw lastError;
}
