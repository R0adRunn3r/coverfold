import {
  LineCapStyle, PDFDocument, StandardFonts, appendBezierCurve, beginText, clip, clipEvenOdd, closePath, concatTransformationMatrix,
  degrees, drawObject, endPath, endText, fillEvenOdd, lineTo, moveTo, popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing, setDashPattern,
  setFillingRgbColor, setFontAndSize, setGraphicsState, setLineCap, setLineWidth, setStrokingRgbColor, setTextMatrix, showText, stroke,
  type PDFFont, type PDFOperator, type PDFPage,
} from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { StepHighlight } from '../assembly';
import { applyMatrix, multiply, rectPath, transformPath, translate, type Matrix, type Path, type Rect } from '../geometry';
import type { InstructionDiagram, InstructionsPage, PlannedImage, PlannedLine, PlannedPath, PlannedText, PrintPlan, SheetPage } from '../printPlan';
import { A4, mmToPt } from '../units';
import { toWinAnsi } from './winansi';

export { toWinAnsi } from './winansi';

export interface FontRef { family: string; weight: number; italic: boolean }

/** A text layer drawn as real PDF text over its face (positions from the shared text layout). */
export interface VectorText {
  font: FontRef;
  sizeMm: number;
  letterSpacingMm: number;
  color: [number, number, number];
  opacity: number;
  /** Baseline runs; `chars` gives each character's own x (preferred: exact canvas positions). */
  runs: { text: string; x: number; y: number; chars?: { text: string; x: number }[] }[];
  leaders: { x1: number; x2: number; y: number }[];
  leaderWidth: number;
  leaderGap: number;
  /** Box-local mm to face trim mm. */
  transform: Matrix;
  /** Panel clip in face trim mm, if any. */
  clip: Rect | null;
}

export type EncodedFace = (
  | { kind: 'jpeg'; bytes: Uint8Array }
  /** Raw 8-bit RGB pixels compressed in zlib format (FlateDecode), lossless. */
  | { kind: 'deflate-rgb'; bytes: Uint8Array; width: number; height: number }
) & {
  texts?: VectorText[];
  /** Face trim mm to bleed-box mm of the placed image (rotation included). */
  toBox?: Matrix;
  /** Bleed shape in face trim mm: vector text is clipped to it like the artwork. */
  clipPath?: Path;
};

export interface ComposeOptions {
  title: string;
  /** Renders one placed face; called sequentially so memory stays bounded. */
  renderFace: (img: PlannedImage, page: SheetPage) => Promise<EncodedFace>;
  /** TrueType/OpenType bytes of a font used by vector text. */
  loadFont?: (f: FontRef) => Promise<Uint8Array>;
  onProgress?: (done: number, total: number) => void;
}

const PAGE_W = mmToPt(A4.w);
const PAGE_H = mmToPt(A4.h);
const X = (mm: number) => mmToPt(mm);
const Y = (mm: number) => PAGE_H - mmToPt(mm);

function strokeOps(width: number, color: [number, number, number], dash?: number[]): PDFOperator[] {
  return [
    setLineWidth(mmToPt(width)),
    setStrokingRgbColor(color[0], color[1], color[2]),
    setDashPattern(dash ? dash.map(mmToPt) : [], 0),
  ];
}

function drawLine(page: PDFPage, l: PlannedLine) {
  page.pushOperators(pushGraphicsState(), ...strokeOps(l.width, l.color, l.dash), moveTo(X(l.x1), Y(l.y1)), lineTo(X(l.x2), Y(l.y2)), stroke(), popGraphicsState());
}

function pathOps(path: Path): PDFOperator[] {
  const ops: PDFOperator[] = [];
  for (const s of path) {
    if (s.t === 'M') ops.push(moveTo(X(s.x), Y(s.y)));
    else if (s.t === 'L') ops.push(lineTo(X(s.x), Y(s.y)));
    else if (s.t === 'C') ops.push(appendBezierCurve(X(s.x1), Y(s.y1), X(s.x2), Y(s.y2), X(s.x), Y(s.y)));
    else ops.push(closePath());
  }
  return ops;
}

