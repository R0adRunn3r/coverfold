import {
  applyMatrix, clipLine, distanceToOutline, distToSegment, flattenPath, multiply, pointInPath, rotateQuarter, transformLine, transformPath, translate,
  type LineSeg, type Matrix, type Path, type Point, type Rect,
} from './geometry';
import { stepHighlight, type StepHighlight } from './assembly';
import { expandForPrint, partOf, sourcePieceId, splitFor } from './expand';
import type { PartRange } from './split';
import { faceHasContent } from './faces';
import { impose, type ImposeItem } from './imposition';
import type { Piece, PrintSettings, Project } from './model';
import { assemblyKeysOf, buildDieline, getTemplate } from './templates/catalog';
import type { Dieline, PaperKind, Side } from './templates/types';
import { A4 } from './units';

export type RGB = [number, number, number];

export interface FaceRef { pieceId: string; side: Side }

export interface PlannedImage {
  face: FaceRef;
  /** Clockwise quarter turns applied to the face before placing it. */
  quarter: 0 | 1 | 2 | 3;
  /** Bleed box on the sheet (mm, y down). */
  rect: Rect;
}

export interface PlannedLine extends LineSeg { width: number; color: RGB; dash?: number[] }
/** `halo`: width of a white line drawn underneath, so the line stays visible on dark artwork. */
export interface PlannedPath { path: Path; width: number; color: RGB; dash?: number[]; halo?: number }
export interface PlannedText {
  x: number; y: number; size: number; text: string; color: RGB; align: 'left' | 'center' | 'right';
  /** Bold face, and a filled box behind the text (readable over artwork). */
  bold?: boolean; bg?: RGB;
  /** Turned a quarter anticlockwise: reads from bottom to top (beside an upright ruler). */
  upright?: boolean;
}

export interface SheetPage {
  kind: 'sheet';
  sheetIndex: number;
  face: 'front' | 'back';
  paper: PaperKind;
  images: PlannedImage[];
  lines: PlannedLine[];
  paths: PlannedPath[];
  texts: PlannedText[];
}

/** Small drawing of the flat piece for an instructions section: one per highlighted step. */
export interface InstructionDiagram { dieline: Dieline; steps: StepHighlight[]; seams?: PartRange[] }

export interface InstructionsPage {
  kind: 'instructions';
  title: string;
  sections: { heading: string; items: string[]; numbered: boolean; diagram?: InstructionDiagram }[];
}

export type PlannedPage = SheetPage | InstructionsPage;

export interface PrintStrings {
  /** Placeholders: {n} {total} {paper} {face} */
  sheetLabel: string;
  front: string;
  back: string;
  paper: Record<PaperKind, string>;
  pieceName: Record<string, string>;
  /** Assembly step texts by i18n key (see assemblyKeysOf). */
  assembly: Record<string, string>;
  instructionsTitle: string;
  sheetsHeading: string;
  /** Placeholders: {n} {paper} {pieces} */
  sheetLine: string;
  generalHeading: string;
  general: string[];
  rulerCaption: string;
  /** Caption of the 50 mm ruler, used when the 100 mm one does not fit. */
  rulerCaptionShort: string;
  /** Placeholders: {name} {n} {total} */
  partName: string;
  /** Placeholder: {name} */
  joinHeading: string;
  joinSteps: string[];
}

export interface PrintPlan {
  pages: PlannedPage[];
  sheetCount: number;
  /** Pieces that cannot fit the printable area of an A4 sheet. */
  tooLarge: string[];
  /** Pieces placed with less room than wanted for marks. */
  tight: string[];
  /** Pieces with an inside design that will not be printed (duplex off). */
  insideIgnored: string[];
  /** Pieces as printed (booklets expanded into spreads, wide pieces into parts); faces reference these ids. */
  pieces: Piece[];
  /** Pieces printed in several parts joined by glue tabs. */
  split: { pieceId: string; parts: number }[];
  /** The ruler was asked for but no sheet has room for it. */
  rulerMissing: boolean;
}

