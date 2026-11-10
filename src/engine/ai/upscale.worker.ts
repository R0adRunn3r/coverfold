// AI upscaling worker: converts the model to ONNX and runs it tile by tile
// with onnxruntime-web (WebGPU, or the CPU when there is none). Finished
// tiles are posted back so the UI can show the result filling in.

import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web/webgpu';
import { AiError, encodeAiError } from './errors';
import { getModel, type ModelId } from './models';
import { getModelFiles } from './modelStore';
import { parseParam } from './ncnn';
import { ncnnToOnnx, type Precision } from './onnxGraph';
import { copyRegion, planTiles, readTile, tileToRgba, writeTile, type TileData } from './tiles';
import { CPU_TILE, GPU_TILE, TILE_PAD, type Backend, type Prepared, type Probe, type StageFn, type TileDone, type TileFn, type Upscaled } from './types';

// GitHub Pages cannot send the headers that unlock threads: one CPU thread.
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

let probed: Probe | null = null;
let session: ort.InferenceSession | null = null;
let loaded: { key: string; input: string; output: string; scale: number; prepared: Prepared } | null = null;
let abort: AbortController | null = null;

async function probe(): Promise<Probe> {
  if (probed) return probed;
  let out: Probe = { webgpu: false, f16: false, adapter: '' };
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string>; info?: { vendor?: string; architecture?: string; description?: string } } | null> } }).gpu;
    const a = await gpu?.requestAdapter();
    if (a) out = { webgpu: true, f16: a.features.has('shader-f16'), adapter: [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join(' ') };
  } catch {
    // no WebGPU
  }
  probed = out;
  return out;
}

async function release() {
  const s = session;
  session = null;
  loaded = null;
  await s?.release().catch(() => undefined);
}

function signal(): AbortSignal {
  abort = new AbortController();
  return abort.signal;
}

const checkAborted = (s: AbortSignal) => { if (s.aborted) throw new AiError('aborted'); };

