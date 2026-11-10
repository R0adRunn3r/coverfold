import { outerEdges } from './bleedShape';
import type { Rect } from './geometry';
import type { Layer } from './model';
import type { Dieline, PanelDef, Side } from './templates/types';

export const facePanels = (d: Dieline, side: Side): PanelDef[] => (side === 'inside' ? d.insidePanels : d.panels);

export const bleedBox = (d: Dieline, bleed: number): Rect => ({ x: -bleed, y: -bleed, w: d.w + 2 * bleed, h: d.h + 2 * bleed });

/** Panel rectangle grown by the bleed on every edge that is not a fold. */
export function panelBleedRect(p: PanelDef, bleed: number): Rect {
  const l = p.edges.left === 'fold' ? 0 : bleed;
  const r = p.edges.right === 'fold' ? 0 : bleed;
  const t = p.edges.top === 'fold' ? 0 : bleed;
  const b = p.edges.bottom === 'fold' ? 0 : bleed;
  return { x: p.rect.x - l, y: p.rect.y - t, w: p.rect.w + l + r, h: p.rect.h + t + b };
}

export function panelSafeRect(p: PanelDef): Rect {
  if (p.safeRect) return p.safeRect;
  return { x: p.rect.x + p.safe, y: p.rect.y + p.safe, w: Math.max(0, p.rect.w - 2 * p.safe), h: Math.max(0, p.rect.h - 2 * p.safe) };
}

export function findPanel(d: Dieline, side: Side, panelId: string): PanelDef | undefined {
  return facePanels(d, side).find((p) => p.id === panelId);
}

/** Panel whose trim rectangle contains the point (mm), if any. */
export function panelAt(d: Dieline, side: Side, x: number, y: number): PanelDef | undefined {
  return facePanels(d, side).find((p) => x >= p.rect.x && x <= p.rect.x + p.rect.w && y >= p.rect.y && y <= p.rect.y + p.rect.h);
}

export interface Extension { left: number; right: number; top: number; bottom: number }
export const NO_EXTENSION: Extension = { left: 0, right: 0, top: 0, bottom: 0 };

/** How far inside the trim (mm) an edge may stop and still count as reaching it. */
export const EDGE_SNAP_TOLERANCE = 1;

/**
 * Automatic bleed for an unrotated layer: every box edge that reaches a cut
 * (or flap) edge of a panel but stops short of the bleed line is extended up
 * to the bleed line. Edges that stop clearly inside the trim are left alone,
 * because a white margin there is a deliberate choice.
 */
export function autoExtension(layer: Layer, d: Dieline, side: Side, bleed: number): Extension {
  if (bleed <= 0 || !layer.visible) return NO_EXTENSION;
  if (layer.type === 'image' && (layer.bleedFill === 'none' || layer.mask)) return NO_EXTENSION;
  if (layer.type === 'text' || layer.type === 'qr') return NO_EXTENSION;
  // Quarter turns only: the extension is computed on the visual box and then
  // mapped back to the layer's own (unrotated) edges.
  const rot = ((layer.rotation % 360) + 360) % 360;
  const q = Math.round(rot / 90) % 4;
  if (Math.abs(rot - Math.round(rot / 90) * 90) > 0.01) return NO_EXTENSION;

  const panels = layer.clip ? facePanels(d, side).filter((p) => p.id === layer.clip!.panelId) : facePanels(d, side);
  // Boundaries the artwork must bleed past: every non-fold panel edge, plus
  // the outer edges of the piece for unclipped layers (glue flaps, disc rim).
  const bounds: Rect[] = panels.map((p) => p.rect);
  const kinds = panels.map((p) => p.edges);
  if (!layer.clip) {
    bounds.push({ x: 0, y: 0, w: d.w, h: d.h });
    kinds.push(outerEdges(d));
  }
  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  const vw = q % 2 ? layer.h : layer.w, vh = q % 2 ? layer.w : layer.h;
  const box = { l: cx - vw / 2, r: cx + vw / 2, t: cy - vh / 2, b: cy + vh / 2 };
  const ext: Extension = { left: 0, right: 0, top: 0, bottom: 0 };
  const tol = EDGE_SNAP_TOLERANCE;
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.5;

  bounds.forEach((pr, i) => {
    const e = kinds[i];
    const pl = pr.x, prr = pr.x + pr.w, pt = pr.y, pb = pr.y + pr.h;
    if (e.right !== 'fold' && overlaps(box.t, box.b, pt, pb) && box.l < prr && box.r >= prr - tol && box.r < prr + bleed) {
      ext.right = Math.max(ext.right, prr + bleed - box.r);
    }
    if (e.left !== 'fold' && overlaps(box.t, box.b, pt, pb) && box.r > pl && box.l <= pl + tol && box.l > pl - bleed) {
      ext.left = Math.max(ext.left, box.l - (pl - bleed));
    }
    if (e.bottom !== 'fold' && overlaps(box.l, box.r, pl, prr) && box.t < pb && box.b >= pb - tol && box.b < pb + bleed) {
      ext.bottom = Math.max(ext.bottom, pb + bleed - box.b);
    }
    if (e.top !== 'fold' && overlaps(box.l, box.r, pl, prr) && box.b > pt && box.t <= pt + tol && box.t > pt - bleed) {
      ext.top = Math.max(ext.top, box.t - (pt - bleed));
    }
  });
  // Visual edges back to the layer's own edges (clockwise quarter turns).
  if (q === 1) return { top: ext.right, right: ext.bottom, bottom: ext.left, left: ext.top };
  if (q === 2) return { top: ext.bottom, right: ext.left, bottom: ext.top, left: ext.right };
  if (q === 3) return { top: ext.left, right: ext.top, bottom: ext.right, left: ext.bottom };
  return ext;
}

export type FitMode = 'cover-bleed' | 'cover-trim' | 'contain-safe';

/**
 * Box for an image of aspect `aspect` (w/h) fitted to a panel. The image is
 * never distorted: "cover" overflows the target and the panel clip hides the
 * excess.
 */
export function fitBox(p: PanelDef, mode: FitMode, aspect: number, bleed: number): Rect {
  const target = mode === 'cover-bleed' ? panelBleedRect(p, bleed) : mode === 'cover-trim' ? p.rect : panelSafeRect(p);
  const tAspect = target.w / target.h;
  const cover = mode !== 'contain-safe';
  let w: number, h: number;
  if (cover ? aspect > tAspect : aspect < tAspect) {
    h = target.h;
    w = h * aspect;
  } else {
    w = target.w;
    h = w / aspect;
  }
  return { x: target.x + (target.w - w) / 2, y: target.y + (target.h - h) / 2, w, h };
}
