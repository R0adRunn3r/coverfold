import { describe, expect, it } from 'vitest';
import { bleedShapePath } from './bleedShape';
import { applyMatrix, flattenPath, pathBBox } from './geometry';
import { makeFillLayer, makePiece, makeProject, makeTextLayer } from './model';
import { preflight } from './preflight';
import { buildPrintPlan, placementMatrix, type PrintStrings, type SheetPage } from './printPlan';
import { activeLayers, createEditor } from './store';
import { buildDieline } from './templates/catalog';

const STRINGS: PrintStrings = {
  sheetLabel: '{n}/{total}', front: 'f', back: 'b',
  paper: { paper: 'p', cardstock: 'c', sticker: 's' },
  pieceName: {}, assembly: {},
  instructionsTitle: '', sheetsHeading: '', sheetLine: '', generalHeading: '', general: [], rulerCaption: '', rulerCaptionShort: '',
  partName: '{name} {n}/{total}', joinHeading: '{name}', joinSteps: [],
};

function editorWithBooklet() {
  const ed = createEditor();
  ed.load(makeProject('t', 'jewel', [makePiece('jewel.booklet4'), makePiece('jewel.tray')]));
  return ed;
}

describe('editor store', () => {
  it('adds, undoes and redoes layers', () => {
    const ed = editorWithBooklet();
    ed.addLayer(makeFillLayer('#f00', { x: 0, y: 0, w: 10, h: 10 }));
    expect(activeLayers(ed.store.getState())).toHaveLength(1);
    ed.undo();
    expect(activeLayers(ed.store.getState())).toHaveLength(0);
    ed.redo();
    expect(activeLayers(ed.store.getState())).toHaveLength(1);
  });

  it('coalesces rapid edits with the same key into one undo step', () => {
    const ed = editorWithBooklet();
    const l = makeFillLayer('#f00', { x: 0, y: 0, w: 10, h: 10 });
    ed.addLayer(l);
    for (let i = 1; i <= 5; i++) ed.updateLayer(l.id, { opacity: 1 - i / 10 }, 'opacity');
    ed.undo();
    expect(activeLayers(ed.store.getState())[0].opacity).toBe(1);
  });

  it('arranges z-order', () => {
    const ed = editorWithBooklet();
    const a = makeFillLayer('#a00', { x: 0, y: 0, w: 1, h: 1 });
    const b = makeFillLayer('#0a0', { x: 0, y: 0, w: 1, h: 1 });
    const c = makeFillLayer('#00a', { x: 0, y: 0, w: 1, h: 1 });
    ed.addLayer(a); ed.addLayer(b); ed.addLayer(c);
    ed.arrange([a.id], 'front');
    expect(activeLayers(ed.store.getState()).map((l) => l.id)).toEqual([b.id, c.id, a.id]);
    ed.arrange([a.id], 'backward');
    expect(activeLayers(ed.store.getState()).map((l) => l.id)).toEqual([b.id, a.id, c.id]);
    ed.reorder(c.id, 0);
    expect(activeLayers(ed.store.getState()).map((l) => l.id)).toEqual([c.id, b.id, a.id]);
  });

  it('places an image filling the panel plus bleed, framed inside it (no clip)', () => {
    const ed = editorWithBooklet();
    ed.placeImage({ id: 'img', name: 'img', width: 2000, height: 1000 }, 'front');
    const l = activeLayers(ed.store.getState())[0];
    expect(l.clip).toBeNull();
    expect(l).toMatchObject({ x: 120, y: -3, h: 126 });
    expect(l.w).toBeCloseTo(123);
    expect(ed.store.getState().project!.assetIds).toEqual(['img']);
  });
});

describe('bleed shape', () => {
  it('grows rectangles by the bleed', () => {
    const bb = pathBBox(bleedShapePath(buildDieline('jewel.tray', {}), 3));
    expect(bb).toMatchObject({ x: -3, y: -3 });
    expect(bb.w).toBeCloseTo(157);
    expect(bb.h).toBeCloseTo(124);
  });

  it('grows the disc and shrinks its hole', () => {
    const polys = flattenPath(bleedShapePath(buildDieline('disc.label', {}), 3));
    const radii = polys.map((p) => Math.max(...p.map((q) => Math.hypot(q.x - 58.5, q.y - 58.5))));
    expect(Math.max(...radii)).toBeGreaterThan(61.4);
    expect(Math.min(...radii)).toBeLessThan(17.6);
  });
});

