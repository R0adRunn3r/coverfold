// What AI enlargement can do for a picture of the project: its print resolution
// where it is used and the 2x, 3x and 4x options within the DPI and memory limits.

import type { Project } from './model';
import { layerDpi } from './preflight';
import { allLayers } from './faces';

/** Below this the picture list suggests enlarging (and highlights the button). */
export const ENHANCE_BELOW_DPI = 300;
/** The finest print setting: pixels beyond it would be thrown away. */
export const MAX_AI_DPI = 1200;
/** The enlargement proposed first gets the picture to about the default print resolution. */
export const TARGET_DPI = 600;
/** The enlarged picture may hold at most this many pixels (browser memory). */
export const MAX_AI_PIXELS = 36_000_000;

export const MULTIPLIERS = [2, 3, 4] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];

/** Lowest print resolution of a picture in the project (its biggest use), or null when unused. */
export function assetDpi(project: Project, assetId: string): number | null {
  let worst: number | null = null;
  for (const piece of project.pieces) {
    for (const l of allLayers(piece)) {
      if (l.type !== 'image' || l.assetId !== assetId) continue;
      const dpi = layerDpi(l);
      if (dpi !== null && (worst === null || dpi < worst)) worst = dpi;
    }
  }
  return worst;
}

export function assetUseCount(project: Project, assetId: string): number {
  let n = 0;
  for (const piece of project.pieces) for (const l of allLayers(piece)) if (l.type === 'image' && l.assetId === assetId) n++;
  return n;
}

export interface MultiplierOption {
  m: Multiplier;
  w: number;
  h: number;
  /** Print resolution of the biggest use afterwards (null when unused). */
  dpi: number | null;
  ok: boolean;
  /** Why it is not offered. */
  reason?: 'dpiCap' | 'pixelCap';
}

export function multiplierOptions(size: { width: number; height: number }, dpi: number | null): MultiplierOption[] {
  return MULTIPLIERS.map((m) => {
    const after = dpi === null ? null : dpi * m;
    const opt: MultiplierOption = { m, w: size.width * m, h: size.height * m, dpi: after, ok: true };
    if (after !== null && after > MAX_AI_DPI) return { ...opt, ok: false, reason: 'dpiCap' };
    if (opt.w * opt.h > MAX_AI_PIXELS) return { ...opt, ok: false, reason: 'pixelCap' };
    return opt;
  });
}

/** The enlargement offered first: the smallest reaching TARGET_DPI, else the largest allowed. */
export function defaultMultiplier(options: MultiplierOption[]): Multiplier | null {
  const ok = options.filter((o) => o.ok);
  if (!ok.length) return null;
  return (ok.find((o) => o.dpi !== null && o.dpi >= TARGET_DPI) ?? ok[ok.length - 1]).m;
}

/** File name of an enlarged copy: the original base name, the model and the factor, as PNG. */
export function enhancedName(original: string, model: string, m: number): string {
  const base = original.replace(/\.[a-z0-9]{2,5}$/i, '');
  return `${base} (${model} ${m}x).png`;
}
