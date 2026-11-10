import { describe, expect, it } from 'vitest';
import { makeImageLayer, makePiece, makeProject } from './model';
import { assetDpi, assetUseCount, defaultMultiplier, enhancedName, MAX_AI_PIXELS, multiplierOptions } from './upscalePlan';

// 25.4 mm wide = one inch: the DPI is the pixel count.
const project = () => {
  const piece = makePiece('jewel.booklet1', {});
  piece.layers.outside.push(makeImageLayer('a', 'a.jpg', 300, 300, { x: 0, y: 0, w: 25.4, h: 25.4 }));
  piece.layers.outside.push(makeImageLayer('a', 'a.jpg', 300, 300, { x: 0, y: 0, w: 50.8, h: 50.8 }));
  piece.layers.outside.push(makeImageLayer('b', 'b.jpg', 1000, 1000, { x: 0, y: 0, w: 25.4, h: 25.4 }));
  return makeProject('t', 'jewel', [piece]);
};

describe('AI enlargement plan', () => {
  it('rates a picture by its biggest use', () => {
    const p = project();
    expect(assetDpi(p, 'a')).toBeCloseTo(150, 5);
    expect(assetUseCount(p, 'a')).toBe(2);
    expect(assetDpi(p, 'missing')).toBeNull();
  });

  it('never goes beyond 1200 DPI, and proposes ~600 DPI first', () => {
    const at150 = multiplierOptions({ width: 300, height: 300 }, 150);
    expect(at150.map((o) => [o.m, o.ok, o.dpi])).toEqual([[2, true, 300], [3, true, 450], [4, true, 600]]);
    expect(defaultMultiplier(at150)).toBe(4);
    const at350 = multiplierOptions({ width: 900, height: 900 }, 350);
    expect(at350.map((o) => o.ok)).toEqual([true, true, false]);
    expect(at350[2].reason).toBe('dpiCap');
    expect(defaultMultiplier(at350)).toBe(2);
    // Already sharp: nothing on offer.
    const at700 = multiplierOptions({ width: 2000, height: 2000 }, 700);
    expect(at700.every((o) => !o.ok)).toBe(true);
    expect(defaultMultiplier(at700)).toBeNull();
  });

  it('keeps the result within the browser memory budget', () => {
    const side = Math.floor(Math.sqrt(MAX_AI_PIXELS) / 3) + 10;
    const o = multiplierOptions({ width: side, height: side }, null);
    expect(o.map((x) => x.ok)).toEqual([true, false, false]);
    expect(o[1].reason).toBe('pixelCap');
    // Unused pictures: no DPI, the largest allowed is proposed.
    expect(defaultMultiplier(multiplierOptions({ width: 400, height: 300 }, null))).toBe(4);
  });

  it('names the enlarged copy after the original, model and enlargement', () => {
    expect(enhancedName('cover.jpg', 'Ultramix', 4)).toBe('cover (Ultramix 4x).png');
    expect(enhancedName('scan', 'Lite', 2)).toBe('scan (Lite 2x).png');
  });
});
