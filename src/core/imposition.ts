import type { Rect } from './geometry';
import { A4 } from './units';
import type { PaperKind } from './templates/types';

export interface ImposeItem {
  key: string;
  paper: PaperKind;
  /** Trim size of the piece (mm). */
  w: number;
  h: number;
  /** Space wanted around the trim for bleed and marks (mm). */
  margin: number;
  /** Minimum space around the trim (the bleed). Used when the full margin does not fit. */
  minMargin: number;
}

export interface Placement {
  key: string;
  /** Top-left of the trim box on the sheet (mm). */
  x: number;
  y: number;
  /** Rotated 90 deg clockwise on the sheet. */
  rotated: boolean;
  /** Margin actually reserved around the trim. */
  margin: number;
}

export interface Sheet {
  paper: PaperKind;
  placements: Placement[];
  /** Union of footprints, useful to find free space for labels. */
  used: Rect;
}

export interface ImposeResult {
  sheets: Sheet[];
  /** Items whose trim does not fit in the printable area at all. */
  tooLarge: string[];
}

interface Candidate { x: number; y: number; w: number; h: number; rotated: boolean; score: number }

/** MaxRects bin (Best Short Side Fit). Coordinates are relative to the printable area. */
class Bin {
  free: Rect[];
  placed: { key: string; rect: Rect; rotated: boolean; margin: number }[] = [];
  constructor(public w: number, public h: number) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  find(w: number, h: number): Candidate | null {
    let best: Candidate | null = null;
    for (const f of this.free) {
      for (const [cw, ch, rotated] of [[w, h, false], [h, w, true]] as const) {
        if (cw <= f.w + 1e-6 && ch <= f.h + 1e-6) {
          const score = Math.min(f.w - cw, f.h - ch);
          if (!best || score < best.score || (score === best.score && f.y < best.y)) best = { x: f.x, y: f.y, w: cw, h: ch, rotated, score };
        }
      }
    }
    return best;
  }

  place(key: string, c: Candidate, margin: number) {
    const used: Rect = { x: c.x, y: c.y, w: c.w, h: c.h };
    this.placed.push({ key, rect: used, rotated: c.rotated, margin });
    const next: Rect[] = [];
    for (const f of this.free) {
      if (used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y) {
        next.push(f);
        continue;
      }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
      if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
    }
    // Drop degenerate rectangles and those contained in another one (keep the first of duplicates).
    const contains = (b: Rect, a: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    this.free = next.filter((a, i) => {
      if (a.w <= 0.01 || a.h <= 0.01) return false;
      return !next.some((b, j) => j !== i && contains(b, a) && (j < i || !same(a, b)));
    });
  }
}

/** True when a w x h trim with `margin` all round fits the printable area of an A4 sheet. */
export function fitsSheet(w: number, h: number, printerMargin: number, margin: number): boolean {
  const W = A4.w - 2 * printerMargin, H = A4.h - 2 * printerMargin;
  const fw = w + 2 * margin, fh = h + 2 * margin;
  return (fw <= W + 1e-6 && fh <= H + 1e-6) || (fh <= W + 1e-6 && fw <= H + 1e-6);
}

/** Largest margin (<= wanted) that lets a w x h trim fit in a W x H area, in either orientation. */
function fittingMargin(w: number, h: number, W: number, H: number, wanted: number): number | null {
  const m0 = Math.min((W - w) / 2, (H - h) / 2);
  const m1 = Math.min((W - h) / 2, (H - w) / 2);
  const m = Math.max(m0, m1);
  if (m < 0) return null;
  return Math.min(wanted, m);
}

/**
 * Packs pieces onto A4 portrait sheets, one paper kind per sheet, allowing
 * 90 deg rotation. Every footprint stays inside the printable area; each
 * sheet's content is then centred so the margins are even.
 */
export function impose(items: ImposeItem[], printerMargin: number): ImposeResult {
  const W = A4.w - 2 * printerMargin;
  const H = A4.h - 2 * printerMargin;
  const sheets: Sheet[] = [];
  const tooLarge: string[] = [];
  const papers: PaperKind[] = [];
  for (const it of items) if (!papers.includes(it.paper)) papers.push(it.paper);

  for (const paper of papers) {
    const group = items
      .filter((i) => i.paper === paper)
      .map((it) => {
        const m = fittingMargin(it.w, it.h, W, H, it.margin);
        return { it, margin: m };
      });
    for (const g of group) if (g.margin === null) tooLarge.push(g.it.key);
    const fits = group.filter((g): g is { it: ImposeItem; margin: number } => g.margin !== null);
    fits.sort((a, b) => (b.it.w + 2 * b.margin) * (b.it.h + 2 * b.margin) - (a.it.w + 2 * a.margin) * (a.it.h + 2 * a.margin));

    const bins: Bin[] = [];
    for (const { it, margin } of fits) {
      const fw = it.w + 2 * margin;
      const fh = it.h + 2 * margin;
      let target: { bin: Bin; c: Candidate } | null = null;
      for (const bin of bins) {
        const c = bin.find(fw, fh);
        if (c) { target = { bin, c }; break; }
      }
      if (!target) {
        const bin = new Bin(W, H);
        bins.push(bin);
        const c = bin.find(fw, fh);
        if (!c) { tooLarge.push(it.key); continue; }
        target = { bin, c };
      }
      target.bin.place(it.key, target.c, margin);
    }

    for (const bin of bins) {
      if (bin.placed.length === 0) continue;
      const minX = Math.min(...bin.placed.map((p) => p.rect.x));
      const minY = Math.min(...bin.placed.map((p) => p.rect.y));
      const maxX = Math.max(...bin.placed.map((p) => p.rect.x + p.rect.w));
      const maxY = Math.max(...bin.placed.map((p) => p.rect.y + p.rect.h));
      const dx = printerMargin + (W - (maxX - minX)) / 2 - minX;
      const dy = printerMargin + (H - (maxY - minY)) / 2 - minY;
      sheets.push({
        paper,
        placements: bin.placed.map((p) => ({ key: p.key, x: p.rect.x + dx + p.margin, y: p.rect.y + dy + p.margin, rotated: p.rotated, margin: p.margin })),
        used: { x: minX + dx, y: minY + dy, w: maxX - minX, h: maxY - minY },
      });
    }
  }
  return { sheets, tooLarge };
}
