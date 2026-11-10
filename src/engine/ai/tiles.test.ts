import { describe, expect, it } from 'vitest';
import { copyRegion, mirror, planTiles, readTile, tileToRgba, writeTile } from './tiles';

const picture = (w: number, h: number) => {
  const p = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { p[i * 4] = (i * 7) % 256; p[i * 4 + 1] = (i * 13) % 256; p[i * 4 + 2] = (i * 29) % 256; p[i * 4 + 3] = 255; }
  return p;
};

/** A stand-in network: enlarges a CHW input s times by repeating pixels. */
function fakeNet(x: Float32Array, n: number, s: number): Float32Array {
  const N = n * s;
  const out = new Float32Array(3 * N * N);
  for (let c = 0; c < 3; c++) for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) out[(c * N + y) * N + xx] = x[(c * n + Math.floor(y / s)) * n + Math.floor(xx / s)];
  return out;
}

describe('tiles', () => {
  it('covers the picture exactly, row by row', () => {
    const t = planTiles(500, 130, 192);
    expect(t).toEqual([
      { x: 0, y: 0, w: 192, h: 130 }, { x: 192, y: 0, w: 192, h: 130 }, { x: 384, y: 0, w: 116, h: 130 },
    ]);
    expect(planTiles(10, 10, 192)).toHaveLength(1);
  });

  it('mirrors outside the picture without repeating the edge', () => {
    expect([-2, -1, 0, 1, 4, 5, 6].map((i) => mirror(i, 5))).toEqual([2, 1, 0, 1, 4, 3, 2]);
    expect(mirror(-3, 1)).toBe(0);
  });

  it('gives back the same picture through a network that only enlarges, tile seams included', () => {
    for (const s of [1, 2, 4]) {
      const w = 37, h = 23, size = 16, pad = 4;
      const src = picture(w, h);
      const out = new Uint8ClampedArray(w * s * h * s * 4);
      for (const t of planTiles(w, h, size)) {
        const x = readTile(src, w, h, t, size, pad) as Float32Array;
        writeTile(out, w * s, fakeNet(x, size + 2 * pad, s), t, size, pad, s);
      }
      for (let y = 0; y < h * s; y += 3) for (let x = 0; x < w * s; x += 3) {
        const a = ((Math.floor(y / s) * w + Math.floor(x / s)) * 4), b = (y * w * s + x) * 4;
        expect([out[b], out[b + 1], out[b + 2], out[b + 3]]).toEqual([src[a], src[a + 1], src[a + 2], 255]);
      }
    }
  });

  it('reads half floats when asked, and turns them back into the same bytes', () => {
    const w = 9, h = 7, size = 12, pad = 2;
    const src = picture(w, h);
    const t = planTiles(w, h, size)[0];
    const half = readTile(src, w, h, t, size, pad, true);
    expect(half).toBeInstanceOf(Uint16Array);
    const rgba = tileToRgba(half, size + 2 * pad);
    const back = new Uint8ClampedArray(w * h * 4);
    copyRegion(rgba, size + 2 * pad, pad, pad, t.w, t.h, back, w, 0, 0);
    expect(Array.from(back)).toEqual(Array.from(src));
  });
});