function drawPath(page: PDFPage, p: PlannedPath) {
  if (p.halo) page.pushOperators(pushGraphicsState(), ...strokeOps(p.halo, [1, 1, 1]), ...pathOps(p.path), stroke(), popGraphicsState());
  page.pushOperators(pushGraphicsState(), ...strokeOps(p.width, p.color, p.dash), ...pathOps(p.path), stroke(), popGraphicsState());
}

function drawText(page: PDFPage, font: PDFFont, t: PlannedText) {
  const text = toWinAnsi(t.text);
  const w = font.widthOfTextAtSize(text, t.size);
  const x = t.align === 'center' ? X(t.x) - w / 2 : t.align === 'right' ? X(t.x) - w : X(t.x);
  if (t.bg) {
    const pad = t.size * 0.35;
    page.drawRectangle({ x: x - pad, y: Y(t.y) - t.size * 0.3, width: w + 2 * pad, height: t.size * 1.15, color: rgb(t.bg[0], t.bg[1], t.bg[2]) });
  }
  if (t.upright) {
    // Reads bottom to top: the baseline runs up from below the anchor, glyphs to its left.
    const along = t.align === 'center' ? w / 2 : t.align === 'right' ? w : 0;
    page.drawText(text, { x: X(t.x), y: Y(t.y) - along, size: t.size, font, color: rgb(t.color[0], t.color[1], t.color[2]), rotate: degrees(90) });
    return;
  }
  page.drawText(text, { x, y: Y(t.y), size: t.size, font, color: rgb(t.color[0], t.color[1], t.color[2]) });
}

/** Path operators in raw user units (the caller sets the CTM). */
function rawPathOps(path: Path): PDFOperator[] {
  return path.map((s) => (s.t === 'M' ? moveTo(s.x, s.y) : s.t === 'L' ? lineTo(s.x, s.y) : s.t === 'C' ? appendBezierCurve(s.x1, s.y1, s.x2, s.y2, s.x, s.y) : closePath()));
}

type FontCache = Map<string, Promise<PDFFont>>;