const api = {
  probe,

  /** Downloads and converts the model if needed and opens a session for `tile`-pixel tiles. */
  async prepare(id: ModelId, opts: { cpu?: boolean; tile?: number }, onStage?: StageFn): Promise<Prepared> {
    const sig = signal();
    try {
      const p = await probe();
      const backend: Backend = p.webgpu && !opts.cpu ? 'webgpu' : 'wasm';
      const precision: Precision = backend === 'webgpu' && p.f16 ? 'f16' : 'f32';
      const tile = opts.tile ?? (backend === 'webgpu' ? GPU_TILE : CPU_TILE);
      const key = `${id}|${backend}|${precision}|${tile}`;
      if (loaded?.key === key && session) return loaded.prepared;
      await release();
      const m = getModel(id);
      const files = await getModelFiles(m, (l, t) => { if (onStage) notify(onStage, { stage: 'download', loaded: l, total: t }); }, sig);
      checkAborted(sig);
      if (onStage) notify(onStage, { stage: 'prepare' });
      const conv = ncnnToOnnx(parseParam(files.param), files.bin, precision);
      const n = tile + 2 * TILE_PAD;
      session = await ort.InferenceSession.create(conv.bytes, {
        executionProviders: [backend],
        graphOptimizationLevel: 'all',
        // One fixed tile shape: compiled once, memory known in advance.
        freeDimensionOverrides: { h: n, w: n },
      });
      checkAborted(sig);
      const prepared = { backend, precision, tile };
      loaded = { key, input: conv.input, output: conv.output, scale: conv.scale, prepared };
      return prepared;
    } catch (e) {
      throw encodeAiError(sig.aborted ? new AiError('aborted') : e);
    }
  },

  /**
   * Enlarges `m` times, up to the network's scale. Below it, each tile is
   * reduced with its margin as soon as it is done (no seams), so only the
   * final picture is held in memory.
   */
  async upscale(picture: ImageBitmap, m: number, onStage?: StageFn, onTile?: TileFn): Promise<Upscaled> {
    const sig = signal();
    const t0 = performance.now();
    try {
      if (!session || !loaded) throw new AiError('internal', 'model not prepared');
      const { input, output, scale, prepared } = loaded;
      if (!Number.isInteger(m) || m < 1 || m > scale) throw new AiError('internal', `enlargement ${m}x`);
      const w = picture.width, h = picture.height;
      const W = w * m, H = h * m;
      let out: Uint8ClampedArray<ArrayBuffer>;
      try {
        out = new Uint8ClampedArray(W * H * 4);
      } catch {
        throw new AiError('memory', `${W}x${H}`);
      }
      const src = pixelsOf(picture);
      picture.close();
      const hasAlpha = alphaUsed(src);
      const tiles = planTiles(w, h, prepared.tile);
      const n = prepared.tile + 2 * TILE_PAD;
      const half = prepared.precision === 'f16';
      const reduce = m < scale ? reducer(n * scale, n * m) : null;
      if (onStage) notify(onStage, { stage: 'tiles', done: 0, total: tiles.length });
      for (let i = 0; i < tiles.length; i++) {
        checkAborted(sig);
        const t = tiles[i];
        const x = readTile(src, w, h, t, prepared.tile, TILE_PAD, half);
        const res = await session.run({ [input]: new ort.Tensor(half ? 'float16' : 'float32', x, [1, 3, n, n]) });
        const y = res[output];
        if (!reduce) writeTile(out, W, y.data as TileData, t, prepared.tile, TILE_PAD, scale);
        else copyRegion(reduce(tileToRgba(y.data as TileData, n * scale)), n * m, TILE_PAD * m, TILE_PAD * m, t.w * m, t.h * m, out, W, t.x * m, t.y * m);
        y.dispose();
        if (onTile) {
          const done = tileOf(out, W, t, m);
          notify(onTile, Comlink.transfer(done, [done.pixels.buffer]));
        }
        if (onStage) notify(onStage, { stage: 'tiles', done: i + 1, total: tiles.length });
      }
      checkAborted(sig);
      // The networks see colour only: alpha is enlarged with plain smoothing.
      if (hasAlpha) applyAlpha(out, W, H, src, w, h);
      const blob = await encodePng(out, W, H);
      return { blob, width: W, height: H, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      throw encodeAiError(sig.aborted ? new AiError('aborted') : e);
    }
  },

  /** Takes effect at the next download chunk or tile. */
  cancel() {
    abort?.abort();
  },

  release,
};

export type UpscaleWorkerApi = typeof api;

/** Fire-and-forget call to a Comlink-proxied UI callback; a closed page is not an error. */
function notify<T>(fn: (v: T) => void, v: T) {
  try {
    const r = fn(v) as unknown;
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    // the page went away
  }
}

function pixelsOf(b: ImageBitmap): Uint8ClampedArray {
  const c = new OffscreenCanvas(b.width, b.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(b, 0, 0);
  return ctx.getImageData(0, 0, b.width, b.height).data;
}

function alphaUsed(p: Uint8ClampedArray): boolean {
  for (let i = 3; i < p.length; i += 4) if (p[i] !== 255) return true;
  return false;
}

function tileOf(big: Uint8ClampedArray, W: number, t: { x: number; y: number; w: number; h: number }, s: number): TileDone {
  const x = t.x * s, y = t.y * s, w = t.w * s, h = t.h * s;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) pixels.set(big.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4);
  return { x, y, w, h, pixels };
}

function applyAlpha(big: Uint8ClampedArray, W: number, H: number, src: Uint8ClampedArray, w: number, h: number) {
  const a = new OffscreenCanvas(w, h);
  const actx = a.getContext('2d')!;
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = src[i * 4 + 3]; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  actx.putImageData(img, 0, 0);
  const b = new OffscreenCanvas(W, H);
  const bctx = b.getContext('2d', { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(a, 0, 0, W, H);
  const up = bctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) big[i * 4 + 3] = up[i * 4];
}

/** Downscales square RGBA tiles from `from` to `to` pixels a side. */
function reducer(from: number, to: number): (rgba: Uint8ClampedArray<ArrayBuffer>) => Uint8ClampedArray<ArrayBuffer> {
  const a = new OffscreenCanvas(from, from);
  const actx = a.getContext('2d')!;
  const b = new OffscreenCanvas(to, to);
  const bctx = b.getContext('2d', { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = 'high';
  return (rgba) => {
    actx.putImageData(new ImageData(rgba, from, from), 0, 0);
    bctx.clearRect(0, 0, to, to);
    bctx.drawImage(a, 0, 0, to, to);
    return bctx.getImageData(0, 0, to, to).data;
  };
}

async function encodePng(px: Uint8ClampedArray<ArrayBuffer>, W: number, H: number): Promise<Blob> {
  const c = new OffscreenCanvas(W, H);
  c.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

Comlink.expose(api);
