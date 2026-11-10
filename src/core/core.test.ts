/// <reference types="node" />
import { writeFileSync } from 'node:fs';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { composePdf, toWinAnsi } from './export/composePdf';
import { circlePath, flattenPath, pathBBox, pointInPath } from './geometry';
import { stepHighlight } from './assembly';
import { expandForPrint, splitFor } from './expand';
import { faceDieline } from './faces';
import { ARM_ROOT_R, ARM_SWEEP, ARM_TIP_R, DISC_HOLE_R, GRIP_R, HUB, HUB_HOLE_R, POST_IN_R, trayFor, trayHeight } from './tray';
import { fitsSheet, impose } from './imposition';
import { partDieline, TAB_WIDTH } from './split';
import { autoExtension, fitBox, panelBleedRect } from './layout';
import { makeFillLayer, makeImageLayer, makePiece, makeProject, type Project } from './model';
import { buildPrintPlan, straightEdges, type PrintStrings, type SheetPage } from './printPlan';
import { ALL_ASSEMBLY_KEYS, TEMPLATES, buildDieline } from './templates/catalog';

const STRINGS: PrintStrings = {
  sheetLabel: 'Sheet {n}/{total} · {paper} · {face}',
  front: 'front',
  back: 'back',
  paper: { paper: 'paper 120–170 g/m²', cardstock: 'cardstock 250–300 g/m²', sticker: 'A4 sticker paper' },
  pieceName: Object.fromEntries(TEMPLATES.map((t) => [t.id, t.id])),
  assembly: Object.fromEntries(ALL_ASSEMBLY_KEYS.map((k) => [k, k])),
  instructionsTitle: 'Assembly',
  sheetsHeading: 'Sheets',
  sheetLine: 'Sheet {n} ({paper}): {pieces}',
  generalHeading: 'Before you start',
  general: ['Print at 100% (actual size).'],
  rulerCaption: '100 mm – check the print scale',
  rulerCaptionShort: '50 mm',
  partName: '{name} – part {n}/{total}',
  joinHeading: 'Join the parts of {name}',
  joinSteps: ['Glue tab {letters}.'],
};

const filled = (p: ReturnType<typeof makePiece>) => {
  const d = buildDieline(p.templateId, p.params);
  p.layers.outside.push(makeFillLayer('#3366cc', { x: 0, y: 0, w: d.w, h: d.h }));
  return p;
};