const BLACK: RGB = [0, 0, 0];
const MARK_GRAY: RGB = [0.25, 0.25, 0.25];
const CUT_GRAY: RGB = [0.2, 0.2, 0.2];
const LABEL_GRAY: RGB = [0.45, 0.45, 0.45];
const MARK_WIDTH = 0.15;
const CUT_WIDTH = 0.1;
const CUT_HALO = 0.3;
const MARK_LEN = 5;
/** Crop marks shorter than this are dropped: too short to align a ruler on. */
const MIN_MARK = 1.5;
/** Straight cut edges shorter than this get no crop marks (the cut line is enough). */
const MIN_MARKED_EDGE = 15;
const FOLD_DASH = [1.2, 0.8];


export const piecePaper = (p: Piece): PaperKind => p.paper ?? getTemplate(p.templateId).paper;

const markOffset = (bleed: number) => bleed + 0.5;

/** Footprint margin wanted around each trim: bleed + gap + crop mark. */
export const wantedMargin = (s: PrintSettings) => (s.cropMarks || s.foldMarks || s.cutLine !== 'never' ? markOffset(s.bleed) + MARK_LEN : s.bleed);

/** Matrix mapping piece trim coordinates (outside face) to sheet coordinates. */
export function placementMatrix(d: Dieline, x: number, y: number, rotated: boolean): Matrix {
  return rotated ? multiply(translate(x + d.h, y), rotateQuarter(1)) : translate(x, y);
}

const quarterOf = (m: Matrix): 0 | 1 | 2 | 3 => {
  if (m[0] > 0.5) return 0;
  if (m[1] > 0.5) return 1;
  if (m[0] < -0.5) return 2;
  return 3;
};

