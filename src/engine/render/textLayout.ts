// Text layout shared by the editor, the raster export and the vector (PDF)
// export: positions are computed once, in millimetres, from canvas metrics of
// the very same font files, so the three renderings line up.
import { PT_TO_MM, type TextLayer } from '../../core/model';
import type { Ctx2D } from './draw';

// Fonts are measured at 100x scale: some browsers round tiny font sizes.
export const TEXT_SCALE = 100;

/** `chars` (vector export only): each character's x, measured on the canvas, so the PDF places glyphs exactly. */
export interface TextRun { text: string; x: number; y: number; chars?: { text: string; x: number }[] }
export interface Leader { x1: number; x2: number; y: number }
export interface ArcGlyph { text: string; x: number; y: number; angle: number }

export interface TextLayout {
  /** Straight runs: left x and baseline y in box coordinates (mm). */
  runs: TextRun[];
  /** Dotted leaders of a tracklist (mm). */
  leaders: Leader[];
  /** Arc mode: one glyph per character, centred on (x, y), rotated by angle (rad). */
  glyphs: ArcGlyph[];
  /** Height of the text block (mm); arc text keeps its box. */
  height: number;
  sizeMm: number;
  letterSpacingMm: number;
  /** Distance from the em-box centre to the baseline (mm), for arc glyphs. */
  baselineShift: number;
}

export const fontString = (l: TextLayer) =>
  `${l.italic ? 'italic ' : ''}${l.fontWeight} ${l.fontSize * PT_TO_MM * TEXT_SCALE}px "${l.fontFamily}"`;

export const textMode = (l: TextLayer) => l.mode ?? 'plain';

/** Font and spacing for a layer, measured at TEXT_SCALE. Kerning is off so the PDF (no kerning) matches. */
export function applyFont(ctx: Ctx2D, l: TextLayer, letterSpacing = true): void {
  ctx.font = fontString(l);
  if ('fontKerning' in ctx) (ctx as { fontKerning: string }).fontKerning = 'none';
  if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = letterSpacing ? `${l.letterSpacing * l.fontSize * PT_TO_MM * TEXT_SCALE}px` : '0px';
}

const TRACK = /^(.*?)[\s.·…_-]*?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;

export function layoutText(ctx: Ctx2D, l: TextLayer, withChars = false): TextLayout {
  const size = l.fontSize * PT_TO_MM;
  const lh = size * l.lineHeight;
  const spacing = l.letterSpacing * size;
  ctx.save();
  applyFont(ctx, l);
  const width = (s: string) => ctx.measureText(s).width / TEXT_SCALE;
  const probe = ctx.measureText('Hg');
  const asc = (probe.fontBoundingBoxAscent ?? size * TEXT_SCALE * 0.8) / TEXT_SCALE;
  const desc = (probe.fontBoundingBoxDescent ?? size * TEXT_SCALE * 0.2) / TEXT_SCALE;
  const baseline = (i: number) => i * lh + (lh - (asc + desc)) / 2 + asc;
  const out: TextLayout = { runs: [], leaders: [], glyphs: [], height: 0, sizeMm: size, letterSpacingMm: spacing, baselineShift: (asc - desc) / 2 };
  const mode = textMode(l);

  if (mode === 'arc') {
    applyFont(ctx, l, false);
    const r = Math.max(1, l.arcRadius ?? Math.min(l.w, l.h) / 2 - size);
    const chars = [...l.text.replace(/\n/g, ' ')];
    const widths = chars.map((c) => width(c) + spacing);
    const total = widths.reduce((a, b) => a + b, 0);
    const top = (l.arcSide ?? 'top') === 'top';
    const cx = l.w / 2, cy = l.h / 2;
    let cum = 0;
    chars.forEach((c, i) => {
      const along = (cum + widths[i] / 2 - total / 2) / r;
      const a = top ? -Math.PI / 2 + along : Math.PI / 2 - along;
      out.glyphs.push({ text: c, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), angle: top ? a + Math.PI / 2 : a - Math.PI / 2 });
      cum += widths[i];
    });
    out.height = l.h;
    ctx.restore();
    return out;
  }

  const lines: { text: string; time?: string }[] = [];
  for (const para of l.text.split('\n')) {
    const m = mode === 'tracklist' ? TRACK.exec(para) : null;
    if (m) {
      lines.push({ text: m[1].trimEnd(), time: m[2] });
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > l.w) {
        lines.push({ text: line });
        line = word;
      } else line = next;
    }
    lines.push({ text: line });
  }

  lines.forEach((ln, i) => {
    const y = baseline(i);
    if (ln.time !== undefined) {
      const tw = width(ln.time);
      const titleW = width(ln.text);
      out.runs.push({ text: ln.text, x: 0, y });
      out.runs.push({ text: ln.time, x: l.w - tw, y });
      const gap = size * 0.6;
      if (l.w - tw - titleW > 3 * gap) out.leaders.push({ x1: titleW + gap, x2: l.w - tw - gap, y: y - size * 0.12 });
      return;
    }
    const w = width(ln.text);
    const x = l.align === 'center' ? (l.w - w) / 2 : l.align === 'right' ? l.w - w : 0;
    out.runs.push({ text: ln.text, x, y });
  });
  if (withChars) {
    for (const r of out.runs) {
      const chars = [...r.text.normalize('NFC')];
      let prefix = '';
      r.chars = chars.map((c) => {
        const x = r.x + width(prefix);
        prefix += c;
        return { text: c, x };
      });
    }
  }
  out.height = Math.max(1, lines.length) * lh;
  ctx.restore();
  return out;
}

