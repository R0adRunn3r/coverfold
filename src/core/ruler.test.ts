import { describe, expect, it } from 'vitest';
import type { Rect } from './geometry';
import { DEFAULT_PRINT, makeFillLayer, makePiece, makeProject, type Piece } from './model';
import { buildPrintPlan, freeSpot, placeRuler, rulerBox, rulerLines, type PrintStrings, type SheetPage } from './printPlan';
import { ALL_ASSEMBLY_KEYS, TEMPLATES, buildDieline } from './templates/catalog';
import { A4 } from './units';

const STRINGS: PrintStrings = {
  sheetLabel: 'Sheet {n}/{total}', front: 'front', back: 'back',
  paper: { paper: 'paper', cardstock: 'card', sticker: 'sticker' },
  pieceName: Object.fromEntries(TEMPLATES.map((t) => [t.id, t.id])),
  assembly: Object.fromEntries(ALL_ASSEMBLY_KEYS.map((k) => [k, k])),
  instructionsTitle: 'Assembly', sheetsHeading: 'Sheets', sheetLine: '{n}', generalHeading: 'General', general: [],
  rulerCaption: 'RULER100', rulerCaptionShort: 'RULER50',
  partName: '{name} {n}/{total}', joinHeading: '{name}', joinSteps: [],
};

const filled = (id: string): Piece => {
  const p = makePiece(id);
  const d = buildDieline(p.templateId, p.params);
  p.layers.outside.push(makeFillLayer('#3366cc', { x: 0, y: 0, w: d.w, h: d.h }));
  return p;
};

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The ruler as printed: which sheet, its caption, and its box. */
function rulerOf(pages: ReturnType<typeof buildPrintPlan>['pages']) {
  for (const p of pages) {
    if (p.kind !== 'sheet') continue;
    const cap = p.texts.find((t) => t.text.startsWith('RULER'));
    if (cap) return { page: p as SheetPage, caption: cap };
  }
  return null;
}

describe('calibration ruler', () => {
  it('is drawn lying down or upright with 5 mm ticks', () => {
    const lying = rulerLines(10, 20, 100);
    expect(lying[0]).toMatchObject({ x1: 10, y1: 24, x2: 110, y2: 24 });
    expect(lying).toHaveLength(22);
    const upright = rulerLines(10, 20, 50, true);
    expect(upright[0]).toMatchObject({ x1: 10, y1: 20, x2: 10, y2: 70 });
    expect(upright).toHaveLength(12);
    // Ticks point right of the upright baseline, inside the ruler's box.
    for (const l of upright.slice(1)) expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(13.01);
  });

  it('finds the free place nearest the middle, away from obstacles', () => {
    const area = { x: 0, y: 0, w: 100, h: 50 };
    expect(freeSpot(area, [], 20, 10)).toEqual({ x: 40, y: 20 });
    const spot = freeSpot(area, [{ x: 30, y: 10, w: 40, h: 30 }], 20, 10)!;
    expect(overlap({ ...spot, w: 20, h: 10 }, { x: 29, y: 9, w: 42, h: 32 })).toBe(false);
    expect(freeSpot(area, [{ x: 0, y: 0, w: 100, h: 50 }], 20, 10)).toBeNull();
    expect(freeSpot(area, [], 120, 10)).toBeNull();
  });

  it('prefers 100 mm lying down, then upright, then 50 mm', () => {
    const area = { x: 0, y: 0, w: 120, h: 120 };
    expect(placeRuler(area, [[]])).toMatchObject({ sheet: 0, length: 100, vertical: false });
    // Only a tall strip on the right is free.
    expect(placeRuler(area, [[{ x: 0, y: 0, w: 105, h: 120 }]])).toMatchObject({ length: 100, vertical: true });
    // Only a 60 mm wide strip at the bottom.
    expect(placeRuler(area, [[{ x: 0, y: 0, w: 120, h: 105 }, { x: 60, y: 0, w: 60, h: 120 }]])).toMatchObject({ length: 50, vertical: false });
    expect(placeRuler(area, [[{ x: 0, y: 0, w: 120, h: 120 }]])).toBeNull();
    // The first sheet with room wins.
    expect(placeRuler(area, [[{ x: 0, y: 0, w: 120, h: 120 }], []])).toMatchObject({ sheet: 1 });
  });

  it('goes on a printed sheet, never on the instructions page, clear of pieces and the sheet label', () => {
    const p = makeProject('t', 'jewel', [filled('jewel.tray'), filled('jewel.booklet4')]);
    p.print = { ...DEFAULT_PRINT, instructions: true };
    const plan = buildPrintPlan(p, STRINGS);
    const r = rulerOf(plan.pages);
    expect(r).not.toBeNull();
    expect(plan.rulerMissing).toBe(false);
    const ruler = r!.page.lines.filter((l) => l.width === 0.2 && l.color.every((c) => c === 0));
    const box = ruler.reduce((b, l) => ({ x0: Math.min(b.x0, l.x1, l.x2), y0: Math.min(b.y0, l.y1, l.y2), x1: Math.max(b.x1, l.x1, l.x2), y1: Math.max(b.y1, l.y1, l.y2) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const rect = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
    for (const img of r!.page.images) expect(overlap(rect, img.rect)).toBe(false);
    const label = r!.page.texts.find((t) => t.text.startsWith('Sheet'))!;
    expect(overlap(rect, { x: label.x - 45, y: label.y - 2.6, w: 90, h: 3.6 })).toBe(false);
    const ip = plan.pages.find((x) => x.kind === 'instructions');
    expect(ip).toBeDefined();
    expect(Object.keys(ip!)).not.toContain('ruler');
  });

  it('finds room beside a digipak, where the bands above and below are too thin', () => {
    const p = makeProject('t', 'digipak', [filled('digipak.4p')]);
    const plan = buildPrintPlan(p, STRINGS);
    const r = rulerOf(plan.pages);
    expect(r?.caption.upright).toBe(true);
    expect(r?.caption.text).toBe('RULER100');
    expect(r!.caption.x).toBeLessThan(A4.w);
  });

  it('can be turned off, and the instructions page is off by default', () => {
    const p = makeProject('t', 'jewel', [filled('jewel.tray')]);
    expect(p.print.instructions).toBe(false);
    expect(buildPrintPlan(p, STRINGS).pages.some((x) => x.kind === 'instructions')).toBe(false);
    p.print = { ...p.print, ruler: false };
    const plan = buildPrintPlan(p, STRINGS);
    expect(rulerOf(plan.pages)).toBeNull();
    expect(plan.rulerMissing).toBe(false);
    // Nothing to print: nothing missing either.
    const empty = makeProject('e', 'jewel', [makePiece('jewel.tray')]);
    expect(buildPrintPlan(empty, STRINGS).rulerMissing).toBe(false);
  });

  it('keeps its box consistent with the drawing', () => {
    expect(rulerBox({ x: 5, y: 6, length: 100, vertical: false })).toEqual({ x: 5, y: 6, w: 104, h: 10 });
    expect(rulerBox({ x: 5, y: 6, length: 50, vertical: true })).toEqual({ x: 5, y: 6, w: 10, h: 54 });
  });
});
