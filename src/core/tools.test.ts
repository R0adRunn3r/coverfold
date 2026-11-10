// Design tools: colours, QR codes, alignment, picture framing, and the
// checks and bleed rules that depend on them.
import { describe, expect, it } from 'vitest';
import { alignLayers, alignTarget, layerBounds } from './align';
import { contrastRatio, formatColor, parseColor } from './color';
import { circlePatch, cropControls, cropFor, croppedPixels } from './crop';
import { autoExtension, panelSafeRect } from './layout';
import { makeImageLayer, makePiece, makeProject, makeQrLayer, makeTextLayer } from './model';
import { layerDpi, preflight } from './preflight';
import { QR_QUIET, qrMatrix } from './qr';
import { qrModule, qrProblem } from './qrLayer';
import { activeLayers, createEditor } from './store';
import { buildDieline } from './templates/catalog';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('colours', () => {
  it('parses and formats the colours the app writes', () => {
    expect(parseColor('#abc')).toEqual({ hex: '#aabbcc', a: 1 });
    expect(parseColor('rgba(255,0,0,0.5)')).toEqual({ hex: '#ff0000', a: 0.5 });
    expect(parseColor('#00000080')!.a).toBeCloseTo(0.5, 2);
    expect(parseColor('nope')).toBeNull();
    expect(formatColor('#ff0000', 1)).toBe('#ff0000');
    expect(formatColor('#ff0000', 0.25)).toBe('rgba(255,0,0,0.25)');
  });

  it('measures contrast like WCAG', () => {
    close(contrastRatio('#000000', '#ffffff')!, 21, 1e-3);
    close(contrastRatio('#777777', '#777777')!, 1, 1e-9);
  });
});

