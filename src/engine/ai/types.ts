// Shapes shared by the AI worker and the page (kept apart so importing them
// never pulls onnxruntime into the main bundle).

import type { Precision } from './onnxGraph';

export type Backend = 'webgpu' | 'wasm';

export interface Probe { webgpu: boolean; f16: boolean; adapter: string }

export interface Prepared { backend: Backend; precision: Precision; tile: number }

export type Stage =
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'prepare' }
  | { stage: 'tiles'; done: number; total: number };

export type StageFn = (s: Stage) => void;

/** A finished tile, in output pixels. */
export interface TileDone { x: number; y: number; w: number; h: number; pixels: Uint8ClampedArray }
export type TileFn = (t: TileDone) => void;

export interface Upscaled { blob: Blob; width: number; height: number; ms: number }

/** Margin around each tile, in input pixels. */
export const TILE_PAD = 16;
/** Tile sides in input pixels, without the margin: GPU, GPU retry, CPU. */
export const GPU_TILE = 192, GPU_TILE_SMALL = 96, CPU_TILE = 64;