function boxOnSheet(m: Matrix, r: Rect): Rect {
  const pts = [
    applyMatrix(m, { x: r.x, y: r.y }), applyMatrix(m, { x: r.x + r.w, y: r.y }),
    applyMatrix(m, { x: r.x, y: r.y + r.h }), applyMatrix(m, { x: r.x + r.w, y: r.y + r.h }),
  ];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Maps inside face coordinates to back page coordinates. The inside view is
 * the outside mirrored horizontally, and turning the sheet over mirrors the
 * page again (around the long or short edge), so the result is a pure
 * rotation and the inside artwork needs no mirroring.
 */
function backMatrix(front: Matrix, d: Dieline, duplex: 'long' | 'short', offX: number, offY: number): Matrix {
  const mirrorPiece: Matrix = [-1, 0, 0, 1, d.w, 0];
  const flipPage: Matrix = duplex === 'long' ? [-1, 0, 0, 1, A4.w, 0] : [1, 0, 0, -1, 0, A4.h];
  return multiply(translate(offX, offY), multiply(flipPage, multiply(front, mirrorPiece)));
}

interface PlacedPiece { piece: Piece; d: Dieline; m: Matrix; margin: number; trimOnSheet: Rect; footprint: Rect; regionPolys: Point[][] }

const segLength = (l: LineSeg) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
const inRect = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/**
 * Straight horizontal/vertical edges of a cut outline, collinear runs merged.
 * Crop marks extend these edges beyond the artwork: on a rectangle they are
 * the classic eight corner marks; shaped pieces get them on their long
 * straight sides, wherever the extension stays clear of the piece.
 */
export function straightEdges(cut: Path, minLen = MIN_MARKED_EDGE): LineSeg[] {
  const out: LineSeg[] = [];
  let sub: LineSeg[] = [];
  let start: Point | null = null;
  let last: Point | null = null;
  const axis = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;
  const sameDir = (a: LineSeg, b: LineSeg) => {
    const la = segLength(a) || 1, lb = segLength(b) || 1;
    return Math.abs((a.x2 - a.x1) / la - (b.x2 - b.x1) / lb) < 1e-6 && Math.abs((a.y2 - a.y1) / la - (b.y2 - b.y1) / lb) < 1e-6;
  };
  const add = (a: Point, b: Point, breakRun = false) => {
    if (breakRun || !axis(a, b) || (a.x === b.x && a.y === b.y)) { sub.push({ x1: NaN, y1: NaN, x2: NaN, y2: NaN }); return; }
    const seg = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const prev = sub[sub.length - 1];
    if (prev && !Number.isNaN(prev.x1) && prev.x2 === a.x && prev.y2 === a.y && sameDir(prev, seg)) { prev.x2 = b.x; prev.y2 = b.y; } else sub.push(seg);
  };
  const flush = () => {
    // The closing run may continue the first one (outline starting mid-edge).
    const first = sub[0], lastSeg = sub[sub.length - 1];
    if (sub.length > 1 && first && lastSeg && !Number.isNaN(first.x1) && !Number.isNaN(lastSeg.x1)
      && lastSeg.x2 === first.x1 && lastSeg.y2 === first.y1 && sameDir(lastSeg, first)) {
      first.x1 = lastSeg.x1; first.y1 = lastSeg.y1;
      sub.pop();
    }
    for (const s of sub) if (!Number.isNaN(s.x1) && segLength(s) >= minLen) out.push(s);
    sub = [];
  };
  for (const s of cut) {
    if (s.t === 'M') { flush(); start = last = { x: s.x, y: s.y }; }
    else if (s.t === 'L') { if (last) add(last, s); last = { x: s.x, y: s.y }; }
    else if (s.t === 'C') { if (last) add(last, s, true); last = { x: s.x, y: s.y }; }
    else { if (last && start) add(last, start); last = start; }
  }
  flush();
  return out;
}

/** The two extensions of a line beyond its ends, from `offset` to `offset + len`. */
function extensions(l: LineSeg, offset: number, len: number): LineSeg[] {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n, uy = dy / n;
  return [
    { x1: l.x1 - ux * offset, y1: l.y1 - uy * offset, x2: l.x1 - ux * (offset + len), y2: l.y1 - uy * (offset + len) },
    { x1: l.x2 + ux * offset, y1: l.y2 + uy * offset, x2: l.x2 + ux * (offset + len), y2: l.y2 + uy * (offset + len) },
  ];
}

/** The join step that glues the tabs (print.join3): its diagram shows the seams. */
const JOIN_GLUE_STEP = 2;

/** Letter that pairs a glue tab with the part that goes on it: A, B, C... */
export const seamLetter = (i: number) => String.fromCharCode(65 + i);

const format = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

export function buildPrintPlan(project: Project, strings: PrintStrings): PrintPlan {
  const s = project.print;
  const bleed = s.bleed;
  const duplex = s.duplex;
  const margin = wantedMargin(s);
  const offset = markOffset(bleed);

  const items: ImposeItem[] = [];
  const insideIgnored: string[] = [];
  const pieceByKey = new Map<string, Piece>();
  const fit = { printerMargin: s.printerMargin, margin, minMargin: bleed };
  const printPieces = expandForPrint(project.pieces, fit);
  const sourceTemplate = new Map(project.pieces.map((p) => [p.id, p.templateId]));
  const nameOf = (p: Piece) => {
    const name = strings.pieceName[sourceTemplate.get(sourcePieceId(p.id)) ?? p.templateId] ?? '';
    const part = partOf(p);
    return part ? format(strings.partName, { name, n: part.index + 1, total: part.count }) : name;
  };
  const split = new Map<string, number>();
  for (const p of printPieces) {
    const part = partOf(p);
    if (part) split.set(sourcePieceId(p.id), part.count);
  }
  // Seam letters are unique in the whole project: two split pieces on one sheet never share one.
  const letterBase = new Map<string, number>();
  let seams = 0;
  for (const [id, parts] of split) {
    letterBase.set(id, seams);
    seams += parts - 1;
  }
  const letterOf = (p: Piece, seam: number) => seamLetter((letterBase.get(sourcePieceId(p.id)) ?? 0) + seam);
  for (const piece of printPieces) {
    const d = buildDieline(piece.templateId, piece.params);
    if (!faceHasContent(piece, 'outside') && !faceHasContent(piece, 'inside')) continue;
    if (duplex === 'none' && faceHasContent(piece, 'inside')) insideIgnored.push(sourcePieceId(piece.id));
    for (let c = 0; c < Math.max(1, piece.copies); c++) {
      const key = `${piece.id}#${c}`;
      pieceByKey.set(key, piece);
      items.push({ key, paper: piecePaper(piece), w: d.w, h: d.h, margin, minMargin: bleed });
    }
  }

  const { sheets, tooLarge } = impose(items, s.printerMargin);
  const tight: string[] = [];
  const pages: PlannedPage[] = [];
  const printable: Rect = { x: s.printerMargin, y: s.printerMargin, w: A4.w - 2 * s.printerMargin, h: A4.h - 2 * s.printerMargin };

  const placedOf = sheets.map((sheet) => sheet.placements.map((pl): PlacedPiece => {
    const piece = pieceByKey.get(pl.key)!;
    const d = buildDieline(piece.templateId, piece.params);
    const m = placementMatrix(d, pl.x, pl.y, pl.rotated);
    const trimOnSheet = boxOnSheet(m, { x: 0, y: 0, w: d.w, h: d.h });
    return { piece, d, m, margin: pl.margin, trimOnSheet, footprint: grow(trimOnSheet, pl.margin), regionPolys: flattenPath(transformPath(d.cut, m)) };
  }));
  // The calibration ruler goes on a printed sheet, wherever there is room
  // (never on the instructions page, which may not be printed at all).
  const ruler = s.ruler ? placeRuler(printable, placedOf.map((pl) => pl.map((p) => p.footprint))) : null;

  sheets.forEach((sheet, si) => {
    const placed = placedOf[si];
    const front: SheetPage = { kind: 'sheet', sheetIndex: si, face: 'front', paper: sheet.paper, images: [], lines: [], paths: [], texts: [] };
    const back: SheetPage = { kind: 'sheet', sheetIndex: si, face: 'back', paper: sheet.paper, images: [], lines: [], paths: [], texts: [] };

    const obstacles: Rect[] = [];
    if (ruler?.sheet === si) {
      front.lines.push(...rulerLines(ruler.x + 2 * (ruler.vertical ? 0 : 1), ruler.y + (ruler.vertical ? 2 : 0), ruler.length, ruler.vertical));
      const caption = ruler.length === 100 ? strings.rulerCaption : strings.rulerCaptionShort;
      front.texts.push(ruler.vertical
        ? { x: ruler.x + 7.5, y: ruler.y + 2 + ruler.length / 2, size: 6, text: caption, color: LABEL_GRAY, align: 'center', upright: true }
        : { x: ruler.x + 2 + ruler.length / 2, y: ruler.y + 7.5, size: 6, text: caption, color: LABEL_GRAY, align: 'center' });
      obstacles.push(rulerBox(ruler));
    }
    // The sheet label goes in the free band above or below the content, clear of the ruler.
    const bottomBand = { y: sheet.used.y + sheet.used.h, h: printable.y + printable.h - (sheet.used.y + sheet.used.h) };
    const topBand = { y: printable.y, h: sheet.used.y - printable.y };
    const label = format(strings.sheetLabel, { n: si + 1, total: sheets.length, paper: strings.paper[sheet.paper], face: strings.front });
    const labelBox = (y: number): Rect => ({ x: A4.w / 2 - 45, y: y - 2.6, w: 90, h: 3.6 });
    const labelYs = [...(bottomBand.h >= topBand.h ? [bottomBand, topBand] : [topBand, bottomBand])]
      .filter((b) => b.h >= 4)
      .flatMap((b) => [b.y + b.h / 2 + 1, b.y + 3.2, b.y + b.h - 0.8]);
    const labelY = labelYs.find((y) => !obstacles.some((o) => overlaps(labelBox(y), o, 0.5)));
    if (labelY !== undefined) {
      front.texts.push({ x: A4.w / 2, y: labelY, size: 6, text: label, color: LABEL_GRAY, align: 'center' });
      obstacles.push(labelBox(labelY));
    }

    // Marks stay off artwork (any piece's bleed), other pieces' footprints (where
    // their own marks go), the label, the ruler and the unprintable border. Each
    // mark is clipped on its own, so a piece squeezed in one direction keeps its
    // marks in the other. Marks never cross: a '+' would read as a registration mark.
    const drawn: LineSeg[] = [];
    const freeFor = (owner: PlacedPiece) => (p: Point) =>
      p.x >= printable.x && p.x <= printable.x + printable.w && p.y >= printable.y && p.y <= printable.y + printable.h &&
      !obstacles.some((r) => inRect(p, r)) &&
      drawn.every((l) => distToSegment(p, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }) > 0.6) &&
      placed.every((pp) => (pp === owner || !inRect(p, pp.footprint)) && !pointInPath(p, pp.regionPolys) && distanceToOutline(p, pp.regionPolys) > bleed + 0.3);
    /** Draws the usable part of each mark; returns how many marks were usable. */
    const drawMarks = (marks: LineSeg[], owner: PlacedPiece, style: Omit<PlannedLine, keyof LineSeg>) => {
      const free = freeFor(owner);
      let usable = 0;
      for (const l of marks) {
        const kept = clipLine(l, free).filter((c) => segLength(c) >= 1);
        if (kept.reduce((a, c) => a + segLength(c), 0) < MIN_MARK) continue;
        usable++;
        for (const c of kept) {
          front.lines.push({ ...c, ...style });
          drawn.push(c);
        }
      }
      return usable;
    };

    for (const pp of placed) {
      const { piece, d, m } = pp;
      const bleedRect: Rect = { x: -bleed, y: -bleed, w: d.w + 2 * bleed, h: d.h + 2 * bleed };
      if (faceHasContent(piece, 'outside') || !faceHasContent(piece, 'inside') || duplex === 'none') {
        front.images.push({ face: { pieceId: piece.id, side: 'outside' }, quarter: quarterOf(m), rect: boxOnSheet(m, bleedRect) });
      }
      if (duplex !== 'none' && faceHasContent(piece, 'inside')) {
        const bm = backMatrix(m, d, duplex, s.backOffsetX, s.backOffsetY);
        back.images.push({ face: { pieceId: piece.id, side: 'inside' }, quarter: quarterOf(bm), rect: boxOnSheet(bm, bleedRect) });
      }
    }

    // Crop marks on every long straight cut edge (the 8 corner marks of a
    // rectangle). A rectangle needs all of them to be cut with a ruler; when the
    // sheet edge swallows some, or for shaped pieces, a thin cut line is added.
    // All crop marks go first: fold ticks give way to them.
    const complete = new Map<PlacedPiece, boolean>();
    if (s.cropMarks) {
      for (const pp of placed) {
        const marks = straightEdges(pp.d.cut).flatMap((e) => extensions(transformLine(e, pp.m), offset, MARK_LEN));
        const usable = drawMarks(marks, pp, { width: MARK_WIDTH, color: BLACK });
        complete.set(pp, pp.d.rectangular && usable === marks.length);
        if (pp.d.rectangular && usable < marks.length) tight.push(sourcePieceId(pp.piece.id));
      }
    }
    if (s.foldMarks) {
      for (const pp of placed) {
        drawMarks(pp.d.folds.flatMap((f) => extensions(transformLine(f, pp.m), offset, MARK_LEN)), pp, { width: MARK_WIDTH, color: MARK_GRAY, dash: FOLD_DASH });
      }
    }
    for (const pp of placed) {
      const { d, m } = pp;
      const drawCut = s.cutLine === 'always' || (s.cutLine === 'auto' && !complete.get(pp));
      if (drawCut) {
        front.paths.push({ path: transformPath(d.cut, m), width: CUT_WIDTH, color: CUT_GRAY, halo: CUT_HALO });
        // Slits inside the piece (a closure tab goes in one): no crop mark can show them.
        for (const sl of d.slits ?? []) front.paths.push({ path: transformPath(sl, m), width: CUT_WIDTH, color: CUT_GRAY, halo: CUT_HALO });
        if (d.panels.some((p) => p.shape === 'disc')) {
          const c = applyMatrix(m, { x: d.w / 2, y: d.h / 2 });
          front.lines.push({ x1: c.x - 3, y1: c.y, x2: c.x + 3, y2: c.y, width: MARK_WIDTH, color: MARK_GRAY });
          front.lines.push({ x1: c.x, y1: c.y - 3, x2: c.x, y2: c.y + 3, width: MARK_WIDTH, color: MARK_GRAY });
        }
      }
    }

    // Split pieces: a letter on each glue tab, and the same letter beside the
    // edge of the next part that goes on it (when there is room).
    for (const pp of placed) {
      const part = partOf(pp.piece);
      if (!part) continue;
      const tab = pp.d.panels.find((p) => p.labelKey === 'panel.glueTab');
      const letterStyle = { size: 9, color: BLACK, align: 'center' as const, bold: true, bg: [1, 1, 1] as RGB };
      if (tab) {
        const c = applyMatrix(pp.m, { x: tab.rect.x + tab.rect.w / 2, y: tab.rect.y + tab.rect.h / 2 });
        front.texts.push({ ...letterStyle, x: c.x, y: c.y + 1.2, text: letterOf(pp.piece, part.index) });
      }
      if (part.index > 0) {
        const c = applyMatrix(pp.m, { x: -bleed - 3, y: pp.d.h / 2 });
        const free = freeFor(pp);
        if ([-2.5, 0, 2.5].every((dy) => [-2.5, 2.5].every((dx) => free({ x: c.x + dx, y: c.y + dy })))) {
          front.texts.push({ ...letterStyle, x: c.x, y: c.y + 1.2, text: letterOf(pp.piece, part.index - 1) });
        }
      }
    }

    pages.push(front);
    if (back.images.length > 0) pages.push(back);
  });

  if (s.instructions) {
    const sections: InstructionsPage['sections'] = [];
    sections.push({
      heading: strings.sheetsHeading,
      numbered: false,
      items: sheets.map((sh, i) => format(strings.sheetLine, {
        n: i + 1,
        paper: strings.paper[sh.paper],
        pieces: [...new Set(sh.placements.map((p) => nameOf(pieceByKey.get(p.key)!)))].join(', '),
      })),
    });
    sections.push({ heading: strings.generalHeading, numbered: false, items: strings.general });
    // One section per kind of piece and its steps (a digipak with a tray and one with a pocket differ).
    const seen = new Set<string>();
    for (const piece of project.pieces) {
      const steps = assemblyKeysOf(piece.templateId, piece.params);
      const kind = `${piece.templateId}|${steps.join()}`;
      if (seen.has(kind) || !items.some((it) => sourcePieceId(pieceByKey.get(it.key)!.id) === piece.id)) continue;
      seen.add(kind);
      sections.push({
        heading: strings.pieceName[piece.templateId] ?? piece.templateId,
        numbered: true,
        items: steps.map((k) => strings.assembly[k] ?? k),
        diagram: { dieline: buildDieline(piece.templateId, piece.params), steps: steps.map(stepHighlight) },
      });
    }
    // Joining comes before folding: one section per split piece.
    for (const [pieceId, parts] of split) {
      const piece = project.pieces.find((p) => p.id === pieceId);
      if (!piece) continue;
      const name = strings.pieceName[piece.templateId] ?? piece.templateId;
      const base = letterBase.get(pieceId) ?? 0;
      const letters = Array.from({ length: parts - 1 }, (_, i) => seamLetter(base + i)).join(', ');
      const idx = sections.findIndex((x) => x.heading === name);
      const d = buildDieline(piece.templateId, piece.params);
      const diagram: InstructionDiagram = { dieline: d, steps: strings.joinSteps.map((_, i) => (i === JOIN_GLUE_STEP ? 'seams' : 'none')), seams: splitFor(d, fit) ?? [] };
      const join = { heading: format(strings.joinHeading, { name }), numbered: true, items: strings.joinSteps.map((st) => format(st, { letters, parts })), diagram };
      if (idx >= 0) sections.splice(idx, 0, join);
      else sections.push(join);
    }
    pages.push({ kind: 'instructions', title: strings.instructionsTitle, sections });
  }

  return {
    pages,
    sheetCount: sheets.length,
    tooLarge: [...new Set(tooLarge.map((k) => sourcePieceId(pieceByKey.get(k)?.id ?? k)))],
    tight: [...new Set(tight)],
    insideIgnored: [...new Set(insideIgnored)],
    pieces: printPieces,
    split: [...split].map(([pieceId, parts]) => ({ pieceId, parts })),
    rulerMissing: s.ruler && !ruler && sheets.length > 0,
  };
}