describe('QR codes', () => {
  it('encodes a URL into a standard matrix with finder patterns', () => {
    const m = qrMatrix('https://example.com', 'M')!;
    expect(m.version).toBe(2);
    expect(m.size).toBe(25);
    const dark = (r: number, c: number) => m.dark[r * m.size + c] === 1;
    // Finder pattern: dark ring, light ring, dark 3x3 core (all three corners).
    for (const [r0, c0] of [[0, 0], [0, m.size - 7], [m.size - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        expect(dark(r0, c0 + i)).toBe(true);
        expect(dark(r0 + 6, c0 + i)).toBe(true);
      }
      expect(dark(r0 + 1, c0 + 1)).toBe(false);
      expect(dark(r0 + 3, c0 + 3)).toBe(true);
    }
  });

  it('caches, encodes UTF-8, and refuses empty or oversized content', () => {
    expect(qrMatrix('abc', 'L')).toBe(qrMatrix('abc', 'L'));
    expect(qrMatrix('città', 'M')).not.toBeNull();
    expect(qrMatrix('', 'M')).toBeNull();
    expect(qrMatrix('x'.repeat(4000), 'H')).toBeNull();
    // More correction, same text: never fewer modules.
    expect(qrMatrix('https://example.com', 'H')!.size).toBeGreaterThanOrEqual(qrMatrix('https://example.com', 'L')!.size);
  });

  it('reports what would stop a phone from reading it', () => {
    const q = makeQrLayer('https://example.com', { x: 0, y: 0, w: 25, h: 25 });
    expect(qrProblem(q)).toBeNull();
    close(qrModule(q)!, 25 / (25 + 2 * QR_QUIET));
    expect(qrProblem({ ...q, w: 10, h: 10 })).toBe('small');
    expect(qrProblem({ ...q, text: '  ' })).toBe('empty');
    expect(qrProblem({ ...q, text: 'x'.repeat(4000) })).toBe('tooLong');
    expect(qrProblem({ ...q, color: '#dddddd' })).toBe('contrast');
    expect(qrProblem({ ...q, color: '#ffffff', background: '#000000' })).toBe('contrast'); // inverted
    expect(qrProblem({ ...q, background: null })).toBeNull();
    expect(qrProblem({ ...q, background: null, color: '#ffeeaa' })).toBe('contrast');
  });

  it('gets no automatic bleed and shows up in the print checks', () => {
    const d = buildDieline('jewel.tray', {});
    const q = makeQrLayer('', { x: 0, y: 0, w: 20, h: 20 });
    expect(autoExtension(q, d, 'outside', 3)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    const piece = makePiece('jewel.tray');
    piece.layers.outside.push(q);
    const kinds = preflight(makeProject('t', 'jewel', [piece])).map((i) => i.kind);
    expect(kinds).toContain('qrEmpty');
    // Across the spine fold of the tray card.
    const back = d.panels.find((p) => p.id === 'back')!;
    const onFold = makeQrLayer('https://example.com', { x: back.rect.x - 10, y: 40, w: 20, h: 20 });
    piece.layers.outside = [onFold];
    expect(preflight(makeProject('t', 'jewel', [piece])).map((i) => i.kind)).toContain('qrOnFold');
  });
});

describe('alignment', () => {
  const d = buildDieline('jewel.tray', {});
  const back = d.panels.find((p) => p.id === 'back')!;
  const safe = panelSafeRect(back);

  it('uses the visual box of rotated layers', () => {
    const b = layerBounds({ x: 0, y: 0, w: 40, h: 10, rotation: 90 });
    close(b.w, 10);
    close(b.h, 40);
    close(b.x, 15);
  });

  it('aligns edges to the safe area and centres on the panel', () => {
    const l = makeTextLayer('x', { x: back.rect.x + 30, y: 50, w: 40, h: 10 });
    const target = alignTarget([l], 'panel', d, 'outside');
    expect(target.panel?.id).toBe('back');
    const [left] = alignLayers([l], 'left', target);
    close(left.x, safe.x);
    const [right] = alignLayers([l], 'right', target);
    close(right.x + 40, safe.x + safe.w);
    const [mid] = alignLayers([{ ...l, rotation: 90 }], 'vcenter', target);
    close(mid.y + 5, back.rect.y + back.rect.h / 2);
  });

  it('sets the paragraph alignment so the letters line up, following the reading direction', () => {
    const l = makeTextLayer('x', { x: back.rect.x + 30, y: 50, w: 40, h: 10 });
    const target = alignTarget([l], 'panel', d, 'outside');
    expect(alignLayers([l], 'hcenter', target)[0].align).toBe('center');
    expect(alignLayers([l], 'right', target)[0].align).toBe('right');
    expect(alignLayers([l], 'top', target)[0].align).toBeUndefined();
    const spine = { ...l, rotation: 90 };
    expect(alignLayers([spine], 'top', target)[0].align).toBeUndefined(); // already left
    expect(alignLayers([spine], 'bottom', target)[0].align).toBe('right');
    expect(alignLayers([spine], 'vcenter', target)[0].align).toBe('center');
    expect(alignLayers([{ ...l, rotation: 270 }], 'top', target)[0].align).toBe('right');
    expect(alignLayers([{ ...l, rotation: 15 }], 'right', target)[0].align).toBeUndefined();
    expect(alignLayers([{ ...l, mode: 'tracklist' as const }], 'right', target)[0].align).toBeUndefined();
  });

  it('prefers the panel a layer is clipped to, and falls back to the piece', () => {
    const clipped = { ...makeTextLayer('x', { x: 1, y: 1, w: 5, h: 5 }), clip: { panelId: 'back' } };
    expect(alignTarget([clipped], 'panel', d, 'outside').panel?.id).toBe('back');
    const outside = makeTextLayer('x', { x: -50, y: -50, w: 5, h: 5 });
    expect(alignTarget([outside], 'panel', d, 'outside').to).toBe('piece');
  });

  it('aligns several layers to each other', () => {
    const a = makeTextLayer('a', { x: 10, y: 10, w: 20, h: 5 });
    const b = makeTextLayer('b', { x: 30, y: 30, w: 10, h: 5 });
    const target = alignTarget([a, b], 'selection', d, 'outside');
    const moves = alignLayers([a, b], 'right', target);
    close(moves[0].x + 20, 40);
    close(moves[1].x + 10, 40);
    const centred = alignLayers([a, b], 'hcenter', target);
    close(centred[0].x + 10, centred[1].x + 5);
  });

  it('is one undo step in the editor and leaves locked layers alone', () => {
    const ed = createEditor();
    ed.load(makeProject('t', 'jewel', [makePiece('jewel.tray')]));
    const a = makeTextLayer('a', { x: back.rect.x + 20, y: 40, w: 20, h: 5 });
    const b = { ...makeTextLayer('b', { x: back.rect.x + 40, y: 60, w: 20, h: 5 }), locked: true };
    ed.addLayer(a);
    ed.addLayer(b);
    ed.alignLayers([a.id, b.id], 'left', 'panel');
    const [na, nb] = activeLayers(ed.store.getState());
    close(na.x, safe.x);
    expect(nb.x).toBe(b.x);
    ed.undo();
    expect(activeLayers(ed.store.getState())[0].x).toBe(a.x);
  });
});

describe('picture framing', () => {
  it('shows the whole picture when the box has its proportions', () => {
    expect(cropFor(1.5, 1.5)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('crops the middle of a landscape photo into a square, never distorting it', () => {
    const c = cropFor(1, 2); // square box, 2:1 photo
    close(c.w, 0.5);
    close(c.h, 1);
    close(c.x, 0.25);
    const img = { ...makeImageLayer('a', 'a', 2000, 1000, { x: 0, y: 0, w: 60, h: 30 }) };
    const p = circlePatch(img);
    expect(p.w).toBe(30);
    expect(p.h).toBe(30);
    close(p.x!, 15);
    expect(p.mask?.shape).toBe('ellipse');
    // Shown pixels keep the box proportions.
    const px = croppedPixels({ ...img, ...p });
    close(px.w / px.h, 1);
  });

  it('turns zoom and pan back into the same controls', () => {
    const l = makeImageLayer('a', 'a', 3000, 2000, { x: 0, y: 0, w: 60, h: 40 });
    const crop = cropFor(1.5, 1.5, 2, 0.5, -0.3);
    const c = cropControls({ ...l, crop });
    close(c.zoom, 2);
    close(c.panX, 0.5);
    close(c.panY, -0.3);
    expect(c.canPanX && c.canPanY).toBe(true);
    // Pan stays inside the picture.
    const edge = cropFor(1.5, 1.5, 2, 5, -5);
    close(edge.x + edge.w, 1);
    close(edge.y, 0);
  });

  it('counts only the shown pixels for print resolution', () => {
    const l = makeImageLayer('a', 'a', 3000, 2000, { x: 0, y: 0, w: 127, h: 84.67 });
    const full = layerDpi(l)!;
    const zoomed = layerDpi({ ...l, crop: cropFor(l.w / l.h, 1.5, 2) })!;
    close(zoomed, full / 2, 0.5);
  });

  it('gives shaped pictures no automatic bleed', () => {
    const d = buildDieline('jewel.tray', {});
    const full = makeImageLayer('a', 'a', 1000, 1000, { x: -3, y: -3, w: d.w + 6, h: d.h + 6 });
    full.x = 0; full.y = 0; full.w = d.w; full.h = d.h;
    expect(autoExtension(full, d, 'outside', 3).left).toBeGreaterThan(0);
    expect(autoExtension({ ...full, mask: { shape: 'rounded', radius: 4 } }, d, 'outside', 3).left).toBe(0);
  });
});
