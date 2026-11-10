// Downloads the model files once, checks them byte for byte (SHA-256) and
// keeps them in the browser's Cache Storage, so later runs work offline.
// The picture never leaves the computer: only the model comes from the net.

import { AiError } from './errors';
import { MODELS, type ModelFile, type UpscaleModel } from './models';

const CACHE = 'coverfold-ai-models-v1';

export type DownloadProgress = (loaded: number, total: number) => void;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

const cacheAvailable = () => typeof caches !== 'undefined';

async function openCache(): Promise<Cache | null> {
  if (!cacheAvailable()) return null;
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // e.g. private windows in some browsers: download every time
  }
}

async function fetchFile(f: ModelFile, signal: AbortSignal | undefined, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(f.url, { signal, cache: 'no-store' });
  } catch (e) {
    if (signal?.aborted) throw new AiError('aborted');
    throw new AiError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'network', String(e));
  }
  if (!res.ok || !res.body) throw new AiError('network', `HTTP ${res.status}`);
  const reader = res.body.getReader();
  const buf = new Uint8Array(f.bytes);
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > buf.length) throw new AiError('integrity', 'file larger than expected');
      buf.set(value, got);
      got += value.length;
      onBytes(value.length);
    }
  } catch (e) {
    if (signal?.aborted) throw new AiError('aborted');
    if (e instanceof AiError) throw e;
    throw new AiError('network', String(e));
  }
  if (got !== f.bytes) throw new AiError('integrity', `got ${got} bytes, expected ${f.bytes}`);
  const sum = hex(await crypto.subtle.digest('SHA-256', buf));
  if (sum !== f.sha256) throw new AiError('integrity', 'checksum mismatch');
  return buf.buffer;
}

/** A stored copy, checked like a download: a damaged one is dropped (and downloaded again). */
async function cached(cache: Cache | null, f: ModelFile): Promise<ArrayBuffer | null> {
  if (!cache) return null;
  const hit = await cache.match(f.url);
  if (!hit) return null;
  const b = await hit.arrayBuffer();
  if (b.byteLength === f.bytes && hex(await crypto.subtle.digest('SHA-256', b)) === f.sha256) return b;
  await cache.delete(f.url);
  return null;
}

export interface ModelFiles { param: string; bin: ArrayBuffer }

/**
 * The model's files, from the cache or downloaded (progress in bytes over
 * both files). A file that fails its check is downloaded once more.
 */
export async function getModelFiles(m: UpscaleModel, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<ModelFiles> {
  const cache = await openCache();
  const files = [m.param, m.bin];
  const have = await Promise.all(files.map((f) => cached(cache, f)));
  const missing = files.filter((_, i) => !have[i]);
  const total = missing.reduce((s, f) => s + f.bytes, 0);
  let loaded = 0;
  if (total) onProgress?.(0, total);
  const out: ArrayBuffer[] = [];
  for (let i = 0; i < files.length; i++) {
    if (have[i]) { out.push(have[i]!); continue; }
    const f = files[i];
    const start = loaded;
    let buf: ArrayBuffer;
    try {
      buf = await fetchFile(f, signal, (n) => { loaded += n; onProgress?.(loaded, total); });
    } catch (e) {
      if (!(e instanceof AiError) || e.code !== 'integrity') throw e;
      loaded = start;
      buf = await fetchFile(f, signal, (n) => { loaded += n; onProgress?.(loaded, total); });
    }
    if (cache) {
      try {
        await cache.put(f.url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } }));
      } catch (e) {
        // Not stored (disk full): works now, downloads again next time.
        console.warn('AI model not cached', e);
      }
    }
    out.push(buf);
  }
  return { param: new TextDecoder().decode(out[0]), bin: out[1] };
}

export async function downloadedModels(): Promise<Set<string>> {
  const out = new Set<string>();
  const cache = await openCache();
  if (!cache) return out;
  const keys = new Set((await cache.keys()).map((r) => r.url));
  for (const m of MODELS) if (keys.has(m.param.url) && keys.has(m.bin.url)) out.add(m.id);
  return out;
}

/** Without ids, removes every model. */
export async function deleteModels(ids?: string[]): Promise<void> {
  if (!cacheAvailable()) return;
  if (!ids) { await caches.delete(CACHE); return; }
  const cache = await openCache();
  if (!cache) return;
  for (const m of MODELS.filter((x) => ids.includes(x.id))) {
    await cache.delete(m.param.url);
    await cache.delete(m.bin.url);
  }
}