/** Leader dots: dash pattern for round-capped dots (mm). */
export const leaderStyle = (sizeMm: number) => ({ width: sizeMm * 0.09, gap: sizeMm * 0.32 });

/**
 * Raster drawing in box coordinates (mm). All outline strokes go first, then
 * all fills, so neighbouring letters never cover each other's fill.
 */
export function drawTextLayout(ctx: Ctx2D, l: TextLayer, layout: TextLayout): void {
  const outline = l.outline && l.outline.width > 0 ? l.outline : null;
  ctx.save();
  const s = leaderStyle(layout.sizeMm);
  const leaders = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.setLineDash([0, s.gap]);
    for (const ld of layout.leaders) {
      ctx.beginPath();
      ctx.moveTo(ld.x1, ld.y);
      ctx.lineTo(ld.x2, ld.y);
      ctx.stroke();
    }
  };
  if (layout.leaders.length) {
    if (outline) leaders(s.width + 2 * outline.width, outline.color);
    leaders(s.width, l.color);
  }
  ctx.setLineDash([]);
  ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (outline) {
    ctx.strokeStyle = outline.color;
    ctx.lineWidth = 2 * outline.width * TEXT_SCALE;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
  }
  ctx.fillStyle = l.color;
  if (layout.glyphs.length) {
    applyFont(ctx, l, false);
    ctx.textAlign = 'center';
    const glyphs = (paint: (g: ArcGlyph) => void) => {
      for (const g of layout.glyphs) {
        ctx.save();
        ctx.translate(g.x * TEXT_SCALE, g.y * TEXT_SCALE);
        ctx.rotate(g.angle);
        paint(g);
        ctx.restore();
      }
    };
    if (outline) glyphs((g) => ctx.strokeText(g.text, 0, layout.baselineShift * TEXT_SCALE));
    glyphs((g) => ctx.fillText(g.text, 0, layout.baselineShift * TEXT_SCALE));
  } else {
    applyFont(ctx, l);
    if (outline) for (const r of layout.runs) ctx.strokeText(r.text, r.x * TEXT_SCALE, r.y * TEXT_SCALE);
    for (const r of layout.runs) ctx.fillText(r.text, r.x * TEXT_SCALE, r.y * TEXT_SCALE);
  }
  ctx.restore();
}
