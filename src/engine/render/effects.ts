// Layer effects shared by the editor and the export. Canvas shadows and
// filters are sized in device pixels, so millimetres are converted with the
// current transform: any zoom or DPI gives the same result on paper.
import type { Rect } from '../../core/geometry';
import { parseColor } from '../../core/color';
import { cropOf } from '../../core/crop';
import type { ImageLayer, ImageMask, Layer, Shadow } from '../../core/model';
import type { Ctx2D, DrawableImage } from './draw';

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const ctx2d = (c: AnyCanvas) => c.getContext('2d') as Ctx2D | null;

/** Device pixels per mm at the current transform. */
export function deviceScale(ctx: Ctx2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

/** Null when the layer has no shadow or a fully transparent one. */
export function activeShadow(l: Layer): Shadow | null {
  const s = l.shadow;
  if (!s) return null;
  const a = parseColor(s.color)?.a ?? 1;
  return a > 0.004 ? s : null;
}

export const blendOp = (l: Layer): GlobalCompositeOperation => (!l.blend || l.blend === 'normal' ? 'source-over' : l.blend);

/** Text with these effects cannot stay vector text in the PDF: it is rasterised. */
export const needsRaster = (l: Layer): boolean =>
  !!activeShadow(l) || blendOp(l) !== 'source-over' || (l.type === 'text' && !!l.outline && l.outline.width > 0);

/** Above this many pixels the shadow is skipped rather than risk running out of memory. */
const MAX_SHADOW_PIXELS = 160_000_000;

/**
 * `draw` works in local coordinates, inside `local`. It is drawn whole on a
 * scratch canvas in device space, then put down once with the shadow, so parts
 * of one layer (bleed patches, letters, outline and fill) never shadow each other.
 */
export function drawWithShadow(ctx: Ctx2D, s: Shadow, local: Rect, draw: (c: Ctx2D) => void): void {
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  const blurPx = Math.max(0, s.blur) * scale;
  const a = (s.angle * Math.PI) / 180;
  const lx = s.distance * Math.cos(a), ly = s.distance * Math.sin(a);
  const ox = m.a * lx + m.c * ly, oy = m.b * lx + m.d * ly;

  const corners = [[local.x, local.y], [local.x + local.w, local.y], [local.x, local.y + local.h], [local.x + local.w, local.y + local.h]]
    .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  // Only what can reach the canvas: the content itself or its shadow.
  const reach = Math.abs(ox) + Math.abs(oy) + 2 * blurPx;
  const x0 = Math.max(Math.floor(Math.min(...corners.map((p) => p[0]))), Math.floor(-reach));
  const y0 = Math.max(Math.floor(Math.min(...corners.map((p) => p[1]))), Math.floor(-reach));
  const x1 = Math.min(Math.ceil(Math.max(...corners.map((p) => p[0]))), Math.ceil(ctx.canvas.width + reach));
  const y1 = Math.min(Math.ceil(Math.max(...corners.map((p) => p[1]))), Math.ceil(ctx.canvas.height + reach));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const off = w * h <= MAX_SHADOW_PIXELS ? makeCanvas(w, h) : null;
  const oc = off && ctx2d(off);
  if (!off || !oc) {
    draw(ctx);
    return;
  }
  oc.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
  oc.imageSmoothingQuality = ctx.imageSmoothingQuality;
  oc.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  draw(oc);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = s.color;
  ctx.shadowBlur = blurPx;
  ctx.shadowOffsetX = ox;
  ctx.shadowOffsetY = oy;
  ctx.drawImage(off, x0, y0);
  ctx.restore();
  off.width = 0; // free the pixels now, not at the next GC
}

/** Per source image, the last two blurred versions (a slider drag reuses them). */
const blurCache = new WeakMap<object, { r: number; img: DrawableImage }[]>();

/** The image surrounded by mirrored copies, so blurring does not fade its edges. */
function mirrorPadded(img: DrawableImage, iw: number, ih: number, pad: number): AnyCanvas | null {
  const c = makeCanvas(iw + 2 * pad, ih + 2 * pad);
  const g = ctx2d(c);
  if (!g) return null;
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      g.save();
      g.translate(pad + sx * iw + (sx ? iw : 0), pad + sy * ih + (sy ? ih : 0));
      g.scale(sx ? -1 : 1, sy ? -1 : 1);
      g.drawImage(img, 0, 0, iw, ih);
      g.restore();
    }
  }
  return c;
}

/**
 * Gaussian blur, radius (standard deviation) in source pixels. The result has
 * the same size, so the layer draws it like the original.
 */
export function blurredImage(img: DrawableImage, radiusPx: number): DrawableImage {
  const r = Math.round(radiusPx * 4) / 4;
  const iw = img.width, ih = img.height;
  if (r < 0.25 || !iw || !ih) return img;
  const list = blurCache.get(img) ?? [];
  const hit = list.find((e) => e.r === r);
  if (hit) return hit.img;
  const pad = Math.min(Math.ceil(r * 3), iw, ih);
  const src = mirrorPadded(img, iw, ih, pad);
  const out = makeCanvas(iw, ih);
  const g = ctx2d(out);
  if (!src || !g || !('filter' in g)) return img; // no canvas filters: leave it sharp
  g.filter = `blur(${r}px)`;
  g.drawImage(src, -pad, -pad);
  src.width = 0;
  blurCache.set(img, [{ r, img: out }, ...list].slice(0, 2));
  return out;
}

/** The layer's blur (mm on paper) in source pixels. */
export const blurRadiusPx = (l: ImageLayer, img: DrawableImage): number => ((l.adjust.blur ?? 0) * img.width * cropOf(l).w) / Math.max(0.01, l.w);

export function clipToMask(ctx: Ctx2D, mask: ImageMask, w: number, h: number): void {
  ctx.beginPath();
  if (mask.shape === 'ellipse') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, w, h, Math.max(0, Math.min(mask.radius, w / 2, h / 2)));
  ctx.clip();
}
