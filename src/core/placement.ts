// Putting layers on panels. A layer fitted to a panel gets the panel (plus bleed
// on its cut edges) as its box and the picture is framed inside it (core/crop),
// so nothing is hidden by an invisible clip.
// Older projects clipped an oversized picture to its panel instead. Those count
// as filling the panel; fitting or moving them converts them and keeps exactly
// the part of the picture that showed.
import { layerBounds } from './align';
import { cropControls, cropFor, cropOf, shownAspect, type Crop } from './crop';
import type { Rect } from './geometry';
import { panelBleedRect, panelSafeRect, type FitMode } from './layout';
import type { ImageLayer, Layer } from './model';
import type { PanelDef } from './templates/types';

/** How far (mm) a box may be off a panel's edges and still count as filling it. */
export const FILL_TOLERANCE = 0.6;

/** Panels a picture can sensibly fill: visible and at least 20 mm on each side (not spines or edges). */
export const isPicturePanel = (p: PanelDef) => p.labelKey !== 'panel.hidden' && p.rect.w >= 20 && p.rect.h >= 20;

const quarter = (deg: number) => Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-3;
const norm = (deg: number) => ((Math.round(deg * 1000) / 1000) % 360 + 360) % 360;

function targetRect(p: PanelDef, mode: FitMode, bleed: number): Rect {
  return mode === 'cover-bleed' ? panelBleedRect(p, bleed) : mode === 'cover-trim' ? p.rect : panelSafeRect(p);
}

const sameRect = (a: Rect, b: Rect, tol = FILL_TOLERANCE) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.x + a.w - b.x - b.w) <= tol && Math.abs(a.y + a.h - b.y - b.h) <= tol;

const covers = (a: Rect, b: Rect, tol = FILL_TOLERANCE) =>
  a.x <= b.x + tol && a.y <= b.y + tol && a.x + a.w >= b.x + b.w - tol && a.y + a.h >= b.y + b.h - tol;

/** Kinds of layer that fill a panel (text and codes are placed, never stretched). */
const fillable = (l: Layer) => (l.type === 'image' && !l.mask) || l.type === 'fill' || l.type === 'shape';

/**
 * How a layer fills a panel: its box is the panel plus bleed, or the panel
 * itself; an older clipped picture that covers the panel counts too. Null for
 * anything else (a smaller picture, text, a turned box).
 */
export function filledMode(l: Layer, p: PanelDef, bleed: number): 'cover-bleed' | 'cover-trim' | null {
  if (!fillable(l) || !quarter(l.rotation)) return null;
  const box = layerBounds(l);
  if (sameRect(box, panelBleedRect(p, bleed))) return 'cover-bleed';
  if (sameRect(box, p.rect)) return 'cover-trim';
  if (l.clip?.panelId === p.id && covers(box, panelBleedRect(p, bleed))) return 'cover-bleed';
  return null;
}

/**
 * Crop of the part of a picture that falls inside `rect` (trim coordinates),
 * for boxes turned by quarter turns. Returns the crop and the visible size
 * in the picture's own orientation.
 */
export function visibleCrop(l: ImageLayer, rect: Rect): { crop: Crop; w: number; h: number } {
  const b = layerBounds(l);
  const x0 = Math.max(rect.x, b.x), x1 = Math.min(rect.x + rect.w, b.x + b.w);
  const y0 = Math.max(rect.y, b.y), y1 = Math.min(rect.y + rect.h, b.y + b.h);
  // Sheet to local box coordinates: undo the layer's turn around its centre.
  const a = (-norm(l.rotation) * Math.PI) / 180;
  const cos = Math.round(Math.cos(a)), sin = Math.round(Math.sin(a));
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  const local = (x: number, y: number) => ({ x: l.w / 2 + (x - cx) * cos - (y - cy) * sin, y: l.h / 2 + (x - cx) * sin + (y - cy) * cos });
  const p = local(x0, y0), q = local(x1, y1);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  let u0 = clamp(Math.min(p.x, q.x), l.w) / l.w, u1 = clamp(Math.max(p.x, q.x), l.w) / l.w;
  let v0 = clamp(Math.min(p.y, q.y), l.h) / l.h, v1 = clamp(Math.max(p.y, q.y), l.h) / l.h;
  // A mirrored picture runs the other way inside its box.
  if (l.flipX) [u0, u1] = [1 - u1, 1 - u0];
  if (l.flipY) [v0, v1] = [1 - v1, 1 - v0];
  const c = cropOf(l);
  return {
    crop: { x: c.x + c.w * u0, y: c.y + c.h * v0, w: c.w * (u1 - u0), h: c.h * (v1 - v0) },
    w: (u1 - u0) * l.w,
    h: (v1 - v0) * l.h,
  };
}

