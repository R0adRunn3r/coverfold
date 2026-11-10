import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, encodeAiError, toAiError } from './errors';
import type { UpscaleModel } from './models';
import { getModelFiles } from './modelStore';

const hex = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

async function fakeModel(): Promise<{ model: UpscaleModel; files: Record<string, Uint8Array<ArrayBuffer>> }> {
  const param = enc.encode('7767517\n0 0\n');
  const bin = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) % 256);
  const model = {
    id: 'lite', nameKey: '', descKey: '', scale: 4, heavy: false, nonCommercial: false, license: '', credit: '', creditUrl: '',
    param: { url: 'https://example.test/x.param', sha256: await hex(param), bytes: param.length },
    bin: { url: 'https://example.test/x.bin', sha256: await hex(bin), bytes: bin.length },
  } as UpscaleModel;
  return { model, files: { [model.param.url]: param, [model.bin.url]: bin } };
}

/** A Response streaming the bytes in a few chunks (so progress moves). */
const stream = (b: Uint8Array<ArrayBuffer>) => new Response(new ReadableStream({
  start(c) { for (let i = 0; i < b.length; i += 1500) c.enqueue(b.slice(i, i + 1500)); c.close(); },
}));

afterEach(() => vi.unstubAllGlobals());

describe('model download', () => {
  it('downloads both files, checks them and reports progress in bytes', async () => {
    const { model, files } = await fakeModel();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => stream(files[url])));
    const seen: [number, number][] = [];
    const got = await getModelFiles(model, (l, t) => seen.push([l, t]));
    expect(got.param.startsWith('7767517')).toBe(true);
    expect(new Uint8Array(got.bin)).toEqual(files[model.bin.url]);
    const total = model.param.bytes + model.bin.bytes;
    expect(seen[0]).toEqual([0, total]);
    expect(seen.at(-1)).toEqual([total, total]);
  });

  it('downloads a damaged file once more, and gives up if it is still wrong', async () => {
    const { model, files } = await fakeModel();
    const bad = files[model.bin.url].slice();
    bad[10] ^= 0xff;
    let binCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === model.bin.url && binCalls++ === 0 ? stream(bad) : stream(files[url]))));
    await expect(getModelFiles(model)).resolves.toBeTruthy();
    expect(binCalls).toBe(2);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => stream(url === model.bin.url ? bad : files[url])));
    await expect(getModelFiles(model)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('tells offline from a failed download, and stops when asked', async () => {
    const { model } = await fakeModel();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(getModelFiles(model)).rejects.toMatchObject({ code: 'network' });
    vi.stubGlobal('navigator', { onLine: false });
    await expect(getModelFiles(model)).rejects.toMatchObject({ code: 'offline' });
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(getModelFiles(model)).rejects.toMatchObject({ code: 'network' });
    const ctl = new AbortController();
    ctl.abort();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o: RequestInit) => { if (o.signal?.aborted) throw new DOMException('stop', 'AbortError'); return new Response(''); }));
    await expect(getModelFiles(model, undefined, ctl.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('AI errors', () => {
  it('cross the worker boundary with their code', () => {
    for (const code of ['offline', 'gpu', 'memory', 'internal'] as const) {
      const back = toAiError(encodeAiError(new AiError(code, 'detail here')));
      expect(back.code).toBe(code);
      expect(back.message).toBe('detail here');
    }
    expect(toAiError(new Error('Failed to allocate GPUBuffer: device lost')).code).toBe('gpu');
    expect(toAiError(new RangeError('Array buffer allocation failed')).code).toBe('memory');
    expect(toAiError(new DOMException('x', 'AbortError')).code).toBe('aborted');
  });
});
