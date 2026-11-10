import { describe, expect, it } from 'vitest';
import { aspectPatch, cropOf, cropSide, maxCropSize } from './crop';
import { makeImageLayer, type ImageLayer } from './model';

/** A 2000 x 1000 px picture shown whole in a 100 x 50 mm box. */
const pic = (patch: Partial<ImageLayer> = {}): ImageLayer => ({ ...makeImageLayer('a', 'a', 2000, 1000, { x: 10, y: 20, w: 100, h: 50 }), ...patch });
/** Picture pixels per mm across: what cropping must keep. */
const scaleX = (l: Pick<ImageLayer, 'crop' | 'naturalW' | 'w'>) => (cropOf(l).w * l.naturalW) / l.w;

describe('cropping by the sides', () => {
  it('shows less of the picture at the same scale', () => {
    const l = pic();
    const r = cropSide(l, 'right', 80);
    expect(r.size).toBe(80);
    expect(r.crop).toMatchObject({ x: 0, w: 0.8, y: 0, h: 1 });
    expect(scaleX({ ...l, w: r.size, crop: r.crop })).toBeCloseTo(scaleX(l));
  });

  it('keeps the other side fixed', () => {
    const l = { ...pic(), w: 80, crop: { x: 0, y: 0, w: 0.8, h: 1 } };
    const r = cropSide(l, 'left', 60);
    expect(r.crop.x).toBeCloseTo(0.2);
    expect(r.crop.x + r.crop.w).toBeCloseTo(0.8);
  });

  it('stops where the picture ends', () => {
    expect(cropSide(pic(), 'right', 130).size).toBe(100);
    const cropped = { ...pic(), w: 80, crop: { x: 0, y: 0, w: 0.8, h: 1 } };
    expect(maxCropSize(cropped, 'right')).toBeCloseTo(100);
    expect(maxCropSize(cropped, 'left')).toBeCloseTo(80);
    expect(cropSide(pic(), 'top', 0.2).size).toBe(1);
  });

  it('follows a mirrored picture the other way', () => {
    // Mirrored: the box's right side shows the picture's left edge.
    const r = cropSide(pic({ flipX: true }), 'right', 80);
    expect(r.crop.x).toBeCloseTo(0.2);
    expect(r.crop.w).toBeCloseTo(0.8);
    const v = cropSide(pic({ flipY: true }), 'top', 25);
    expect(v.crop).toMatchObject({ y: 0, h: 0.5 });
  });
});

describe('proportions', () => {
  it('reshapes around the same centre at the same scale, inside the picture', () => {
    const l = pic();
    const p = aspectPatch(l, 1);
    expect(p.w).toBeCloseTo(50);
    expect(p.h).toBeCloseTo(50);
    expect(p.x! + p.w! / 2).toBeCloseTo(60);
    expect(p.crop).toMatchObject({ y: 0, h: 1 });
    expect(p.crop!.x).toBeCloseTo(0.25);
    expect(scaleX({ ...l, ...p } as ImageLayer)).toBeCloseTo(scaleX(l));
  });

  it('keeps about the same size when there is picture to show', () => {
    const zoomed = { ...pic(), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
    const p = aspectPatch(zoomed, 1);
    expect(p.w! * p.h!).toBeCloseTo(5000);
    expect(p.crop!.x + p.crop!.w / 2).toBeCloseTo(0.5);
  });

  it('goes back to the whole picture', () => {
    const p = aspectPatch({ ...pic(), w: 50, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }, null);
    expect(p.crop).toBeNull();
    expect(p.w! / p.h!).toBeCloseTo(2);
  });
});