describe('duplex', () => {
  it('puts the inside of a panel behind its outside (long edge)', () => {
    const project = makeProject('t', 'jewel', [makePiece('jewel.booklet4')]);
    const piece = project.pieces[0];
    piece.layers.outside.push(makeFillLayer('#000', { x: 0, y: 0, w: 240, h: 120 }));
    piece.layers.inside.push(makeFillLayer('#000', { x: 0, y: 0, w: 240, h: 120 }));
    project.print.duplex = 'long';
    const plan = buildPrintPlan(project, STRINGS);
    const [front, back] = plan.pages.filter((p): p is SheetPage => p.kind === 'sheet');
    expect(back.face).toBe('back');
    const f = front.images[0].rect;
    const b = back.images[0].rect;
    // Mirrored around the vertical axis of the page.
    expect(b.x).toBeCloseTo(210 - f.x - f.w);
    expect(b.y).toBeCloseTo(f.y);
    expect(b.w).toBeCloseTo(f.w);
  });

  it('placement matrix rotates clockwise', () => {
    const d = buildDieline('dvd.wrap', {});
    const m = placementMatrix(d, 10, 20, true);
    expect(applyMatrix(m, { x: 0, y: 0 })).toEqual({ x: 10 + d.h, y: 20 });
    expect(applyMatrix(m, { x: d.w, y: d.h })).toEqual({ x: 10, y: 20 + d.w });
  });
});

describe('preflight', () => {
  it('flags low resolution, text on folds and empty pieces', () => {
    const project = makeProject('t', 'jewel', [makePiece('jewel.booklet4'), makePiece('jewel.tray')]);
    const p = project.pieces[0];
    p.layers.outside.push({ ...makeFillLayer('#000', { x: 0, y: 0, w: 1, h: 1 }), type: 'image', assetId: 'a', naturalW: 300, naturalH: 300, flipX: false, flipY: false, bleedFill: 'auto', adjust: { brightness: 0, contrast: 0, saturation: 0, grayscale: false }, w: 120, h: 120 } as never);
    p.layers.outside.push(makeTextLayer('Across', { x: 100, y: 50, w: 40, h: 6 }));
    const kinds = preflight(project).map((i) => i.kind);
    expect(kinds).toContain('veryLowDpi');
    expect(kinds).toContain('textOnFold');
    expect(kinds).toContain('emptyPiece');
  });

  it('checks rotated text by the area it covers once turned', () => {
    const project = makeProject('t', 'jewel', [makePiece('jewel.booklet1')]);
    const text = makeTextLayer('Long title', { x: 10, y: 8, w: 100, h: 10 });
    project.pieces[0].layers.outside.push(text);
    expect(preflight(project).map((i) => i.kind)).not.toContain('textOutsideSafe');
    text.rotation = 45;
    expect(preflight(project).map((i) => i.kind)).toContain('textOutsideSafe');
  });
});

describe('saddle-stitched booklet', () => {
  it('orders pages on nested sheets', async () => {
    const { saddleStitchSpreads } = await import('./expand');
    expect(saddleStitchSpreads(8)).toEqual([
      { outside: [8, 1], inside: [2, 7] },
      { outside: [6, 3], inside: [4, 5] },
    ]);
    const s16 = saddleStitchSpreads(16);
    expect(s16).toHaveLength(4);
    // Every page appears exactly once.
    expect(s16.flatMap((s) => [...s.outside, ...s.inside]).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it('expands pages into spreads with the right offsets and clips', async () => {
    const { expandForPrint } = await import('./expand');
    const piece = makePiece('jewel.bookletN', { pages: 8 });
    piece.layers.p1 = [makeFillLayer('#111', { x: 0, y: 0, w: 120, h: 120 })];
    piece.layers.p7 = [makeFillLayer('#777', { x: 10, y: 0, w: 50, h: 50 })];
    const spreads = expandForPrint([piece]);
    expect(spreads).toHaveLength(2);
    const [s0] = spreads;
    expect(s0.templateId).toBe('jewel.booklet4');
    expect(s0.layers.outside[0]).toMatchObject({ x: 120, clip: { panelId: 'front' } });
    expect(s0.layers.inside[0]).toMatchObject({ x: 130, clip: { panelId: 'p3' } });
  });

  it('plans one double-sided A4 per spread and needs duplex', async () => {
    const { preflight } = await import('./preflight');
    const project = makeProject('t', 'jewel', [makePiece('jewel.bookletN', { pages: 12 })]);
    const piece = project.pieces[0];
    for (let n = 1; n <= 12; n++) piece.layers[`p${n}`] = [makeFillLayer('#123', { x: 0, y: 0, w: 120, h: 120 })];
    expect(preflight(project).map((i) => i.kind)).toContain('insideIgnored');
    project.print.duplex = 'long';
    const plan = buildPrintPlan(project, STRINGS);
    const sheets = plan.pages.filter((p): p is SheetPage => p.kind === 'sheet');
    expect(sheets.filter((p) => p.face === 'front')).toHaveLength(3);
    expect(sheets.filter((p) => p.face === 'back')).toHaveLength(3);
  });
});