/**
 * Calibration ruler starting at (x, y): baseline plus 5/10 mm ticks. Lying
 * down, the baseline runs right 4 mm below y and the ticks stand on it;
 * upright, the baseline runs down from (x, y) and the ticks point right.
 */
export function rulerLines(x: number, y: number, length = 100, vertical = false): PlannedLine[] {
  const line = (a: number, b: number, c: number, d: number): PlannedLine => (vertical
    ? { x1: x + 4 - b + y, y1: y + a - x, x2: x + 4 - d + y, y2: y + c - x, width: 0.2, color: BLACK }
    : { x1: a, y1: b, x2: c, y2: d, width: 0.2, color: BLACK });
  // Drawn lying down from (x, y), then turned for the upright ruler.
  const out: PlannedLine[] = [line(x, y + 4, x + length, y + 4)];
  for (let i = 0; i <= length / 5; i++) {
    const tx = x + i * 5;
    out.push(line(tx, y + 4, tx, y + 4 - (i % 2 === 0 ? 3 : 1.6)));
  }
  return out;
}

/** Where the ruler goes: its sheet, the top-left of its box, its length and whether it stands upright. */
export interface RulerSpot { sheet: number; x: number; y: number; length: 100 | 50; vertical: boolean }

/** The ruler with its caption: 2 mm past each end, 10 mm across (caption under it, or beside it upright). */
export const rulerBox = (r: Omit<RulerSpot, 'sheet'>): Rect =>
  r.vertical ? { x: r.x, y: r.y, w: 10, h: r.length + 4 } : { x: r.x, y: r.y, w: r.length + 4, h: 10 };

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * A free place for a box of w x h in `area`, at least 1 mm from every
 * obstacle (the pieces with the room their marks need): the free place
 * nearest to the middle of the area, on a 1 mm grid. Null when none.
 */