describe('templates', () => {
  it('build standard sizes', () => {
    expect(buildDieline('jewel.tray', {})).toMatchObject({ w: 151, h: 118 });
    expect(buildDieline('jewel.booklet4', {})).toMatchObject({ w: 240, h: 120 });
    expect(buildDieline('dvd.wrap', {})).toMatchObject({ w: 273, h: 183 });
    expect(buildDieline('dvd.wrap', { spine: 7 })).toMatchObject({ w: 266, h: 183 });
    expect(buildDieline('sleeve.card', {})).toMatchObject({ w: 248, h: 151 });
  });

  it('every template has panels inside its trim box', () => {
    for (const t of TEMPLATES) {
      const d = buildDieline(t.id, {});
      for (const p of [...d.panels, ...d.insidePanels]) {
        expect(p.rect.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.rect.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(d.w + 1e-9);
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(d.h + 1e-9);
      }
      const bb = pathBBox(d.cut);
      expect(bb.w).toBeCloseTo(d.w, 1);
      expect(bb.h).toBeCloseTo(d.h, 1);
    }
  });

  it('inside panels mirror the outside', () => {
    const d = buildDieline('jewel.booklet4', {});
    expect(d.insidePanels.find((p) => p.id === 'p2')!.rect.x).toBe(0);
    expect(d.insidePanels.find((p) => p.id === 'p3')!.rect.x).toBe(120);
  });

  it('disc has a hole (even-odd)', () => {
    const d = buildDieline('disc.label', {});
    const polys = flattenPath(d.cut);
    expect(pointInPath({ x: 58.5, y: 58.5 }, polys)).toBe(false);
    expect(pointInPath({ x: 58.5, y: 10 }, polys)).toBe(true);
  });

  it('circle path is accurate', () => {
    const bb = pathBBox(circlePath(0, 0, 58.5));
    expect(bb.w).toBeCloseTo(117, 2);
  });
});

describe('layout', () => {
  it('panel bleed rect grows only on cut edges', () => {
    const d = buildDieline('jewel.tray', {});
    const back = d.panels.find((p) => p.id === 'back')!;
    expect(panelBleedRect(back, 3)).toEqual({ x: 6.5, y: -3, w: 138, h: 124 });
  });

  it('auto extension reaches the bleed only where the image touches a cut edge', () => {
    const d = buildDieline('jewel.booklet1', {});
    const img = makeImageLayer('a', 'a', 1000, 1000, { x: 0, y: 0, w: 120, h: 100 });
    const ext = autoExtension(img, d, 'outside', 3);
    expect(ext).toEqual({ left: 3, right: 3, top: 3, bottom: 0 });
  });

  it('a fill covering the whole disc reaches the bleed beyond the rim', () => {
    const d = buildDieline('disc.label', {});
    expect(autoExtension(makeFillLayer('#000', { x: 0, y: 0, w: d.w, h: d.h }), d, 'outside', 3)).toEqual({ left: 3, right: 3, top: 3, bottom: 3 });
    const clipped = { ...makeFillLayer('#000', { x: 0, y: 0, w: d.w, h: d.h }), clip: { panelId: 'disc' } };
    expect(autoExtension(clipped, d, 'outside', 3)).toEqual({ left: 3, right: 3, top: 3, bottom: 3 });
  });

  it('a fill covering the whole sleeve also bleeds past the glue flaps', () => {
    const d = buildDieline('sleeve.card', {});
    expect(autoExtension(makeFillLayer('#000', { x: 0, y: 0, w: d.w, h: d.h }), d, 'outside', 3)).toEqual({ left: 3, right: 3, top: 3, bottom: 3 });
  });

  it('cover fit never distorts', () => {
    const d = buildDieline('jewel.booklet1', {});
    const box = fitBox(d.panels[0], 'cover-bleed', 1.5, 3);
    expect(box.h).toBeCloseTo(126);
    expect(box.w).toBeCloseTo(189);
  });
});

describe('imposition', () => {
  it('fits booklet + tray on one portrait A4', () => {
    const r = impose([
      { key: 'b', paper: 'paper', w: 120, h: 120, margin: 8.5, minMargin: 3 },
      { key: 't', paper: 'paper', w: 151, h: 118, margin: 8.5, minMargin: 3 },
    ], 4);
    expect(r.sheets).toHaveLength(1);
  });

  it('fits a DVD wrap with marks', () => {
    const r = impose([{ key: 'd', paper: 'paper', w: 273, h: 183, margin: 8.5, minMargin: 3 }], 4);
    expect(r.sheets).toHaveLength(1);
    const p = r.sheets[0].placements[0];
    expect(p.rotated).toBe(true);
    expect(r.tooLarge).toHaveLength(0);
  });

  it('separates papers', () => {
    const r = impose([
      { key: 'a', paper: 'paper', w: 120, h: 120, margin: 8.5, minMargin: 3 },
      { key: 'b', paper: 'cardstock', w: 120, h: 120, margin: 8.5, minMargin: 3 },
    ], 4);
    expect(r.sheets.map((s) => s.paper)).toEqual(['paper', 'cardstock']);
  });
});

function sampleProject(): Project {
  const p = makeProject('Phase 0', 'jewel', [
    filled(makePiece('jewel.booklet1')),
    filled(makePiece('jewel.tray')),
    filled(makePiece('dvd.wrap')),
    filled(makePiece('disc.label')),
    filled(makePiece('sleeve.card')),
  ]);
  return p;
}

describe('print plan', () => {
  it('places every piece and keeps marks off the artwork', () => {
    const plan = buildPrintPlan(sampleProject(), STRINGS);
    const sheets = plan.pages.filter((p): p is SheetPage => p.kind === 'sheet');
    expect(sheets.reduce((n, s) => n + s.images.length, 0)).toBe(5);
    expect(plan.tooLarge).toHaveLength(0);
    const rectangular = new Set(plan.pieces.filter((p) => buildDieline(p.templateId, p.params).rectangular).map((p) => p.id));
    for (const s of sheets) {
      for (const l of s.lines) {
        // Shaped pieces' bleed boxes have empty corners where marks may go.
        for (const img of s.images.filter((i) => rectangular.has(i.face.pieceId))) {
          const inside = (x: number, y: number) => x > img.rect.x + 0.01 && x < img.rect.x + img.rect.w - 0.01 && y > img.rect.y + 0.01 && y < img.rect.y + img.rect.h - 0.01;
          // Crop marks of rectangular pieces must stay out of every bleed box.
          if (l.dash === undefined && l.width === 0.15 && l.color[0] === 0) expect(inside((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2)).toBe(false);
        }
      }
    }
  });

  it('finds the straight edges that get crop marks', () => {
    expect(straightEdges(buildDieline('jewel.tray', {}).cut)).toHaveLength(4);
    expect(straightEdges(buildDieline('disc.label', {}).cut)).toHaveLength(0);
    // Sleeve: left side, back top/bottom, flap top/bottom, front right side.
    expect(straightEdges(buildDieline('sleeve.card', {}).cut)).toHaveLength(6);
  });

  const cropLines = (s: SheetPage) => s.lines.filter((l) => !l.dash && l.width === 0.15 && l.color[0] === 0);
  const sheetOf = (templateId: string, print: Partial<Project['print']> = {}) => {
    const p = makeProject('marks', 'jewel', [filled(makePiece(templateId))]);
    Object.assign(p.print, print);
    return buildPrintPlan(p, STRINGS);
  };

  it('gives every rectangular piece its eight crop marks', () => {
    for (const id of ['jewel.booklet1', 'jewel.booklet4', 'jewel.tray', 'jewel.obi', 'dvd.wrap', 'bluray.wrap']) {
      const plan = sheetOf(id);
      const s = plan.pages[0] as SheetPage;
      expect(cropLines(s), id).toHaveLength(8);
      expect(s.paths, id).toHaveLength(0);
      expect(plan.tight, id).toHaveLength(0);
    }
  });

  it('keeps the crop marks that fit when the sheet is tight in one direction', () => {
    // Digipak: 281 mm tall on A4, no room above/below, plenty on the sides.
    const plan = sheetOf('digipak.4p');
    const s = plan.pages[0] as SheetPage;
    const marks = cropLines(s);
    expect(marks.length).toBe(4);
    expect(marks.every((l) => Math.abs(l.y1 - l.y2) < 1e-6)).toBe(true);
    expect(s.paths).toHaveLength(1); // cut line takes over
    expect(plan.tight).toHaveLength(1);
  });

  it('marks the straight sides of shaped pieces and draws their cut line', () => {
    const s = sheetOf('sleeve.slipcase').pages[0] as SheetPage;
    expect(cropLines(s).length).toBeGreaterThanOrEqual(4);
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0].halo).toBeGreaterThan(0);
  });

  it('draws the cut line when crop marks are off', () => {
    const s = sheetOf('jewel.tray', { cropMarks: false }).pages[0] as SheetPage;
    expect(cropLines(s)).toHaveLength(0);
    expect(s.paths).toHaveLength(1);
  });

  const FIT = { printerMargin: 4, margin: 8.5, minMargin: 3 };

  it('splits pieces wider than A4 along folds, with glue tabs', () => {
    // A digipak with 142 mm panels (the old gatefold size) is wider than A4.
    const g = buildDieline('digipak.4p', { pw: 142, h: 125, holder: 1 });
    const r = splitFor(g, FIT)!;
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ x0: 0, x1: 142, tab: TAB_WIDTH });
    expect(r[1].x1).toBeCloseTo(g.w);
    expect(r[1].tab).toBe(0);
    expect(splitFor(buildDieline('wallet.six', {}), FIT)).toHaveLength(3);
    expect(splitFor(buildDieline('dvd.slipcover', {}), FIT)).toHaveLength(2);
    expect(splitFor(buildDieline('dvd.digipak', {}), FIT)).toHaveLength(2);
    // Pieces that fit stay whole.
    for (const id of ['digipak.4p', 'dvd.wrap', 'sleeve.card', 'jewel.ocard']) expect(splitFor(buildDieline(id, {}), FIT), id).toBeNull();
  });

  it('builds parts that fit a sheet and continue the panels over the tab', () => {
    const g = buildDieline('digipak.4p', { pw: 142, h: 125, holder: 1 });
    const [a, b] = splitFor(g, FIT)!.map((r) => partDieline(g, r));
    expect(a.w).toBeCloseTo(142 + TAB_WIDTH);
    const tab = a.panels.find((p) => p.labelKey === 'panel.glueTab')!;
    expect(tab.id).toBe('spine');
    expect(tab.edges.left).toBe('fold');
    expect(a.panels.find((p) => p.id === 'back')!.edges.right).toBe('fold');
    expect(a.glue).toHaveLength(1);
    expect(a.rectangular).toBe(false);
    // The second part starts at the seam: its edge there is cut, and it is a plain rectangle.
    expect(b.panels[0]).toMatchObject({ id: 'spine' });
    expect(b.panels[0].edges.left).toBe('cut');
    expect(b.rectangular).toBe(true);
    expect(b.folds.every((f) => f.x1 > 0.01)).toBe(true);
    // Inside view: mirrored, with the tab on the left continuing the inside spine.
    const inTab = a.insidePanels.find((p) => p.labelKey === 'panel.glueTab')!;
    expect(inTab.rect.x).toBeCloseTo(0);
    expect(a.insidePanels.some((p) => p.id === 'inRight')).toBe(true);
    for (const d of [a, b]) expect(fitsSheet(d.w, d.h, 4, 8.5)).toBe(true);
  });

  it('prints split pieces as parts with lettered tabs and joining steps', () => {
    const p = makeProject('split', 'digipak', [filled(makePiece('digipak.4p', { pw: 142, h: 125, holder: 1 }))]);
    const plan = buildPrintPlan(p, STRINGS);
    expect(plan.split).toEqual([{ pieceId: p.pieces[0].id, parts: 2 }]);
    expect(plan.pieces.map((x) => x.id)).toEqual([`${p.pieces[0].id}~p0`, `${p.pieces[0].id}~p1`]);
    expect(plan.tooLarge).toHaveLength(0);
    const sheets = plan.pages.filter((pg): pg is SheetPage => pg.kind === 'sheet');
    const letters = sheets.flatMap((s) => s.texts.filter((t) => t.text === 'A'));
    expect(letters.length).toBeGreaterThanOrEqual(1);
    // Every part's artwork is placed; the unclipped fill was moved into each part.
    expect(sheets.reduce((n, s) => n + s.images.length, 0)).toBe(2);
    expect(plan.pieces[1].layers.outside[0].x).toBeCloseTo(-142);
  });

  it('shows the inside of asymmetric pieces mirrored', () => {
    const piece = makePiece('sleeve.card');
    const out = faceDieline(piece, 'outside'), inn = faceDieline(piece, 'inside');
    const cx = (p: { x: number }[]) => p.reduce((a, q) => a + q.x, 0) / p.length;
    // Glue flaps hang off the front: on the right outside, on the left inside.
    expect(cx(flattenPath(out.glue[0])[0])).toBeGreaterThan(out.w / 2);
    expect(cx(flattenPath(inn.glue[0])[0])).toBeLessThan(inn.w / 2);
    expect(inn.panels.map((p) => p.id)).toEqual(out.insidePanels.map((p) => p.id));
    // Symmetric pieces look the same from both sides.
    const tray = makePiece('jewel.tray');
    expect(faceDieline(tray, 'inside').folds.map((f) => f.x1).sort()).toEqual(faceDieline(tray, 'outside').folds.map((f) => f.x1).sort());
  });

  it('sizes the 3D-printed tray to the panel it is glued in', () => {
    const t = trayFor(makePiece('digipak.4p'))!;
    expect(t).toMatchObject({ w: 135, h: 122.5, panelId: 'back' });
    expect(trayFor(makePiece('dvd.digipak'))).toMatchObject({ w: 133, h: 187 });
    expect(trayFor(makePiece('jewel.tray'))).toBeNull();
    // Closed, the cover must hold tray + disc: the default spines do.
    const h = trayHeight(t);
    expect(h).toBeGreaterThan(4);
    expect(5 + 0.35).toBeGreaterThan(h + 0.3);
  });

  it('keeps the spring-arm hub printable and gentle on the disc', () => {
    for (const fit of Object.values(HUB)) {
      // Grips the 15 mm hole with a slight preload; the lip reaches over the disc edge.
      expect(GRIP_R).toBeGreaterThan(DISC_HOLE_R);
      expect(GRIP_R - DISC_HOLE_R).toBeLessThan(0.1);
      expect(fit.lip).toBeGreaterThanOrEqual(0.2);
      // Gaps a 0.4 mm nozzle can print: arm root to plate rim, post inside the arm tip.
      expect(HUB_HOLE_R - (ARM_ROOT_R + fit.arm / 2)).toBeGreaterThanOrEqual(0.5);
      expect(POST_IN_R).toBeLessThan(ARM_TIP_R - fit.arm / 2);
      // Bending strain of the arms (about 3*y*t / 2L^2) far below PLA's ~2.5%.
      const L = ((ARM_ROOT_R + ARM_TIP_R) / 2) * ARM_SWEEP;
      expect((1.5 * (GRIP_R - DISC_HOLE_R + fit.lip) * fit.arm) / L ** 2).toBeLessThan(0.01);
    }
  });

  it('knows what each assembly step is about', () => {
    expect(stepHighlight('asm.cutMarks')).toBe('cut');
    expect(stepHighlight('asm.scoreFolds')).toBe('folds');
    expect(stepHighlight('asm.tray.fold')).toBe('folds');
    expect(stepHighlight('asm.sleeve.glue')).toBe('glue');
    expect(stepHighlight('asm.dvd.insert')).toBe('none');
  });

  it('composes a PDF with A4 pages', async () => {
    const project = sampleProject();
    project.print.duplex = 'long';
    const plan = buildPrintPlan(project, STRINGS);
    const bytes = await composePdf(plan, {
      title: 'test',
      renderFace: async (img) => {
        const w = Math.max(1, Math.round(img.rect.w));
        const h = Math.max(1, Math.round(img.rect.h));
        const raw = new Uint8Array(w * h * 3);
        for (let i = 0; i < w * h; i++) { raw[i * 3] = (i % w) * 255 / w; raw[i * 3 + 1] = 120; raw[i * 3 + 2] = 200; }
        return { kind: 'deflate-rgb', bytes: zlibSync(raw), width: w, height: h };
      },
    });
    expect(bytes.length).toBeGreaterThan(1000);
    if (process.env.COVERFOLD_SAMPLE_OUT) {
      writeFileSync(process.env.COVERFOLD_SAMPLE_OUT, bytes);
      writeFileSync(`${process.env.COVERFOLD_SAMPLE_OUT}.plan.json`, JSON.stringify(plan, null, 1));
    }
  });

  it('maps text to WinAnsi', () => {
    expect(toWinAnsi('Città – “ok” → ✓')).toBe('Città – “ok” -> ?');
  });
});

