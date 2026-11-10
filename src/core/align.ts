// Aligning layers to a panel, the piece or each other. Uses the rotated bounding
// box, so a turned spine title centres on what you see. Edges go to the safe
// area, so aligned text is never cut off.
import type { Rect } from './geometry';
import { facePanels, panelAt, panelSafeRect } from './layout';
import type { Layer, TextLayer } from './model';
import type { Dieline, PanelDef, Side } from './templates/types';

export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export const ALIGN_HOWS: AlignHow[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
export type AlignTo = 'panel' | 'piece' | 'selection';

/** Axis-aligned bounds of a layer as drawn (any rotation). */
export function layerBounds(l: Pick<Layer, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Rect {
  const a = (l.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = l.w * c + l.h * s, h = l.w * s + l.h * c;
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function unionRect(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Move that aligns `b`: its edges to `edges`, its centre to the centre of `centre`. */
export function alignDelta(b: Rect, how: AlignHow, edges: Rect, centre: Rect = edges): { dx: number; dy: number } {
  switch (how) {
    case 'left': return { dx: edges.x - b.x, dy: 0 };
    case 'right': return { dx: edges.x + edges.w - (b.x + b.w), dy: 0 };
    case 'hcenter': return { dx: centre.x + centre.w / 2 - (b.x + b.w / 2), dy: 0 };
    case 'top': return { dx: 0, dy: edges.y - b.y };
    case 'bottom': return { dx: 0, dy: edges.y + edges.h - (b.y + b.h) };
    case 'vcenter': return { dx: 0, dy: centre.y + centre.h / 2 - (b.y + b.h / 2) };
  }
}

/** The panel a layer belongs to: the one it is clipped to, else the one under its centre. */
export function layerPanel(l: Layer, d: Dieline, side: Side): PanelDef | undefined {
  if (l.clip) {
    const p = facePanels(d, side).find((x) => x.id === l.clip!.panelId);
    if (p) return p;
  }
  const b = layerBounds(l);
  return panelAt(d, side, b.x + b.w / 2, b.y + b.h / 2);
}

/** Safe margin of the whole piece: the smallest of its panels, 3 mm if none. */
function pieceSafe(d: Dieline, side: Side): number {
  const m = facePanels(d, side).map((p) => p.safe);
  return m.length ? Math.min(...m) : 3;
}

export interface AlignTarget {
  to: AlignTo;
  panel?: PanelDef;
  edges: Rect;
  centre: Rect;
}

/**
 * Where `to` points for these layers. 'panel' falls back to the piece when
 * the first layer sits on no panel; 'selection' needs two layers or more.
 */
export function alignTarget(layers: Layer[], to: AlignTo, d: Dieline, side: Side): AlignTarget {
  if (to === 'selection' && layers.length > 1) {
    const u = unionRect(layers.map(layerBounds));
    return { to, edges: u, centre: u };
  }
  if (to === 'panel' && layers.length) {
    const p = layerPanel(layers[0], d, side);
    if (p) return { to, panel: p, edges: panelSafeRect(p), centre: p.rect };
  }
  const s = pieceSafe(d, side);
  return { to: 'piece', edges: { x: s, y: s, w: Math.max(0, d.w - 2 * s), h: Math.max(0, d.h - 2 * s) }, centre: { x: 0, y: 0, w: d.w, h: d.h } };
}

type TextAlign = TextLayer['align'];

/**
 * Paragraph alignment that makes the letters, not just their box, line up:
 * "align left" also sets the text flush left. It follows the reading direction,
 * so on a spine turned 90 deg "top" means flush left. Curved text, tracklists
 * and slanted text are left alone.
 */
export function textAlignFor(l: Layer, how: AlignHow): TextAlign | undefined {
  if (l.type !== 'text' || (l.mode ?? 'plain') !== 'plain') return undefined;
  const q = ((Math.round(l.rotation / 90) % 4) + 4) % 4;
  if (Math.abs(l.rotation - Math.round(l.rotation / 90) * 90) > 0.5) return undefined;
  // Visual side where reading starts and ends, per quarter turn.
  const start: AlignHow = (['left', 'top', 'right', 'bottom'] as const)[q];
  const end: AlignHow = (['right', 'bottom', 'left', 'top'] as const)[q];
  const middle: AlignHow = q % 2 ? 'vcenter' : 'hcenter';
  return how === start ? 'left' : how === end ? 'right' : how === middle ? 'center' : undefined;
}

export interface AlignMove { id: string; x: number; y: number; align?: TextAlign }

/** Each layer moves on its own and keeps its size; texts also get the matching paragraph alignment. */
export function alignLayers(layers: Layer[], how: AlignHow, target: AlignTarget): AlignMove[] {
  return layers.map((l) => {
    const { dx, dy } = alignDelta(layerBounds(l), how, target.edges, target.centre);
    const align = textAlignFor(l, how);
    return { id: l.id, x: l.x + dx, y: l.y + dy, ...(align && l.type === 'text' && align !== l.align ? { align } : {}) };
  });
}