/** Zoom and pan of the picture; for an older clipped one, of the part inside `from`. */
function framing(l: ImageLayer, from: Rect | null) {
  if (!from) return cropControls(l);
  const v = visibleCrop(l, from);
  return cropControls({ ...l, w: v.w, h: v.h, crop: v.crop });
}

/** Box of the given proportions, as large as fits in `r`, centred. */
function containIn(r: Rect, aspect: number): Rect {
  const w = Math.min(r.w, r.h * aspect), h = w / aspect;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

export interface FitOptions {
  /** The panel the layer fills now (its visible part is kept when it is an older clipped picture). */
  from?: PanelDef;
  /** Start from the middle of the picture instead of keeping zoom and pan (a new picture). */
  centre?: boolean;
}

/**
 * Patch that fits a layer to a panel, turned the way the panel reads. For
 * pictures the cover modes make the box the panel and frame the picture in it
 * (keeping zoom and pan); contain-safe shows the framed picture whole. Shaped
 * pictures keep their shape. Backgrounds and shapes take the panel's box.
 */
export function fitPatch(l: Layer, p: PanelDef, mode: FitMode, bleed: number, o: FitOptions = {}): Partial<Layer> {
  const target = targetRect(p, mode, bleed);
  const turn = { rotation: p.orientation ?? 0, clip: null };
  if (l.type === 'image') {
    if (l.mask) return { ...containIn(target, l.w / l.h), ...turn };
    if (mode === 'contain-safe') return { ...containIn(target, shownAspect(l)), ...turn };
    const old = o.from && l.clip?.panelId === o.from.id ? panelBleedRect(o.from, bleed) : null;
    const f = o.centre ? { zoom: 1, panX: 0, panY: 0 } : framing(l, old);
    const crop = cropFor(target.w / target.h, l.naturalW / l.naturalH, f.zoom, f.panX, f.panY);
    return { ...target, crop, ...turn };
  }
  if (l.type === 'fill' || l.type === 'shape') return { ...(mode === 'contain-safe' ? panelSafeRect(p) : target), ...turn };
  // Text and codes: keep their size, centred in the panel.
  return { x: target.x + (target.w - l.w) / 2, y: target.y + (target.h - l.h) / 2, rotation: l.rotation, clip: l.clip ? { panelId: p.id } : null };
}

/**
 * Patch that moves a layer to another panel. A layer that fills its panel
 * fills the new one the same way; anything else keeps its size and its
 * place relative to the panel (mirrored onto an upside-down panel).
 */
export function movePatch(l: Layer, from: PanelDef | undefined, to: PanelDef, bleed: number): Partial<Layer> {
  const mode = from ? filledMode(l, from, bleed) : null;
  if (mode) return fitPatch(l, to, mode, bleed, { from });
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  let u = from ? (cx - from.rect.x) / from.rect.w : 0.5;
  let v = from ? (cy - from.rect.y) / from.rect.h : 0.5;
  let rotation = l.rotation;
  if (norm((to.orientation ?? 0) - (from?.orientation ?? 0)) === 180) {
    u = 1 - u;
    v = 1 - v;
    rotation = norm(rotation + 180);
  }
  const ncx = to.rect.x + u * to.rect.w, ncy = to.rect.y + v * to.rect.h;
  return { x: ncx - l.w / 2, y: ncy - l.h / 2, rotation, clip: l.clip ? { panelId: to.id } : null };
}
