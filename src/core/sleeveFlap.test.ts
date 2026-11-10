import { describe, expect, it } from 'vitest';
import { ALL_ASSEMBLY_KEYS, assemblyKeysOf, buildDieline, choicePatch, CLOSE_SLIT, CLOSE_TUCK, getTemplate, NOTCH_OFF, TEMPLATES } from './templates/catalog';
import { splitFor } from './expand';
import { insideView } from './faces';
import { flattenPath, pointInPath, type Path, type Point } from './geometry';
import { estimateSheets } from './kits';
import { panelSafeRect } from './layout';
import { makeFillLayer, makePiece, makeProject } from './model';
import { buildPrintPlan, type PrintStrings } from './printPlan';
import { partDieline } from './split';

const FIT = { printerMargin: 4, margin: 8.5, minMargin: 3 };
const pts = (p: Path): Point[] => p.filter((s) => s.t !== 'Z').map((s) => ({ x: (s as Point).x, y: (s as Point).y }));

describe('sleeve with closure flap', () => {
  it('fits one A4 sheet with either closure', () => {
    for (const lock of [CLOSE_SLIT, CLOSE_TUCK]) {
      const d = buildDieline('sleeve.flap', { lock });
      expect(splitFor(d, FIT)).toBeNull();
      expect(estimateSheets([{ templateId: 'sleeve.flap', params: { lock } }]).sheets).toBe(1);
    }
    // back + front + flap + tab (9 mm); the tucked flap has no tab.
    expect(buildDieline('sleeve.flap', {}).w).toBeCloseTo(124 * 2 + 24 + 9, 5);
    expect(buildDieline('sleeve.flap', { lock: CLOSE_TUCK }).w).toBeCloseTo(124 * 2 + 24, 5);
  });

  it('cuts the slit in the back where the flap lands, bowed like the tab and wider than it', () => {
    const d = buildDieline('sleeve.flap', {});
    expect(d.slits).toHaveLength(1);
    const s = pts(d.slits![0]);
    const back = d.panels.find((p) => p.id === 'back')!.rect;
    const tab = d.tucks![0].tab;
    // Ends 2 mm short of the flap depth (24 mm from the opening edge of the back), bulging 2.5 mm further in.
    expect(s[0].x).toBeCloseTo(22, 5);
    expect(s[s.length - 1].x).toBeCloseTo(22, 5);
    expect(Math.max(...s.map((p) => p.x))).toBeCloseTo(24.5, 1);
    expect(Math.abs(s[s.length - 1].y - s[0].y)).toBeCloseTo(tab.h + 2, 5);
    // Inside the back, clear of its edges.
    for (const p of s) {
      expect(p.x).toBeGreaterThan(back.x + 10);
      expect(p.y).toBeGreaterThan(back.y + 10);
      expect(p.y).toBeLessThan(back.y + back.h - 10);
    }
    // The tucked flap needs none.
    expect(buildDieline('sleeve.flap', { lock: CLOSE_TUCK }).slits).toEqual([]);
  });

  it('has a thumb notch in the opening edge of the back, and a safe area inside the flap outline', () => {
    for (const lock of [CLOSE_SLIT, CLOSE_TUCK]) {
      const d = buildDieline('sleeve.flap', { lock });
      const polys = flattenPath(d.cut);
      const cy = d.h / 2;
      expect(pointInPath({ x: 4, y: cy }, polys)).toBe(false);
      expect(pointInPath({ x: 12, y: cy }, polys)).toBe(true);
      const flap = d.panels.find((p) => p.id === 'closure')!;
      const r = panelSafeRect(flap);
      expect(r.w).toBeGreaterThanOrEqual(15);
      for (const c of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]) {
        expect(pointInPath(c, polys)).toBe(true);
      }
      // The inside view mirrors the panels and the slits.
      const inside = insideView(d);
      const inFlap = inside.panels.find((p) => p.id === 'inClosure')!;
      expect(panelSafeRect(inFlap).x).toBeCloseTo(d.w - r.x - r.w, 5);
      if (lock === CLOSE_SLIT) expect(pts(inside.slits![0])[0].x).toBeCloseTo(d.w - 22, 5);
    }
  });

  it('leaves the opening edge of the back straight when the thumb notch is off', () => {
    for (const lock of [CLOSE_SLIT, CLOSE_TUCK]) {
      const d = buildDieline('sleeve.flap', { lock, notch: NOTCH_OFF });
      const polys = flattenPath(d.cut);
      const cy = d.h / 2;
      expect(pointInPath({ x: 1, y: cy }, polys)).toBe(true);
      expect(pointInPath({ x: 4, y: cy }, polys)).toBe(true);
      // Nothing else changes: same size, same slit.
      const withNotch = buildDieline('sleeve.flap', { lock });
      expect(d.w).toBe(withNotch.w);
      expect(d.h).toBe(withNotch.h);
      expect(d.slits).toEqual(withNotch.slits);
    }
  });

  it('makes the tucked flap narrower than the pocket at its fold and tapering to its edge', () => {
    const d = buildDieline('sleeve.flap', { lock: CLOSE_TUCK, closure: 18 });
    const polys = flattenPath(d.cut);
    const X = 2 * 124, g = 13, h = 125;
    expect(d.w).toBeCloseTo(X + 18, 5);
    // 2.5 mm clear of each seam at the fold, 10 mm at the edge.
    expect(pointInPath({ x: X + 0.3, y: g + 1.5 }, polys)).toBe(false);
    expect(pointInPath({ x: X + 0.3, y: g + 3.5 }, polys)).toBe(true);
    expect(pointInPath({ x: X + 17.5, y: g + 9 }, polys)).toBe(false);
    expect(pointInPath({ x: X + 17.5, y: g + h / 2 }, polys)).toBe(true);
    expect(pointInPath({ x: X + 17.5, y: g + h - 9 }, polys)).toBe(false);
    // The fold line stops where the flap does.
    const fold = d.folds.find((f) => f.x1 === X && f.x2 === X)!;
    expect(Math.min(fold.y1, fold.y2)).toBeCloseTo(g + 2.5, 5);
    expect(Math.max(fold.y1, fold.y2)).toBeCloseTo(g + h - 2.5, 5);
    // Its safe area stays inside the outline, even at the shortest length.
    for (const closure of [16, 18, 30]) {
      const dd = buildDieline('sleeve.flap', { lock: CLOSE_TUCK, closure });
      const r = panelSafeRect(dd.panels.find((p) => p.id === 'closure')!);
      for (const c of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]) {
        expect(pointInPath(c, flattenPath(dd.cut))).toBe(true);
      }
    }
  });

  it('shortens the flap when switching to the tucked closure, unless its length was changed', () => {
    const t = getTemplate('sleeve.flap');
    expect(choicePatch(t, {}, 'lock', CLOSE_TUCK)).toEqual({ lock: CLOSE_TUCK, closure: 18 });
    expect(choicePatch(t, { lock: CLOSE_TUCK, closure: 18 }, 'lock', CLOSE_SLIT)).toEqual({ lock: CLOSE_SLIT, closure: 24 });
    expect(choicePatch(t, { closure: 21 }, 'lock', CLOSE_TUCK)).toEqual({ lock: CLOSE_TUCK });
    // Choices without suited measurements change only themselves.
    expect(choicePatch(t, {}, 'notch', NOTCH_OFF)).toEqual({ notch: NOTCH_OFF });
  });

  it('lists the slit and the closing among the steps of its closure', () => {
    expect(assemblyKeysOf('sleeve.flap', {})).toEqual(['asm.cutLine', 'asm.flap.slit', 'asm.scoreFolds', 'asm.sleeve.flaps', 'asm.sleeve.glue', 'asm.flap.close']);
    expect(assemblyKeysOf('sleeve.flap', { lock: CLOSE_TUCK })).not.toContain('asm.flap.slit');
    expect(assemblyKeysOf('sleeve.flap', { lock: CLOSE_TUCK })).toContain('asm.flap.tuck');
  });

  it('prints the slit as a cut line on the sheet', () => {
    const strings: PrintStrings = {
      sheetLabel: 'Sheet {n}/{total}', front: 'front', back: 'back',
      paper: { paper: 'paper', cardstock: 'cardstock', sticker: 'sticker' },
      pieceName: Object.fromEntries(TEMPLATES.map((t) => [t.id, t.id])),
      assembly: Object.fromEntries(ALL_ASSEMBLY_KEYS.map((k) => [k, k])),
      instructionsTitle: 'Assembly', sheetsHeading: 'Sheets', sheetLine: 'Sheet {n}', generalHeading: 'Before', general: [],
      rulerCaption: '100 mm', rulerCaptionShort: '50 mm', partName: '{name} {n}/{total}', joinHeading: 'Join {name}', joinSteps: [],
    };
    const piece = makePiece('sleeve.flap', {});
    const d = buildDieline(piece.templateId, piece.params);
    piece.layers.outside.push(makeFillLayer('#203040', { x: 0, y: 0, w: d.w, h: d.h }));
    const plan = buildPrintPlan(makeProject('t', 'sleeve', [piece]), strings);
    const front = plan.pages.find((p) => p.kind === 'sheet' && p.face === 'front');
    expect(front && front.kind === 'sheet').toBe(true);
    // The outline (closed) and the slit (open: no Z).
    const open = front!.kind === 'sheet' ? front!.paths.filter((p) => !p.path.some((s) => s.t === 'Z')) : [];
    expect(open).toHaveLength(1);
  });

  it('keeps the slit in the part with the back when a large one is split', () => {
    const d = buildDieline('sleeve.flap', { pw: 130, closure: 30 });
    const parts = splitFor(d, FIT)!;
    expect(parts.length).toBeGreaterThan(1);
    const slits = parts.map((r) => partDieline(d, r).slits ?? []);
    expect(slits.flat()).toHaveLength(1);
    expect(slits[0]).toHaveLength(1);
  });
});