describe('phase 2 templates', () => {
  it('build the expected sizes', () => {
    expect(buildDieline('bluray.wrap', {})).toMatchObject({ w: 269, h: 148 });
    expect(buildDieline('jewel.obi', {})).toMatchObject({ w: 71, h: 120 });
    // Cardboard wraps grow by the board thickness (0.35 mm) on spines and walls.
    const near = (d: { w: number; h: number }, w: number, h: number) => { expect(d.w).toBeCloseTo(w); expect(d.h).toBeCloseTo(h); };
    near(buildDieline('digipak.4p', {}), 281.35, 125.5);
    near(buildDieline('digipak.4p', { thick: 0 }), 281, 125.5);
    near(buildDieline('jewel.ocard', {}), 142.5, 281.4);
    near(buildDieline('sleeve.slipcase', {}), 259.05, 155.7);
  });

  it('every template fits on A4 sheets with bleed, whole or in parts', () => {
    for (const t of TEMPLATES) {
      const parts = expandForPrint([makePiece(t.id)], { printerMargin: 4, margin: 8.5, minMargin: 3 });
      for (const p of parts) {
        const d = buildDieline(p.templateId, p.params);
        const r = impose([{ key: p.id, paper: 'paper', w: d.w, h: d.h, margin: 8.5, minMargin: 3 }], 4);
        expect(r.tooLarge, p.id).toHaveLength(0);
      }
    }
  });

  it('extends an upside-down image on its own edges', () => {
    const d = buildDieline('jewel.ocard', {});
    const back = d.panels.find((p) => p.id === 'back')!;
    const img = makeImageLayer('a', 'a', 1000, 1000, { ...back.rect });
    img.rotation = 180;
    img.clip = { panelId: 'back' };
    // Back panel: left/right are cut edges, top/bottom are folds.
    expect(autoExtension(img, d, 'outside', 3)).toEqual({ left: 3, right: 3, top: 0, bottom: 0 });
    const rotated = { ...img, rotation: 90, w: back.rect.h, h: back.rect.w, x: back.rect.x + (back.rect.w - back.rect.h) / 2, y: back.rect.y + (back.rect.h - back.rect.w) / 2 };
    // Turned a quarter: the visual left/right edges are the layer's top/bottom.
    expect(autoExtension(rotated, d, 'outside', 3)).toEqual({ left: 0, right: 0, top: 3, bottom: 3 });
  });
});
