// Main-thread side of the AI upscaler: one worker, one job at a time.
// Cancelling asks the worker to stop at the next tile; if it does not answer
// quickly (a long CPU tile) the worker is terminated.

import * as Comlink from 'comlink';
import { loadOriginal } from '../assets';
import { AiError, toAiError } from './errors';
import type { ModelId } from './models';
import type { UpscaleWorkerApi } from './upscale.worker';
import { GPU_TILE_SMALL, type Prepared, type Probe, type StageFn, type TileFn, type Upscaled } from './types';

export type { Prepared, Probe, Stage, TileDone, Upscaled } from './types';

let worker: Worker | null = null;
let remote: Comlink.Remote<UpscaleWorkerApi> | null = null;

function api(): Comlink.Remote<UpscaleWorkerApi> {
  if (!remote) {
    worker = new Worker(new URL('./upscale.worker.ts', import.meta.url), { type: 'module', name: 'coverfold-ai' });
    remote = Comlink.wrap<UpscaleWorkerApi>(worker);
  }
  return remote;
}

function terminate() {
  worker?.terminate();
  worker = null;
  remote = null;
}

let probe: Promise<Probe> | null = null;
export function probeAi(): Promise<Probe> {
  probe ??= api().probe().catch(() => ({ webgpu: false, f16: false, adapter: '' }));
  return probe;
}

export interface JobOptions {
  assetId: string;
  model: ModelId;
  /** 2, 3 or 4: the networks work at 4x and each tile is reduced below that. */
  scale: number;
  /** Use the CPU even when WebGPU is available. */
  cpu?: boolean;
}

export interface Job {
  result: Promise<Upscaled & { prepared: Prepared }>;
  cancel(): void;
}

export function startUpscale(o: JobOptions, onStage: StageFn, onTile?: TileFn): Job {
  let cancelled = false;
  let rejectNow: ((e: AiError) => void) | null = null;
  const stop = new Promise<never>((_, reject) => { rejectNow = reject; });
  stop.catch(() => undefined);

  const run = async () => {
    const w = api();
    const stageProxy = Comlink.proxy(onStage);
    const tileProxy = onTile ? Comlink.proxy(onTile) : undefined;
    const original = await loadOriginal(o.assetId);
    if (!original) throw new AiError('internal', 'picture not found');
    try {
      const attempt = async (tile?: number) => {
        const prepared = await w.prepare(o.model, { cpu: o.cpu, tile }, stageProxy);
        if (cancelled) throw new AiError('aborted');
        const copy = await createImageBitmap(original);
        const res = await w.upscale(Comlink.transfer(copy, [copy]), o.scale, stageProxy, tileProxy);
        return { ...res, prepared };
      };
      try {
        return await attempt();
      } catch (e) {
        const err = toAiError(e);
        // The GPU failed on big tiles: retry once with small ones.
        if (err.code !== 'gpu' || cancelled || o.cpu) throw err;
        return await attempt(GPU_TILE_SMALL);
      }
    } catch (e) {
      throw toAiError(e);
    } finally {
      original.close();
    }
  };

  const result = Promise.race([run(), stop]);
  return {
    result,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      remote?.cancel().catch(() => undefined);
      // A CPU tile can take a while: do not wait for it.
      const timer = setTimeout(() => { terminate(); rejectNow?.(new AiError('aborted')); }, 1500);
      result.finally(() => clearTimeout(timer)).catch(() => undefined);
    },
  };
}

/** Frees the worker's model, e.g. when the dialog closes. */
export function releaseAi(): void {
  remote?.release().catch(() => undefined);
}
