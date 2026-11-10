import { describe, expect, it } from 'vitest';
import { cropOf } from './crop';
import { panelBleedRect, panelSafeRect } from './layout';
import { makeFillLayer, makeImageLayer, makePiece, makeProject, makeTextLayer, type ImageLayer } from './model';
import { filledMode, fitPatch, movePatch, visibleCrop } from './placement';
import { activeLayers, createEditor } from './store';
import { buildDieline } from './templates/catalog';

const BLEED = 3;

/**
 * Picture point (0-1) seen at a point of the sheet, following the layer's
 * transform the way the renderer draws it: turn around the box centre,
 * mirror inside the box, then the crop.
 */
function pictureAt(l: ImageLayer, x: number, y: number): { u: number; v: number } {
  const a = (-l.rotation * Math.PI) / 180;
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  const lx = l.w / 2 + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
  const ly = l.h / 2 + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
  let s = lx / l.w, t = ly / l.h;
  if (l.flipX) s = 1 - s;
  if (l.flipY) t = 1 - t;
  const c = cropOf(l);
  return { u: c.x + c.w * s, v: c.y + c.h * t };
}

/** The two layers show the same picture point everywhere inside `r`. */
function expectSamePicture(a: ImageLayer, b: ImageLayer, r: { x: number; y: number; w: number; h: number }) {
  for (const [fx, fy] of [[0.05, 0.05], [0.95, 0.1], [0.5, 0.5], [0.2, 0.9], [0.9, 0.95]]) {
    const x = r.x + r.w * fx, y = r.y + r.h * fy;
    const pa = pictureAt(a, x, y), pb = pictureAt(b, x, y);
    expect(pb.u).toBeCloseTo(pa.u, 4);
    expect(pb.v).toBeCloseTo(pa.v, 4);
  }
}

describe('placement on panels', () => {
  const booklet = buildDieline('jewel.booklet4', {});
  const front = booklet.panels.find((p) => p.id === 'front')!;
  const back = booklet.panels.find((p) => p.id === 'back')!;

  it('fills a panel with a box that is the panel plus bleed, the picture cropped to it', () => {
    const img = makeImageLayer('a', 'a', 2000, 1000, { x: 0, y: 0, w: 10, h: 5 });
    const l = { ...img, ...fitPatch(img, front, 'cover-bleed', BLEED, { centre: true }) } as ImageLayer;
    expect(l).toMatchObject({ ...panelBleedRect(front, BLEED), clip: null, rotation: 0 });
    // Same proportions as the box, centred in the picture.
    const c = cropOf(l);
    expect((c.w * 2000) / (c.h * 1000)).toBeCloseTo(l.w / l.h, 6);
    expect(c.x + c.w / 2).toBeCloseTo(0.5);
    expect(c.h).toBeCloseTo(1);
    expect(filledMode(l, front, BLEED)).toBe('cover-bleed');
    expect(filledMode(l, back, BLEED)).toBeNull();
  });

  it('turns the picture on an upside-down panel', () => {
    const ocard = buildDieline('jewel.ocard', {});
    const upside = ocard.panels.find((p) => p.id === 'back')!;
    const img = makeImageLayer('a', 'a', 1000, 1000, { x: 0, y: 0, w: 10, h: 10 });
    expect(fitPatch(img, upside, 'cover-bleed', BLEED)).toMatchObject({ rotation: 180, ...panelBleedRect(upside, BLEED) });
  });

  it('fits a picture whole inside the safe area', () => {
    const img = makeImageLayer('a', 'a', 2000, 1000, { x: 0, y: 0, w: 10, h: 5 });
    const p = fitPatch(img, front, 'contain-safe', BLEED);
    const safe = panelSafeRect(front);
    expect(p.w).toBeCloseTo(safe.w);
    expect(p.h).toBeCloseTo(safe.w / 2);
  });

  it('keeps a shaped picture its shape', () => {
    const img = { ...makeImageLayer('a', 'a', 1000, 1000, { x: 0, y: 0, w: 30, h: 30 }), mask: { shape: 'ellipse' as const, radius: 0 } };
    const p = fitPatch(img, front, 'cover-bleed', BLEED);
    expect(p.w).toBeCloseTo(p.h!);
  });

  it('gives backgrounds and shapes the panel box', () => {
    const fill = makeFillLayer('#000', { x: 0, y: 0, w: 5, h: 5 });
    expect(fitPatch(fill, back, 'cover-bleed', BLEED)).toMatchObject(panelBleedRect(back, BLEED));
    expect(filledMode({ ...fill, ...panelBleedRect(back, BLEED) }, back, BLEED)).toBe('cover-bleed');
  });

  it('moves a filling picture onto another panel, keeping zoom and pan', () => {
    const img = makeImageLayer('a', 'a', 3000, 1000, { x: 0, y: 0, w: 10, h: 5 });
    const on = { ...img, ...fitPatch(img, front, 'cover-bleed', BLEED, { centre: true }) } as ImageLayer;
    const moved = { ...on, ...movePatch(on, front, back, BLEED) } as ImageLayer;
    expect(moved).toMatchObject(panelBleedRect(back, BLEED));
    expect(filledMode(moved, back, BLEED)).toBe('cover-bleed');
  });

  it('moves anything else keeping its place within the panel', () => {
    const text = makeTextLayer('x', { x: front.rect.x + 10, y: front.rect.y + 20, w: 30, h: 8 });
    const p = movePatch(text, front, back, BLEED);
    expect(p.x).toBeCloseTo(back.rect.x + 10);
    expect(p.y).toBeCloseTo(back.rect.y + 20);
    // Onto an upside-down panel the place is mirrored and the text turned.
    const ocard = buildDieline('jewel.ocard', {});
    const f = ocard.panels.find((x) => x.id === 'front')!, u = ocard.panels.find((x) => x.id === 'back')!;
    const t2 = makeTextLayer('x', { x: f.rect.x + 10, y: f.rect.y + 10, w: 20, h: 6 });
    const q = movePatch(t2, f, u, BLEED);
    expect(q.rotation).toBe(180);
    // Its far corner lands 10 mm from the panel's far corner.
    expect(q.x! + 20).toBeCloseTo(u.rect.x + u.rect.w - 10);
    expect(q.y! + 6).toBeCloseTo(u.rect.y + u.rect.h - 10);
  });
});