async function drawVectorTexts(doc: PDFDocument, page: PDFPage, img: PlannedImage, face: EncodedFace, fonts: FontCache, loadFont: ComposeOptions['loadFont']) {
  if (!face.texts?.length || !face.toBox || !loadFont) return;
  // mm (y down) to PDF points (y up), then face trim mm to sheet mm.
  const k = mmToPt(1);
  const m = multiply(translate(img.rect.x, img.rect.y), face.toBox);
  const ops: PDFOperator[] = [pushGraphicsState(), concatTransformationMatrix(k, 0, 0, -k, 0, PAGE_H), concatTransformationMatrix(...m)];
  if (face.clipPath) ops.push(...rawPathOps(face.clipPath), clipEvenOdd(), endPath());
  for (const t of face.texts) {
    const key = `${t.font.family}|${t.font.weight}|${t.font.italic}`;
    let fp = fonts.get(key);
    if (!fp) {
      // Glyphs are placed one by one (see below): OpenType substitutions such as
      // contextual alternates are not needed and would only give wrong widths.
      fp = loadFont(t.font).then((bytes) => doc.embedFont(bytes, { subset: false, features: { calt: false, liga: false, clig: false } }));
      fonts.set(key, fp);
    }
    const font = await fp;
    const fontName = page.node.newFontDictionary(font.name, font.ref);
    ops.push(pushGraphicsState());
    if (t.clip) {
      const c = t.clip;
      ops.push(moveTo(c.x, c.y), lineTo(c.x + c.w, c.y), lineTo(c.x + c.w, c.y + c.h), lineTo(c.x, c.y + c.h), closePath(), clip(), endPath());
    }
    ops.push(concatTransformationMatrix(...t.transform));
    if (t.opacity < 1) {
      const gs = doc.context.obj({ Type: 'ExtGState', ca: t.opacity, CA: t.opacity });
      ops.push(setGraphicsState(page.node.newExtGState('GS', doc.context.register(gs))));
    }
    ops.push(setFillingRgbColor(...t.color));
    if (t.leaders.length) {
      ops.push(setStrokingRgbColor(...t.color), setLineWidth(t.leaderWidth), setLineCap(LineCapStyle.Round), setDashPattern([0, t.leaderGap], 0));
      for (const l of t.leaders) ops.push(moveTo(l.x1, l.y), lineTo(l.x2, l.y), stroke());
    }
    ops.push(beginText(), setFontAndSize(fontName, t.sizeMm), setCharacterSpacing(t.letterSpacingMm));
    // The CTM is y-down: flip the text matrix so glyphs stand upright. Each
    // character goes where the canvas measured it, so the PDF matches the
    // preview whatever the embedded widths say.
    for (const r of t.runs) {
      if (!r.text) continue;
      if (r.chars) for (const c of r.chars) { if (c.text.trim()) ops.push(setTextMatrix(1, 0, 0, -1, c.x, r.y), showText(font.encodeText(c.text))); }
      else ops.push(setTextMatrix(1, 0, 0, -1, r.x, r.y), showText(font.encodeText(r.text)));
    }
    ops.push(endText(), popGraphicsState());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

async function drawFace(doc: PDFDocument, page: PDFPage, img: PlannedImage, face: EncodedFace) {
  const x = X(img.rect.x), y = Y(img.rect.y + img.rect.h), w = mmToPt(img.rect.w), h = mmToPt(img.rect.h);
  if (face.kind === 'jpeg') {
    const embedded = await doc.embedJpg(face.bytes);
    page.drawImage(embedded, { x, y, width: w, height: h });
    return;
  }
  const stream = doc.context.stream(face.bytes, {
    Type: 'XObject', Subtype: 'Image', Width: face.width, Height: face.height,
    ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
  });
  const ref = doc.context.register(stream);
  const name = page.node.newXObject('Im', ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, y), drawObject(name), popGraphicsState());
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of toWinAnsi(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const DIAGRAM_COLORS = {
  cut: [0.85, 0.18, 0.18] as [number, number, number],
  folds: [0.18, 0.44, 0.83] as [number, number, number],
  glue: [0.93, 0.55, 0.05] as [number, number, number],
  glueFill: [1, 0.86, 0.62] as [number, number, number],
  seams: [0.58, 0.2, 0.92] as [number, number, number],
  seamFill: [0.9, 0.82, 1] as [number, number, number],
};

/** The flat piece fitted in a box (mm), with the part a step is about in colour. */
function drawDiagram(page: PDFPage, box: Rect, diagram: InstructionDiagram, highlight: StepHighlight) {
  const d = diagram.dieline;
  const k = Math.min(box.w / d.w, box.h / d.h);
  const m: Matrix = [k, 0, 0, k, box.x + (box.w - d.w * k) / 2, box.y + (box.h - d.h * k) / 2];
  const ops: PDFOperator[] = [pushGraphicsState()];
  const fillPath = (p: Path, c: [number, number, number]) => ops.push(setFillingRgbColor(...c), ...pathOps(transformPath(p, m)), fillEvenOdd());
  const strokePath = (p: Path, width: number, c: [number, number, number], dash?: number[]) => ops.push(...strokeOps(width, c, dash), ...pathOps(transformPath(p, m)), stroke());
  fillPath(d.cut, [1, 1, 1]);
  if (highlight === 'glue') for (const g of d.glue) fillPath(g, DIAGRAM_COLORS.glueFill);
  if (highlight === 'seams') {
    for (const r of diagram.seams?.slice(0, -1) ?? []) {
      const span = d.panels.filter((p) => Math.abs(p.rect.x - r.x1) < 0.01);
      const y0 = Math.min(...span.map((p) => p.rect.y), 0), y1 = Math.max(...span.map((p) => p.rect.y + p.rect.h), d.h);
      fillPath(rectPath({ x: r.x1, y: y0, w: r.tab, h: y1 - y0 }), DIAGRAM_COLORS.seamFill);
    }
  }
  const lineFold = (f: { x1: number; y1: number; x2: number; y2: number }, width: number, c: [number, number, number], dash: number[]) => {
    const a = applyMatrix(m, { x: f.x1, y: f.y1 }), b = applyMatrix(m, { x: f.x2, y: f.y2 });
    ops.push(...strokeOps(width, c, dash), moveTo(X(a.x), Y(a.y)), lineTo(X(b.x), Y(b.y)), stroke());
  };
  for (const f of d.folds) lineFold(f, highlight === 'folds' ? 0.45 : 0.15, highlight === 'folds' ? DIAGRAM_COLORS.folds : [0.55, 0.55, 0.55], highlight === 'folds' ? [1.2, 0.8] : [0.8, 0.6]);
  if (highlight === 'glue') for (const g of d.glue) strokePath(g, 0.2, DIAGRAM_COLORS.glue);
  if (highlight === 'seams') for (const r of diagram.seams?.slice(0, -1) ?? []) lineFold({ x1: r.x1, y1: -2, x2: r.x1, y2: d.h + 2 }, 0.45, DIAGRAM_COLORS.seams, [1.2, 0.8]);
  strokePath(d.cut, highlight === 'cut' ? 0.5 : 0.2, highlight === 'cut' ? DIAGRAM_COLORS.cut : [0.35, 0.35, 0.35]);
  for (const sl of d.slits ?? []) strokePath(sl, highlight === 'cut' ? 0.5 : 0.2, highlight === 'cut' ? DIAGRAM_COLORS.cut : [0.35, 0.35, 0.35]);
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

function drawInstructions(doc: PDFDocument, regular: PDFFont, bold: PDFFont, ip: InstructionsPage) {
  const left = 18, right = A4.w - 18, bottom = A4.h - 18;
  const maxW = mmToPt(right - left);
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 22;
  const ensure = (needMm: number) => {
    if (y + needMm > bottom) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = 20;
    }
  };
  const text = (s: string, size: number, font: PDFFont, x = left) => page.drawText(s, { x: X(x), y: Y(y), size, font, color: rgb(0.1, 0.1, 0.1) });

  text(toWinAnsi(ip.title), 16, bold);
  y += 9;
  for (const sec of ip.sections) {
    ensure(10);
    text(toWinAnsi(sec.heading), 11, bold);
    y += 6;
    // One small drawing per step that is about cutting, folding, gluing or joining.
    const shown = sec.diagram ? sec.diagram.steps.map((h, i) => ({ h, i })).filter((x) => x.h !== 'none') : [];
    if (sec.diagram && shown.length) {
      const d = sec.diagram.dieline;
      const bw = 34, bh = Math.min(26, (bw * d.h) / d.w + 2), gap = 5;
      const perRow = Math.floor((right - left + gap) / (bw + gap));
      for (let r = 0; r < shown.length; r += perRow) {
        ensure(bh + 11);
        shown.slice(r, r + perRow).forEach(({ h, i }, c) => {
          const bx = left + c * (bw + gap);
          drawDiagram(page, { x: bx, y, w: bw, h: bh }, sec.diagram!, h);
          page.drawText(`${i + 1}`, { x: X(bx + bw / 2 - 0.8), y: Y(y + bh + 4), size: 8, font: bold, color: rgb(0.3, 0.3, 0.3) });
        });
        y += bh + 10;
      }
    }
    sec.items.forEach((item, i) => {
      const prefix = sec.numbered ? `${i + 1}.` : '•';
      const lines = wrap(item, regular, 9.5, maxW - mmToPt(6));
      ensure(lines.length * 4.6 + 1);
      text(prefix, 9.5, regular);
      for (const ln of lines) {
        text(ln, 9.5, regular, left + 6);
        y += 4.6;
      }
      y += 0.8;
    });
    y += 3;
  }
}

export async function composePdf(plan: PrintPlan, opts: ComposeOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(opts.title));
  doc.setCreator('Coverfold');
  doc.setProducer('Coverfold');
  const regular = doc.embedStandardFont(StandardFonts.Helvetica);
  const bold = doc.embedStandardFont(StandardFonts.HelveticaBold);
  doc.registerFontkit(fontkit);
  const fonts: FontCache = new Map();

  const total = plan.pages.reduce((n, p) => n + (p.kind === 'sheet' ? p.images.length : 0), 0);
  let done = 0;
  opts.onProgress?.(0, total);

  for (const p of plan.pages) {
    if (p.kind === 'instructions') {
      drawInstructions(doc, regular, bold, p);
      continue;
    }
    const page = doc.addPage([PAGE_W, PAGE_H]);
    for (const img of p.images) {
      const face = await opts.renderFace(img, p);
      await drawFace(doc, page, img, face);
      await drawVectorTexts(doc, page, img, face, fonts, opts.loadFont);
      opts.onProgress?.(++done, total);
    }
    for (const path of p.paths) drawPath(page, path);
    for (const l of p.lines) drawLine(page, l);
    for (const t of p.texts) drawText(page, t.bold ? bold : regular, t);
  }
  return doc.save({ useObjectStreams: true });
}