export function freeSpot(area: Rect, obstacles: Rect[], w: number, h: number): { x: number; y: number } | null {
  if (w > area.w || h > area.h) return null;
  const cx = area.x + (area.w - w) / 2, cy = area.y + (area.h - h) / 2;
  const xs = Array.from({ length: Math.floor(area.w - w) + 1 }, (_, i) => area.x + i).sort((a, b) => Math.abs(a - cx) - Math.abs(b - cx));
  const ys = Array.from({ length: Math.floor(area.h - h) + 1 }, (_, i) => area.y + i).sort((a, b) => Math.abs(a - cy) - Math.abs(b - cy));
  let best: { x: number; y: number; d: number } | null = null;
  for (const y of ys) {
    // Rows are visited from the middle outwards: once a row is farther than the best, nothing better is left.
    if (best && Math.abs(y - cy) > best.d) break;
    for (const x of xs) {
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (best && d >= best.d) break;
      const box = { x, y, w, h };
      if (obstacles.every((o) => !overlaps(box, o, 1))) { best = { x, y, d }; break; }
    }
  }
  return best && { x: best.x, y: best.y };
}

/**
 * Finds room for the ruler on the printed sheets: 100 mm lying down, then
 * upright, then a 50 mm one; the first sheet with room wins.
 */
export function placeRuler(printable: Rect, obstaclesBySheet: Rect[][]): RulerSpot | null {
  for (const length of [100, 50] as const) {
    for (const vertical of [false, true]) {
      const { w, h } = rulerBox({ x: 0, y: 0, length, vertical });
      for (let sheet = 0; sheet < obstaclesBySheet.length; sheet++) {
        const at = freeSpot(printable, obstaclesBySheet[sheet], w, h);
        if (at) return { sheet, ...at, length, vertical };
      }
    }
  }
  return null;
}
