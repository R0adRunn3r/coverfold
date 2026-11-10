// Pieces wider than an A4 sheet are printed in parts: the flat layout is cut
// along vertical folds (so the seam hides in a fold) and each part but the
// last gets a glue tab that slides under the next part. Parts are ordinary
// dielines, so imposition, rendering and marks need no special case.
import { flattenPath, type Path, type Point, type Rect } from './geometry';
import type { Dieline, EdgeKind, FoldDef, PanelDef } from './templates/types';

/** Width of the glue tab (mm). */
export const TAB_WIDTH = 12;
const EPS = 0.01;

/** A part of a split piece: x range [x0, x1] of the whole piece, plus a glue tab of width `tab` after x1. */
export interface PartRange { x0: number; x1: number; tab: number }

/** Part parameters stored on expanded print pieces (see `buildDieline`). */
export interface PartParams { __x0: number; __x1: number; __tab: number }
export const isPartParams = (p: Record<string, number>): boolean => p.__x1 !== undefined;

/** Vertical folds that run across the piece: the only places a seam may go. */
export function seamCandidates(d: Dieline): number[] {
  const xs = d.folds
    .filter((f) => Math.abs(f.x1 - f.x2) < EPS && Math.abs(f.y2 - f.y1) >= d.h * 0.5)
    .map((f) => f.x1)
    .filter((x) => x > EPS && x < d.w - EPS);
  return [...new Set(xs.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
}

/** Sutherland-Hodgman clipping to the vertical strip lo <= x <= hi. */
function clipStrip(poly: Point[], lo: number, hi: number): Point[] {
  const clipHalf = (pts: Point[], inside: (p: Point) => boolean, cut: (a: Point, b: Point) => Point) => {
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const atX = (x: number) => (a: Point, b: Point): Point => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  let p = clipHalf(poly, (q) => q.x >= lo - EPS, atX(lo));
  p = clipHalf(p, (q) => q.x <= hi + EPS, atX(hi));
  // Drop consecutive duplicates.
  return p.filter((q, i) => {
    const r = p[(i + p.length - 1) % p.length];
    return Math.abs(q.x - r.x) > 1e-6 || Math.abs(q.y - r.y) > 1e-6;
  });
}

const polyBBox = (pts: Point[]): Rect => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

function clippedOutline(d: Dieline, lo: number, hi: number): Point[][] {
  return flattenPath(d.cut, 16).map((poly) => {
    const closed = poly.length > 2 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) < 1e-6 ? poly.slice(0, -1) : poly;
    return clipStrip(closed, lo, hi);
  }).filter((p) => p.length >= 3);
}

/** Vertical extent of the outline along x (the edge a tab attaches to). */
function spanAt(polys: Point[][], x: number): [number, number] | null {
  const ys = polys.flat().filter((p) => Math.abs(p.x - x) < 1e-3).map((p) => p.y);
  return ys.length >= 2 ? [Math.min(...ys), Math.max(...ys)] : null;
}

/** Trapezoid glue tab on the right of x, over the span [y0, y1]. */
function tabPolygon(x: number, y0: number, y1: number, tab: number): Point[] {
  const c = Math.min(tab * 0.6, (y1 - y0) / 4);
  return [{ x, y: y0 }, { x: x + tab, y: y0 + c }, { x: x + tab, y: y1 - c }, { x, y: y1 }];
}

/** Size of a part (outline clipped to its range, plus its tab). */
export function partSize(d: Dieline, r: PartRange): { w: number; h: number } {
  const polys = clippedOutline(d, r.x0, r.x1);
  if (!polys.length) return { w: 0, h: 0 };
  const b = polyBBox(polys.flat());
  return { w: r.x1 - r.x0 + r.tab, h: b.h };
}

/**
 * Seams so that every part fits (`fits(w, h)`): fewest parts first, then the
 * most even widths. Null when the piece fits whole or cannot be split.
 */
export function splitRanges(d: Dieline, fits: (w: number, h: number) => boolean, tab = TAB_WIDTH): PartRange[] | null {
  if (fits(d.w, d.h)) return null;
  const xs = seamCandidates(d);
  let best: { ranges: PartRange[]; worst: number } | null = null;
  const choose = (k: number, from: number, picked: number[]) => {
    if (picked.length === k) {
      const cuts = [0, ...picked, d.w];
      const ranges = cuts.slice(0, -1).map((x0, i) => ({ x0, x1: cuts[i + 1], tab: i < k ? tab : 0 }));
      const sizes = ranges.map((r) => partSize(d, r));
      if (!sizes.every((s) => s.w > 0 && fits(s.w, s.h))) return;
      const worst = Math.max(...sizes.map((s) => s.w));
      if (!best || worst < best.worst - EPS) best = { ranges, worst };
      return;
    }
    for (let i = from; i < xs.length; i++) choose(k, i + 1, [...picked, xs[i]]);
  };
  for (let k = 1; k <= xs.length && !best; k++) choose(k, 0, []);
  return best ? (best as { ranges: PartRange[] }).ranges : null;
}

const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/**
 * Panels inside [lo, hi], shifted by `shift`. The edge at `cutAt` becomes a cut
 * (the seam: this part lies on the previous part's tab); at `tabAt` the panel
 * folds onto a glue tab whose panel keeps the id of the panel it continues, so
 * artwork clipped to that panel carries on over the tab.
 */
function clipPanels(panels: PanelDef[], lo: number, hi: number, shift: number, cutAt: 'lo' | 'hi' | null, tab: { at: 'lo' | 'hi'; w: number; y0: number; y1: number } | null): PanelDef[] {
  const out: PanelDef[] = [];
  for (const p of panels) {
    const a = Math.max(lo, p.rect.x), b = Math.min(hi, p.rect.x + p.rect.w);
    if (b - a <= EPS) continue;
    const edges = { ...p.edges };
    const touchesLo = near(a, lo), touchesHi = near(b, hi);
    if (touchesLo && (cutAt === 'lo')) edges.left = 'cut';
    if (touchesHi && (cutAt === 'hi')) edges.right = 'cut';
    if (touchesLo && tab?.at === 'lo') edges.left = 'fold';
    if (touchesHi && tab?.at === 'hi') edges.right = 'fold';
    const safe = p.safeRect && clipRect(p.safeRect, lo, hi, shift);
    out.push({ ...p, rect: { ...p.rect, x: a + shift, w: b - a }, edges, safeRect: p.safeRect ? safe ?? { ...p.safeRect, x: a + shift, w: 0 } : undefined });
  }
  if (tab) {
    // The panel continued by the tab: the first one beyond the seam.
    const edgeX = tab.at === 'hi' ? hi : lo;
    const beyond = panels.filter((p) => (tab.at === 'hi' ? near(p.rect.x, edgeX) : near(p.rect.x + p.rect.w, edgeX)));
    const src = beyond.sort((p, q) => q.rect.h - p.rect.h)[0];
    if (src) {
      const x = tab.at === 'hi' ? hi : lo - tab.w;
      const tabEdges: Record<'left' | 'right' | 'top' | 'bottom', EdgeKind> = tab.at === 'hi'
        ? { left: 'fold', right: 'cut', top: 'cut', bottom: 'cut' }
        : { left: 'cut', right: 'fold', top: 'cut', bottom: 'cut' };
      out.push({
        ...src, labelKey: 'panel.glueTab', labelVars: undefined, safe: 0, textRotation: undefined, orientation: undefined,
        rect: { x: x + shift, y: tab.y0, w: tab.w, h: tab.y1 - tab.y0 }, edges: tabEdges,
      });
    }
  }
  return out;
}

function clipRect(r: Rect, lo: number, hi: number, shift: number): Rect | null {
  const a = Math.max(lo, r.x), b = Math.min(hi, r.x + r.w);
  return b - a > EPS ? { ...r, x: a + shift, w: b - a } : null;
}

/** Open lines (slits) clipped to the strip lo <= x <= hi, shifted. */
function clipLines(lines: Path[], lo: number, hi: number, shift: number): Path[] {
  const out: Path[] = [];
  for (const line of lines) {
    const pts = line.filter((s) => s.t !== 'Z').map((s) => ({ x: (s as Point).x, y: (s as Point).y }));
    let cur: Point[] = [];
    const flush = () => {
      if (cur.length > 1) out.push(cur.map((p, i) => ({ t: (i === 0 ? 'M' : 'L') as 'M' | 'L', x: p.x + shift, y: p.y })));
      cur = [];
    };
    pts.forEach((p, i) => {
      const inside = p.x >= lo - EPS && p.x <= hi + EPS;
      const prev = pts[i - 1];
      if (prev) {
        const prevIn = prev.x >= lo - EPS && prev.x <= hi + EPS;
        if (prevIn !== inside) {
          const edge = inside ? (prev.x < lo ? lo : hi) : (p.x < lo ? lo : hi);
          const k = (edge - prev.x) / (p.x - prev.x);
          const q = { x: edge, y: prev.y + (p.y - prev.y) * k };
          if (inside) cur.push(q);
          else { cur.push(q); flush(); }
        }
      }
      if (inside) cur.push(p);
    });
    flush();
  }
  return out;
}

function clipFolds(folds: FoldDef[], lo: number, hi: number, shift: number, keepHi: boolean): FoldDef[] {
  const out: FoldDef[] = [];
  for (const f of folds) {
    if (near(f.x1, f.x2)) {
      const x = f.x1;
      if (x <= lo + EPS || x > hi + EPS || (near(x, hi) && !keepHi)) continue;
      out.push({ ...f, x1: x + shift, x2: x + shift });
    } else {
      const a = Math.max(lo, Math.min(f.x1, f.x2)), b = Math.min(hi, Math.max(f.x1, f.x2));
      if (b - a <= EPS) continue;
      out.push({ ...f, x1: a + shift, x2: b + shift });
    }
  }
  return out;
}

const toPath = (polys: Point[][]) => polys.flatMap((poly) => [
  ...poly.map((p, i) => ({ t: (i === 0 ? 'M' : 'L') as 'M' | 'L', x: p.x, y: p.y })),
  { t: 'Z' as const },
]);

/** Dieline of one part of a split piece, in its own coordinates (x0 becomes 0). */
export function partDieline(d: Dieline, r: PartRange): Dieline {
  const { x0, x1, tab } = r;
  const shift = -x0;
  let polys = clippedOutline(d, x0, x1);
  const span = tab > 0 ? spanAt(polys, x1) : null;
  const glue: Point[][] = d.glue.flatMap((g) => flattenPath(g).map((poly) => clipStrip(poly, x0, x1))).filter((p) => p.length >= 3);
  if (span) {
    const t = tabPolygon(x1, span[0], span[1], tab);
    // Replace the outline's edge on x = x1 with the tab.
    polys = polys.map((poly) => {
      const i = poly.findIndex((p, k) => {
        const q = poly[(k + 1) % poly.length];
        return Math.abs(p.x - x1) < 1e-3 && Math.abs(q.x - x1) < 1e-3 && Math.abs(q.y - p.y) > 1;
      });
      if (i < 0) return poly;
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const down = b.y > a.y;
      const mid = down ? [t[0], t[1], t[2], t[3]] : [t[3], t[2], t[1], t[0]];
      return [...poly.slice(0, i + 1), ...mid.slice(1, 3), ...poly.slice(i + 1)];
    });
    glue.push(t);
  }
  const shiftPoly = (poly: Point[]) => poly.map((p) => ({ x: p.x + shift, y: p.y }));
  polys = polys.map(shiftPoly);
  const w = x1 - x0 + (span ? tab : 0);
  const b = polyBBox(polys.flat());
  const tabInfo = span ? { w: tab, y0: span[0], y1: span[1] } : null;
  // The inside view mirrors the whole piece: x_in = W - x_out.
  const W = d.w;
  const e = x0 + w;
  const panels = clipPanels(d.panels, x0, x1, shift, x0 > EPS ? 'lo' : null, tabInfo && { at: 'hi', ...tabInfo });
  const insidePanels = clipPanels(d.insidePanels, W - x1, W - x0, -(W - e), x0 > EPS ? 'hi' : null, tabInfo && { at: 'lo', ...tabInfo });
  const rectangular = !span && polys.length === 1 && polys[0].length === 4 && polys[0].every((p) => (near(p.x, b.x) || near(p.x, b.x + b.w)) && (near(p.y, b.y) || near(p.y, b.y + b.h)));
  return {
    w,
    h: d.h,
    cut: toPath(polys),
    rectangular,
    panels,
    insidePanels,
    folds: clipFolds(d.folds, x0, x1, shift, !!span),
    glue: glue.map((g) => toPath([shiftPoly(g)])),
    slits: clipLines(d.slits ?? [], x0, x1, shift),
    safeGuides: [],
  };
}
