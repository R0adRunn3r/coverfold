import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, fetchRetry, HttpError, NetworkError, retryDelay, StalledError, type RetryInfo } from './net';

/** fetch stub answering from a script: a status, a Response, or 'offline'. */
function scripted(steps: (number | Response | 'offline')[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const step = steps.shift();
    if (step === undefined) throw new Error('unexpected call');
    if (step === 'offline') throw new TypeError('Failed to fetch');
    return step instanceof Response ? step : new Response(step === 200 ? '{"ok":true}' : 'busy', { status: step });
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('retryDelay', () => {
  it('doubles from the base, with a little jitter', () => {
    expect(retryDelay(1, null, 1000, () => 0.5)).toBe(1000);
    expect(retryDelay(2, null, 1000, () => 0.5)).toBe(2000);
    expect(retryDelay(3, null, 1000, () => 0.5)).toBe(4000);
    expect(retryDelay(1, null, 1000, () => 0)).toBe(850);
    expect(retryDelay(1, null, 1000, () => 1)).toBe(1150);
  });

  it('follows Retry-After, within limits', () => {
    expect(retryDelay(1, '3', 1000)).toBe(3000);
    expect(retryDelay(1, '0', 1000)).toBe(1000);
    expect(retryDelay(1, '600', 1000)).toBe(30_000);
    expect(retryDelay(1, 'soon', 1000, () => 0.5)).toBe(1000);
  });
});

describe('fetchRetry', () => {
  it('retries busy answers and dropped connections, then returns the answer', async () => {
    const calls = scripted([503, 'offline', 502, 200]);
    const retries: RetryInfo[] = [];
    const r = await fetchRetry('https://x/a', {}, { service: 'Test', baseMs: 1, onRetry: (i) => retries.push(i) });
    expect(await r.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
    expect(retries.map((i) => [i.attempt, i.of, i.status])).toEqual([[2, 4, 503], [3, 4, null], [4, 4, 502]]);
  });

  it('does not retry a plain error such as 404', async () => {
    const calls = scripted([404]);
    const r = await fetchRetry('https://x/a', {}, { service: 'Test', baseMs: 1 });
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the last try with the kind of failure', async () => {
    scripted([503, 503, 503]);
    const busy = await fetchRetry('https://x/a', {}, { service: 'Test', baseMs: 1, attempts: 3 }).catch((e) => e);
    expect(busy).toBeInstanceOf(HttpError);
    expect(busy).toMatchObject({ status: 503, service: 'Test', busy: true });

    scripted(['offline', 'offline']);
    const offline = await fetchRetry('https://x/a', {}, { service: 'Test', baseMs: 1, attempts: 2 }).catch((e) => e);
    expect(offline).toBeInstanceOf(NetworkError);
  });

  it('waits its turn before every try', async () => {
    scripted([503, 200]);
    const before = vi.fn(async () => {});
    await fetchRetry('https://x/a', {}, { service: 'Test', baseMs: 1, before });
    expect(before).toHaveBeenCalledTimes(2);
  });

  it('stops waiting as soon as it is cancelled', async () => {
    scripted([503, 200]);
    const ctl = new AbortController();
    const p = fetchRetry('https://x/a', {}, { service: 'Test', baseMs: 60_000, signal: ctl.signal, onRetry: () => ctl.abort() });
    await expect(p).rejects.toThrow();
  });
});

describe('downloadBlob', () => {
  const stream = (parts: Uint8Array[], hangAfter = Infinity) => new ReadableStream<Uint8Array>({
    start(c) {
      parts.slice(0, hangAfter).forEach((p) => c.enqueue(p));
      if (hangAfter >= parts.length) c.close();
    },
  });

  it('reports progress against the announced size', async () => {
    scripted([new Response(stream([new Uint8Array(3), new Uint8Array(5)]), { headers: { 'Content-Length': '8', 'Content-Type': 'image/jpeg' } })]);
    const seen: [number, number | null][] = [];
    const blob = await downloadBlob('https://x/a.jpg', { service: 'Test', onProgress: (p) => seen.push([p.loaded, p.total]) });
    expect(blob.size).toBe(8);
    expect(blob.type).toBe('image/jpeg');
    expect(seen).toEqual([[0, 8], [3, 8], [8, 8]]);
  });

  it('drops a download that stops sending data', async () => {
    scripted([new Response(stream([new Uint8Array(4), new Uint8Array(4)], 1))]);
    await expect(downloadBlob('https://x/a.jpg', { service: 'Test', stallMs: 20 })).rejects.toBeInstanceOf(StalledError);
  });

  it('fails on an error answer', async () => {
    scripted([404]);
    await expect(downloadBlob('https://x/a.jpg', { service: 'Test' })).rejects.toMatchObject({ status: 404 });
  });
});