describe('older clipped pictures', () => {
  const booklet = buildDieline('jewel.booklet4', {});
  const front = booklet.panels.find((p) => p.id === 'front')!;
  const back = booklet.panels.find((p) => p.id === 'back')!;
  const bleedRect = panelBleedRect(front, BLEED);

  /** An oversized picture moved off-centre and clipped to the front, as older versions made them. */
  const legacy = (rotation: number, flipX: boolean, flipY: boolean): ImageLayer => {
    const h = bleedRect.h + 20, w = h * 2;
    return {
      ...makeImageLayer('a', 'a', 2000, 1000, { x: bleedRect.x - 70, y: bleedRect.y - 12, w, h }),
      rotation, flipX, flipY, clip: { panelId: 'front' },
    };
  };

  it('count as filling their panel', () => {
    expect(filledMode(legacy(0, false, false), front, BLEED)).toBe('cover-bleed');
    expect(filledMode({ ...legacy(0, false, false), clip: null }, front, BLEED)).toBeNull();
  });

  for (const rotation of [0, 180]) {
    for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]]) {
      it(`keep exactly what showed when fitted (turn ${rotation}, mirror ${fx}/${fy})`, () => {
        const old = legacy(rotation, fx, fy);
        const now = { ...old, ...fitPatch(old, front, 'cover-bleed', BLEED, { from: front }), rotation } as ImageLayer;
        expect(now.clip).toBeNull();
        expect(now).toMatchObject(bleedRect);
        expectSamePicture(old, now, bleedRect);
      });
    }
  }

  it('crop the visible part of a quarter-turned picture', () => {
    const l = legacy(0, false, false);
    // Centred on the panel, so that turned it still covers it.
    const old = { ...l, rotation: 90, x: bleedRect.x + bleedRect.w / 2 - l.w / 2, y: bleedRect.y + bleedRect.h / 2 - l.h / 2 };
    const v = visibleCrop(old, bleedRect);
    // Turned a quarter, the sheet's width runs along the picture's height.
    expect(v.w).toBeCloseTo(bleedRect.h);
    expect(v.h).toBeCloseTo(bleedRect.w);
  });

  it('show the same part on the new panel when moved', () => {
    const old = legacy(0, false, false);
    const moved = { ...old, ...movePatch(old, front, back, BLEED) } as ImageLayer;
    expect(moved.clip).toBeNull();
    const shifted = { ...moved, x: moved.x + (front.rect.x - back.rect.x) };
    // The back has the same size here: same picture, one panel to the left.
    expect(panelBleedRect(back, BLEED).w).toBeCloseTo(bleedRect.w);
    expectSamePicture(old, { ...shifted, x: bleedRect.x }, bleedRect);
  });
});

