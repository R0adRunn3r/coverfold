// Fetch helpers for busy public servers (MusicBrainz, Cover Art Archive),
// which often answer 502/503 or drop the connection: retries with growing
// waits the UI can show, and downloads that give up when a connection stalls.

/** An error status, after the retries when the server was busy. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly service: string) {
    super(`${service} ${status}`);
  }
  /** Overloaded or rate limiting: worth trying again later. */
  get busy(): boolean { return RETRY_STATUS.has(this.status); }
}

/** No answer: offline, blocked, or a server too busy to send CORS headers. */
export class NetworkError extends Error {
  constructor(readonly service: string) {
    super(`${service}: no answer`);
  }
}

export const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** A retry about to happen, shown as "trying again in N s (attempt 2 of 4)". */
export interface RetryInfo {
  attempt: number;
  of: number;
  waitMs: number;
  /** HTTP status of the failed try, null when there was no answer. */
  status: number | null;
}

export interface RetryOptions {
  service: string;
  signal?: AbortSignal;
  /** Tries in all (default 4). */
  attempts?: number;
  /** First wait (ms); doubles at each retry. */
  baseMs?: number;
  /** Runs before every try (rate limiting). */
  before?: () => Promise<void>;
  onRetry?: (info: RetryInfo) => void;
}

const abortError = (signal: AbortSignal) => signal.reason ?? new DOMException('Aborted', 'AbortError');

/** Rejects as soon as the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => { clearTimeout(id); reject(abortError(signal!)); };
    const id = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wait before retry `n` (1-based): the server's Retry-After (seconds, at most
 * 30), else base * 2^(n-1) with some jitter so clients do not all return at once.
 */
export function retryDelay(n: number, retryAfter: string | null, baseMs = 1500, random = Math.random): number {
  const s = retryAfter !== null && retryAfter.trim() !== '' ? Number(retryAfter) : NaN;
  if (Number.isFinite(s) && s >= 0) return Math.min(30_000, Math.max(baseMs, s * 1000));
  return Math.round(baseMs * 2 ** (n - 1) * (0.85 + random() * 0.3));
}

/**
 * fetch that retries when the server is busy (429/5xx) or does not answer.
 * Other responses (200, 404, ...) are returned as is; after the last try it
 * throws HttpError or NetworkError.
 */
export async function fetchRetry(url: string, init: RequestInit, o: RetryOptions): Promise<Response> {
  const attempts = Math.max(1, o.attempts ?? 4);
  for (let n = 1; ; n++) {
    await o.before?.();
    let status: number | null = null;
    let retryAfter: string | null = null;
    try {
      const r = await fetch(url, { ...init, signal: o.signal });
      if (!RETRY_STATUS.has(r.status)) return r;
      status = r.status;
      retryAfter = r.headers.get('Retry-After');
      void r.body?.cancel().catch(() => {});
    } catch (e) {
      if (o.signal?.aborted) throw e;
      // A TypeError is a failed connection; anything else is a bug: let it through.
      if (!(e instanceof TypeError)) throw e;
    }
    if (n >= attempts) throw status === null ? new NetworkError(o.service) : new HttpError(status, o.service);
    const waitMs = retryDelay(n, retryAfter, o.baseMs);
    o.onRetry?.({ attempt: n + 1, of: attempts, waitMs, status });
    await sleep(waitMs, o.signal);
  }
}

/** In bytes; `total` is null when the server does not send the size. */
export interface Progress { loaded: number; total: number | null }

export class StalledError extends Error {
  constructor(readonly service: string) {
    super(`${service}: download stalled`);
  }
}

/** A connection silent for `stallMs` is dropped with StalledError, so a stuck download cannot freeze the import. */
export async function downloadBlob(url: string, o: RetryOptions & { onProgress?: (p: Progress) => void; stallMs?: number }): Promise<Blob> {
  const r = await fetchRetry(url, {}, o);
  if (!r.ok) throw new HttpError(r.status, o.service);
  const type = r.headers.get('Content-Type') ?? '';
  const total = Number(r.headers.get('Content-Length')) || null;
  o.onProgress?.({ loaded: 0, total });
  if (!r.body) return r.blob();
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const stallMs = o.stallMs ?? 30_000;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StalledError(o.service)), stallMs); });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), stalled]);
      } finally {
        clearTimeout(timer);
      }
      if (chunk.done) break;
      chunks.push(chunk.value);
      loaded += chunk.value.length;
      o.onProgress?.({ loaded, total });
    }
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e;
  }
  return new Blob(chunks as BlobPart[], { type });
}
