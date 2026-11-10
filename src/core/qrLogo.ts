// A logo in the middle of a QR code. Only modules under the logo's opaque parts
// (plus a small gap) are left out. Level H can repair 30% of the code, and the
// codewords the logo spoils are counted exactly, block by block.
import type { Rect } from './geometry';
import type { Footprint, QrLogo } from './model';
import type { QrMatrix } from './qr';
import { qrLayout } from './qrSpec';

/** Gap left between the logo and the modules around it (modules). */
export const QR_LOGO_GAP = 0.5;
/**
 * Share of each block's repair capacity the logo may use. The rest is left for
 * smudges, scratches, folds and blurry phone cameras.
 */
export const QR_LOGO_MAX_DAMAGE = 0.6;
/** Slider range and default for the logo size (share of the code's side). */
export const QR_LOGO_MIN_SIZE = 0.1;
export const QR_LOGO_MAX_SIZE = 0.4;
export const QR_LOGO_DEFAULT_SIZE = 0.25;
/** Above this size the inspector suggests trying the printed code with a phone. */
export const QR_LOGO_TEST_SIZE = 0.2;
/** Footprint grid: cells on the longer side. */
export const FOOTPRINT_CELLS = 64;

/** Packs a row-major 0/1 grid into a footprint. */
export function packFootprint(w: number, h: number, cells: ArrayLike<number>): Footprint {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) if (cells[i]) bytes[i >> 3] |= 1 << (i & 7);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { w, h, bits: btoa(bin) };
}

const unpacked = new Map<string, Uint8Array>();

/** Row-major 0/1 grid of a footprint (cached). */
export function unpackFootprint(f: Footprint): Uint8Array {
  const key = `${f.w}x${f.h}:${f.bits}`;
  const hit = unpacked.get(key);
  if (hit) return hit;
  const bin = atob(f.bits);
  const out = new Uint8Array(f.w * f.h);
  for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  if (unpacked.size > 32) unpacked.clear();
  unpacked.set(key, out);
  return out;
}

/** Share of a footprint's cells that are opaque (1 = a picture without transparency). */
export function footprintCoverage(f: Footprint): number {
  const cells = unpackFootprint(f);
  return cells.reduce((s, x) => s + x, 0) / cells.length;
}

/** A fully opaque footprint (pictures without transparency, or before the real one is known). */
export function solidFootprint(naturalW: number, naturalH: number): Footprint {
  const k = FOOTPRINT_CELLS / Math.max(naturalW, naturalH);
  const w = Math.max(1, Math.round(naturalW * k)), h = Math.max(1, Math.round(naturalH * k));
  return packFootprint(w, h, new Uint8Array(w * h).fill(1));
}

export interface QrLogoPlan {
  /** The logo picture, in modules from the top-left module. */
  rect: Rect;
  /** 1 = module left out (under the logo or in the gap around it). */
  cleared: Uint8Array;
  /**
   * Largest share of a block's repair capacity the logo uses: above 1 the
   * code cannot be read even when perfectly printed.
   */
  damage: number;
  /** The logo covers a pattern readers need to find the code. */
  hitsPattern: boolean;
}

/** The logo's picture, centred, its longer side `size` times the code's side (modules). */
export function qrLogoRect(modules: number, logo: Pick<QrLogo, 'size' | 'naturalW' | 'naturalH'>): Rect {
  const long = logo.size * modules;
  const aspect = logo.naturalW / logo.naturalH;
  const w = aspect >= 1 ? long : long * aspect;
  const h = aspect >= 1 ? long / aspect : long;
  return { x: (modules - w) / 2, y: (modules - h) / 2, w, h };
}

const plans = new WeakMap<QrMatrix, Map<string, QrLogoPlan>>();

/** Which modules a logo takes away and how much that costs (cached per code and logo). */
export function qrLogoPlan(m: QrMatrix, logo: QrLogo): QrLogoPlan {
  let byLogo = plans.get(m);
  if (!byLogo) plans.set(m, (byLogo = new Map()));
  const key = `${logo.size}|${logo.naturalW}x${logo.naturalH}|${logo.footprint.w}x${logo.footprint.h}:${logo.footprint.bits}`;
  const hit = byLogo.get(key);
  if (hit) return hit;

  const n = m.size;
  const rect = qrLogoRect(n, logo);
  const fp = logo.footprint;
  const cells = unpackFootprint(fp);
  const cw = rect.w / fp.w, ch = rect.h / fp.h;
  const under = new Uint8Array(n * n);
  const cleared = new Uint8Array(n * n);
  const EPS = 1e-6;
  const markRange = (target: Uint8Array, x0: number, y0: number, x1: number, y1: number) => {
    const c0 = Math.max(0, Math.floor(x0 + EPS)), c1 = Math.min(n - 1, Math.ceil(x1 - EPS) - 1);
    const r0 = Math.max(0, Math.floor(y0 + EPS)), r1 = Math.min(n - 1, Math.ceil(y1 - EPS) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) target[r * n + c] = 1;
  };
  for (let j = 0; j < fp.h; j++) {
    for (let i = 0; i < fp.w; i++) {
      if (!cells[j * fp.w + i]) continue;
      const x0 = rect.x + i * cw, y0 = rect.y + j * ch;
      markRange(under, x0, y0, x0 + cw, y0 + ch);
      markRange(cleared, x0 - QR_LOGO_GAP, y0 - QR_LOGO_GAP, x0 + cw + QR_LOGO_GAP, y0 + ch + QR_LOGO_GAP);
    }
  }

  // A codeword is spoilt when any of its modules lies under the picture (a
  // reader may see it either way, whatever the logo's colours) or is a dark
  // module turned light in the gap.
  const layout = qrLayout(m.version);
  const spoilt = new Uint8Array(layout.block.length);
  let hitsPattern = false;
  for (let k = 0; k < n * n; k++) {
    if (!cleared[k]) continue;
    if (layout.vital[k]) hitsPattern = true;
    const cwi = layout.codeword[k];
    if (cwi >= 0 && (under[k] || m.dark[k])) spoilt[cwi] = 1;
  }
  const perBlock = new Array<number>(layout.blocks).fill(0);
  spoilt.forEach((s, i) => { if (s) perBlock[layout.block[i]]++; });
  const damage = Math.max(...perBlock) / layout.capacity;

  const plan = { rect, cleared, damage, hitsPattern };
  byLogo.set(key, plan);
  return plan;
}

/** The logo is small enough for phones to still read the code. */
export const logoFits = (p: QrLogoPlan) => !p.hitsPattern && p.damage <= QR_LOGO_MAX_DAMAGE;