describe('store placement', () => {
  const editor = () => {
    const ed = createEditor();
    ed.load(makeProject('t', 'jewel', [makePiece('jewel.booklet4'), makePiece('jewel.tray')]));
    return ed;
  };

  it('moves a layer to another panel in one undo step', () => {
    const ed = editor();
    ed.placeImage({ id: 'img', name: 'img', width: 1000, height: 1000 }, 'front');
    const id = activeLayers(ed.store.getState())[0].id;
    ed.moveToPanel(id, 'back');
    const d = buildDieline('jewel.booklet4', {});
    expect(activeLayers(ed.store.getState())[0]).toMatchObject(panelBleedRect(d.panels.find((p) => p.id === 'back')!, 3));
    ed.undo();
    expect(activeLayers(ed.store.getState())[0]).toMatchObject(panelBleedRect(d.panels.find((p) => p.id === 'front')!, 3));
  });

  it('adds to another piece without changing what is open, and batches into one undo step', () => {
    const ed = editor();
    const s0 = ed.store.getState();
    const tray = s0.project!.pieces[1];
    ed.batch(() => {
      ed.placeImage({ id: 'a', name: 'a', width: 1000, height: 1000 }, 'front');
      ed.placeImage({ id: 'b', name: 'b', width: 1000, height: 1000 }, 'back', undefined, { pieceId: tray.id, side: 'outside' });
      ed.addLayer(makeTextLayer('x', { x: 0, y: 0, w: 5, h: 5 }), false, { pieceId: tray.id, side: 'outside' });
      ed.rename('Album');
    });
    const s1 = ed.store.getState();
    expect(s1.selection.pieceId).toBe(s0.selection.pieceId);
    expect(s1.project!.pieces[1].layers.outside).toHaveLength(2);
    expect(s1.project!.assetIds).toEqual(['a', 'b']);
    expect(s1.past).toHaveLength(1);
    ed.undo();
    expect(ed.store.getState().project!.pieces[1].layers.outside ?? []).toHaveLength(0);
    expect(ed.store.getState().project!.name).toBe('t');
  });

  it('swaps the picture of a filling image, filling the panel again', () => {
    const ed = editor();
    ed.placeImage({ id: 'a', name: 'a', width: 1000, height: 1000 }, 'front');
    const id = activeLayers(ed.store.getState())[0].id;
    ed.replaceImage(id, { id: 'b', name: 'b', width: 3000, height: 1000 });
    const l = activeLayers(ed.store.getState())[0] as ImageLayer;
    const d = buildDieline('jewel.booklet4', {});
    expect(l).toMatchObject({ assetId: 'b', ...panelBleedRect(d.panels.find((p) => p.id === 'front')!, 3) });
    expect((cropOf(l).w * 3000) / (cropOf(l).h * 1000)).toBeCloseTo(l.w / l.h, 6);
  });

  it('replaces a picture everywhere with its enhanced copy, in one undo step', () => {
    const ed = editor();
    ed.addAssets(['x']);
    ed.placeImage({ id: 'a', name: 'a', width: 600, height: 400 }, 'front');
    ed.placeImage({ id: 'a', name: 'a', width: 600, height: 400 }, 'back');
    const [l1, l2] = activeLayers(ed.store.getState()) as ImageLayer[];
    ed.updateLayer(l1.id, { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } });
    const before = activeLayers(ed.store.getState()) as ImageLayer[];
    ed.replaceAsset('a', { id: 'a4', width: 2400, height: 1600 });
    const p = ed.store.getState().project!;
    // Same place in the picture list, the original gone from it.
    expect(p.assetIds).toEqual(['x', 'a4']);
    const after = activeLayers(ed.store.getState()) as ImageLayer[];
    for (const [i, l] of after.entries()) {
      expect(l).toMatchObject({ assetId: 'a4', naturalW: 2400, naturalH: 1600, x: before[i].x, y: before[i].y, w: before[i].w, h: before[i].h, crop: before[i].crop, name: before[i].name });
    }
    expect([l1.id, l2.id]).toEqual(after.map((l) => l.id));
    ed.undo();
    expect(ed.store.getState().project!.assetIds).toEqual(['x', 'a']);
    expect((activeLayers(ed.store.getState()) as ImageLayer[]).every((l) => l.assetId === 'a' && l.naturalW === 600)).toBe(true);
  });

  it('keeps box and crop when the same picture comes back bigger (e.g. from an upscaler)', () => {
    const ed = editor();
    ed.placeImage({ id: 'a', name: 'a', width: 600, height: 400 }, 'front');
    const id = activeLayers(ed.store.getState())[0].id;
    // A hand-made crop and a box that does not fill the panel.
    ed.updateLayer(id, { x: 20, y: 30, w: 50, h: 40, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, rotation: 7 });
    const before = activeLayers(ed.store.getState())[0] as ImageLayer;
    // 4x and 3x (a pixel short) both keep it.
    for (const [w, h] of [[2400, 1600], [1800, 1199]]) {
      ed.replaceImage(id, { id: `up${w}`, name: 'up', width: w, height: h });
      const l = activeLayers(ed.store.getState())[0] as ImageLayer;
      expect(l).toMatchObject({ assetId: `up${w}`, naturalW: w, naturalH: h, x: 20, y: 30, w: 50, h: 40, rotation: 7, crop: before.crop });
    }
  });
});
