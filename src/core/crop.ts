// Which part of the picture shows in an image layer's box. The crop is a rectangle
// in normalised picture coordinates (0-1) with the proportions of the box, so the
// picture is never distorted. Zoom and pan are the UI controls derived from it.
import type { ImageLayer } from './model';

export interface Crop { x: number; y: number; w: number; h: number }
export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const MAX_ZOOM = 4;

export const cropOf = (l: Pick<ImageLayer, 'crop'>): Crop => l.crop ?? FULL_CROP;

/** Same proportions within rounding: an upscaled picture can be a pixel off. */
export const sameProportions = (a: number, b: number): boolean => Math.abs(a / b - 1) < 0.005;

/** Largest crop with the box proportions, at zoom 1. */
function baseSize(boxAspect: number, imageAspect: number): { w: number; h: number } {
  const k = boxAspect / imageAspect; // crop w / crop h in normalised units
  return k >= 1 ? { w: 1, h: 1 / k } : { w: k, h: 1 };
}

/**
 * Crop for a zoom (>= 1) and a pan per axis: -1 shows the left/top edge of the
 * picture, 0 is centred, 1 shows the right/bottom edge.
 */
export function cropFor(boxAspect: number, imageAspect: number, zoom = 1, panX = 0, panY = 0): Crop {
  const b = baseSize(boxAspect, imageAspect);
  const z = Math.max(1, Math.min(MAX_ZOOM, zoom));
  const w = b.w / z, h = b.h / z;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const cx = 0.5 + (clamp(panX) * (1 - w)) / 2, cy = 0.5 + (clamp(panY) * (1 - h)) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Zoom and pan that give the layer's current crop (inverse of cropFor). */
export function cropControls(l: ImageLayer): { zoom: number; panX: number; panY: number; canPanX: boolean; canPanY: boolean } {
  const c = cropOf(l);
  const b = baseSize(l.w / l.h, l.naturalW / l.naturalH);
  const zoom = b.w / c.w;
  const pan = (pos: number, size: number) => (1 - size > 1e-6 ? (pos + size / 2 - 0.5) / ((1 - size) / 2) : 0);
  return { zoom, panX: pan(c.x, c.w), panY: pan(c.y, c.h), canPanX: 1 - c.w > 1e-6, canPanY: 1 - c.h > 1e-6 };
}

/** Picture pixels that land in the layer box (for print resolution). */
export function croppedPixels(l: Pick<ImageLayer, 'naturalW' | 'naturalH' | 'crop'>): { w: number; h: number } {
  const c = cropOf(l);
  return { w: l.naturalW * c.w, h: l.naturalH * c.h };
}

/** Proportions of what the layer shows (width / height). */
export const shownAspect = (l: Pick<ImageLayer, 'naturalW' | 'naturalH' | 'crop'>): number => {
  const p = croppedPixels(l);
  return p.w / p.h;
};

/**
 * Patch that turns an image into a centred circle: a square box (the smaller
 * side, same centre) showing the middle of the picture.
 */
export function circlePatch(l: ImageLayer): Partial<ImageLayer> {
  const side = Math.min(l.w, l.h);
  return {
    x: l.x + (l.w - side) / 2,
    y: l.y + (l.h - side) / 2,
    w: side,
    h: side,
    crop: cropFor(1, l.naturalW / l.naturalH),
    mask: { shape: 'ellipse', radius: 0 },
  };
}

export type CropSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Cropping by moving one side of the box: the picture keeps its scale and the
 * box shows more or less of it. `size` is the new width or height in mm,
 * clamped to the picture's edge and to 1 mm. A mirrored picture runs the other way.
 */
export function cropSide(l: Pick<ImageLayer, 'w' | 'h' | 'crop' | 'flipX' | 'flipY'>, side: CropSide, size: number): { crop: Crop; size: number } {
  const c = cropOf(l);
  const horizontal = side === 'left' || side === 'right';
  const per = horizontal ? c.w / l.w : c.h / l.h; // picture share per mm
  const pos = horizontal ? c.x : c.y, len = horizontal ? c.w : c.h;
  // Does the side that moves reach towards the picture's far end (right/bottom)?
  const flipped = horizontal ? l.flipX : l.flipY;
  const towardsEnd = (side === 'right' || side === 'bottom') !== flipped;
  const room = towardsEnd ? 1 - pos : pos + len; // picture available from the fixed side
  const s = Math.max(1, Math.min(size, room / per));
  const nl = s * per;
  const np = towardsEnd ? pos : pos + len - nl;
  return { size: s, crop: horizontal ? { ...c, x: np, w: nl } : { ...c, y: np, h: nl } };
}

/** Largest box size a side can reach before the picture ends (for the handles). */
export const maxCropSize = (l: Pick<ImageLayer, 'w' | 'h' | 'crop' | 'flipX' | 'flipY'>, side: CropSide): number => cropSide(l, side, Infinity).size;

/**
 * New proportions (width / height) for a picture's box: same centre, same
 * picture scale, about the same area, never past the picture's edges.
 * `null` means the picture's own proportions, showing all of it.
 */
export function aspectPatch(l: Pick<ImageLayer, 'x' | 'y' | 'w' | 'h' | 'naturalW' | 'naturalH' | 'crop'>, aspect: number | null): Partial<ImageLayer> {
  const c = cropOf(l);
  const area = l.w * l.h;
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  if (aspect === null) {
    const r = l.naturalW / l.naturalH;
    const w = Math.sqrt(area * r), h = w / r;
    return { x: cx - w / 2, y: cy - h / 2, w, h, crop: null };
  }
  const kx = c.w / l.w, ky = c.h / l.h; // picture share per mm (unchanged)
  let w = Math.sqrt(area * aspect), h = w / aspect;
  const s = Math.min(1, 1 / (w * kx), 1 / (h * ky));
  w *= s;
  h *= s;
  const cw = w * kx, ch = h * ky;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const crop = { x: clamp(c.x + c.w / 2 - cw / 2, 1 - cw), y: clamp(c.y + c.h / 2 - ch / 2, 1 - ch), w: cw, h: ch };
  return { x: cx - w / 2, y: cy - h / 2, w, h, crop };
}
