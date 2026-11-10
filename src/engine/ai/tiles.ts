// Tiling for running an upscaler on any picture size. Each tile is a fixed
// square (one compiled shape, bounded GPU memory) plus a margin of picture,
// and only the middle of each result is kept, so there are no seams.
// Outside the picture the margin mirrors it, without repeating the edge pixel.

import { floatToHalf, halfToFloat } from './ncnn';

export interface Tile { x: number; y: number; w: number; h: number }

/** Row by row; tiles on the right and bottom edges may be smaller. */
export function planTiles(w: number, h: number, size: number): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) out.push({ x, y, w: Math.min(size, w - x), h: Math.min(size, h - y) });
  return out;
}

/** Mirrors a coordinate into 0..n-1 without repeating the edge pixel (... 2 1 | 0 1 2 ... n-1 | n-2 ...). */
export function mirror(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let k = ((i % period) + period) % period;
  if (k >= n) k = period - k;
  return k;
}

export type TileData = Float32Array | Uint16Array;

/** Network input for a tile: a (size + 2*pad) square of RGB in 0-1, CHW. */
export function readTile(rgba: Uint8ClampedArray, w: number, h: number, t: Tile, size: number, pad: number, half = false): TileData {
  const n = size + 2 * pad;
  const plane = n * n;
  const out = half ? new Uint16Array(3 * plane) : new Float32Array(3 * plane);
  const xs = new Int32Array(n);
  for (let i = 0; i < n; i++) xs[i] = mirror(t.x - pad + i, w);
  for (let j = 0; j < n; j++) {
    const row = mirror(t.y - pad + j, h) * w;
    for (let i = 0; i < n; i++) {
      const s = (row + xs[i]) * 4;
      const d = j * n + i;
      if (half) {
        out[d] = HALF_OF_BYTE[rgba[s]];
        out[plane + d] = HALF_OF_BYTE[rgba[s + 1]];
        out[2 * plane + d] = HALF_OF_BYTE[rgba[s + 2]];
      } else {
        out[d] = rgba[s] / 255;
        out[plane + d] = rgba[s + 1] / 255;
        out[2 * plane + d] = rgba[s + 2] / 255;
      }
    }
  }
  return out;
}

const HALF_OF_BYTE = Uint16Array.from({ length: 256 }, (_, v) => floatToHalf(v / 255));

let halfToByte: Uint8Array | null = null;
/** Lookup table: half float to 0-255, rounded and clamped. */
function halfBytes(): Uint8Array {
  if (!halfToByte) {
    halfToByte = new Uint8Array(65536);
    for (let i = 0; i < 65536; i++) {
      const v = halfToFloat(i) * 255;
      halfToByte[i] = Number.isNaN(v) ? 0 : Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return halfToByte;
}

/** A whole n x n CHW network output as opaque RGBA. */
export function tileToRgba(y: TileData, n: number): Uint8ClampedArray<ArrayBuffer> {
  const plane = n * n;
  const out = new Uint8ClampedArray(plane * 4);
  const lut = y instanceof Uint16Array ? halfBytes() : null;
  for (let i = 0; i < plane; i++) {
    const d = i * 4;
    if (lut) {
      out[d] = lut[y[i]];
      out[d + 1] = lut[y[plane + i]];
      out[d + 2] = lut[y[2 * plane + i]];
    } else {
      out[d] = y[i] * 255;
      out[d + 1] = y[plane + i] * 255;
      out[d + 2] = y[2 * plane + i] * 255;
    }
    out[d + 3] = 255;
  }
  return out;
}

export function copyRegion(src: Uint8ClampedArray, srcW: number, sx: number, sy: number, w: number, h: number, dst: Uint8ClampedArray, dstW: number, dx: number, dy: number): void {
  for (let j = 0; j < h; j++) {
    const s = ((sy + j) * srcW + sx) * 4;
    dst.set(src.subarray(s, s + w * 4), ((dy + j) * dstW + dx) * 4);
  }
}

/** Copies the middle of a CHW output ((size + 2*pad)*scale square) into the opaque RGBA result, W pixels wide. */
export function writeTile(out: Uint8ClampedArray, W: number, y: TileData, t: Tile, size: number, pad: number, scale: number): void {
  const n = (size + 2 * pad) * scale;
  const plane = n * n;
  const o = pad * scale;
  const tw = t.w * scale, th = t.h * scale;
  const ox = t.x * scale, oy = t.y * scale;
  const lut = y instanceof Uint16Array ? halfBytes() : null;
  for (let j = 0; j < th; j++) {
    const srcRow = (o + j) * n + o;
    const dstRow = ((oy + j) * W + ox) * 4;
    for (let i = 0; i < tw; i++) {
      const s = srcRow + i, d = dstRow + i * 4;
      if (lut) {
        out[d] = lut[y[s]];
        out[d + 1] = lut[y[plane + s]];
        out[d + 2] = lut[y[2 * plane + s]];
      } else {
        // Uint8ClampedArray rounds and clamps.
        out[d] = y[s] * 255;
        out[d + 1] = y[plane + s] * 255;
        out[d + 2] = y[2 * plane + s] * 255;
      }
      out[d + 3] = 255;
    }
  }
}
