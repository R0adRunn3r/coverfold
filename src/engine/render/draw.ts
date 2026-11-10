// Shared drawing code: the editor (Konva sceneFunc) and the export worker
// call the same functions, so what you see is what gets printed.
// All coordinates are millimetres; callers set the context transform.
import type { Path } from '../../core/geometry';
import { autoExtension, findPanel, panelBleedRect, type Extension } from '../../core/layout';
import type { Rect } from '../../core/geometry';
import { PT_TO_MM, type Gradient, type ImageLayer, type Layer, type QrLayer, type ShapeLayer } from '../../core/model';
import { cropOf } from '../../core/crop';
import { QR_QUIET, qrSide } from '../../core/qr';
import { layerQrMatrix } from '../../core/qrLayer';
import { qrLogoPlan } from '../../core/qrLogo';
import type { Dieline, Side } from '../../core/templates/types';
import { activeShadow, blendOp, blurRadiusPx, blurredImage, clipToMask, drawWithShadow } from './effects';
import { drawTextLayout, layoutText } from './textLayout';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type DrawableImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface DrawEnv {
  getImage(assetId: string): DrawableImage | null;
  bleed: number;
  dieline: Dieline;
  side: Side;
}

export function tracePath(ctx: Ctx2D, path: Path): void {
  ctx.beginPath();
  for (const s of path) {
    if (s.t === 'M') ctx.moveTo(s.x, s.y);
    else if (s.t === 'L') ctx.lineTo(s.x, s.y);
    else if (s.t === 'C') ctx.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y);
    else ctx.closePath();
  }
}

function drawPatch(ctx: Ctx2D, img: DrawableImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, flipH: boolean, flipV: boolean) {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  ctx.save();
  ctx.translate(dx + (flipH ? dw : 0), dy + (flipV ? dh : 0));
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  ctx.restore();
}

/**
 * Draws the `src` pixels over (0,0,w,h) plus generated bleed beyond the box:
 * "mirror" reflects the pixels next to the edge (seamless for photos),
 * "stretch" smears the last pixel row (flat colours).
 */
function drawImageWithBleed(ctx: Ctx2D, img: DrawableImage, src: Rect, w: number, h: number, ext: Extension, mode: 'mirror' | 'stretch') {
  const { x: x0, y: y0, w: iw, h: ih } = src;
  ctx.drawImage(img, x0, y0, iw, ih, 0, 0, w, h);
  const { left: l, right: r, top: t, bottom: b } = ext;
  if (!l && !r && !t && !b) return;
  const kx = iw / w, ky = ih / h; // source px per mm
  const mirror = mode === 'mirror';
  const sw = (mm: number) => (mirror ? Math.min(iw, Math.max(1, mm * kx)) : 1);
  const sh = (mm: number) => (mirror ? Math.min(ih, Math.max(1, mm * ky)) : 1);
  const x1 = x0 + iw, y1 = y0 + ih;
  if (l) drawPatch(ctx, img, x0, y0, sw(l), ih, -l, 0, l, h, mirror, false);
  if (r) drawPatch(ctx, img, x1 - sw(r), y0, sw(r), ih, w, 0, r, h, mirror, false);
  if (t) drawPatch(ctx, img, x0, y0, iw, sh(t), 0, -t, w, t, false, mirror);
  if (b) drawPatch(ctx, img, x0, y1 - sh(b), iw, sh(b), 0, h, w, b, false, mirror);
  if (l && t) drawPatch(ctx, img, x0, y0, sw(l), sh(t), -l, -t, l, t, mirror, mirror);
  if (r && t) drawPatch(ctx, img, x1 - sw(r), y0, sw(r), sh(t), w, -t, r, t, mirror, mirror);
  if (l && b) drawPatch(ctx, img, x0, y1 - sh(b), sw(l), sh(b), -l, h, l, b, mirror, mirror);
  if (r && b) drawPatch(ctx, img, x1 - sw(r), y1 - sh(b), sw(r), sh(b), w, h, r, b, mirror, mirror);
}

function filterFor(l: ImageLayer): string {
  const a = l.adjust;
  const parts: string[] = [];
  if (a.brightness) parts.push(`brightness(${1 + a.brightness / 100})`);
  if (a.contrast) parts.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation) parts.push(`saturate(${1 + a.saturation / 100})`);
  if (a.grayscale) parts.push('grayscale(1)');
  return parts.length ? parts.join(' ') : 'none';
}

/** A gradient spans the box 0..w x 0..h. */
export function paintFor(ctx: Ctx2D, color: string, g: Gradient | null | undefined, w: number, h: number): string | CanvasGradient {
  if (!g) return color;
  const cx = w / 2, cy = h / 2;
  let grad: CanvasGradient;
  if (g.kind === 'radial') {
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2);
  } else {
    // The gradient line crosses the whole box in the chosen direction.
    const a = (g.angle * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  grad.addColorStop(0, g.from);
  grad.addColorStop(1, g.to);
  return grad;
}

function drawShape(ctx: Ctx2D, l: ShapeLayer) {
  ctx.beginPath();
  if (l.shape === 'ellipse') ctx.ellipse(l.w / 2, l.h / 2, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
  else if (l.cornerRadius > 0 && 'roundRect' in ctx) ctx.roundRect(0, 0, l.w, l.h, Math.min(l.cornerRadius, l.w / 2, l.h / 2));
  else ctx.rect(0, 0, l.w, l.h);
  if (l.fill) {
    ctx.fillStyle = paintFor(ctx, l.fill, l.gradient, l.w, l.h);
    ctx.fill();
  }
  if (l.stroke && l.strokeWidth > 0) {
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    ctx.stroke();
  }
}

/**
 * QR modules as one path (adjacent squares filled together leave no hairline
 * seams), centred in the box with the quiet zone inside it.
 */
function drawQr(ctx: Ctx2D, l: QrLayer, env: DrawEnv) {
  const side = qrSide(l);
  const ox = (l.w - side) / 2, oy = (l.h - side) / 2;
  const m = layerQrMatrix(l);
  if (l.background) {
    ctx.fillStyle = l.background;
    ctx.fillRect(ox, oy, side, side);
  }
  if (!m) {
    // Nothing to encode (or too much): a crossed box marks the spot.
    ctx.strokeStyle = 'rgba(128,128,128,0.8)';
    ctx.lineWidth = side / 60;
    ctx.strokeRect(ox, oy, side, side);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + side, oy + side);
    ctx.moveTo(ox + side, oy);
    ctx.lineTo(ox, oy + side);
    ctx.stroke();
    return;
  }
  const cell = side / (m.size + 2 * QR_QUIET);
  const x0 = ox + QR_QUIET * cell, y0 = oy + QR_QUIET * cell;
  // Modules under the logo (and in the gap around it) are left out.
  const plan = l.logo ? qrLogoPlan(m, l.logo) : null;
  const on = (k: number) => m.dark[k] === 1 && !(plan && plan.cleared[k]);
  ctx.beginPath();
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!on(r * m.size + c)) { c++; continue; }
      const start = c;
      while (c < m.size && on(r * m.size + c)) c++;
      ctx.rect(x0 + start * cell, y0 + r * cell, (c - start) * cell, cell);
    }
  }
  ctx.fillStyle = l.color;
  ctx.fill('nonzero');
  if (plan && l.logo) {
    const { x, y, w, h } = plan.rect;
    const img = env.getImage(l.logo.assetId);
    if (img) ctx.drawImage(img, x0 + x * cell, y0 + y * cell, w * cell, h * cell);
    else {
      ctx.fillStyle = 'rgba(128,128,128,0.25)';
      ctx.fillRect(x0 + x * cell, y0 + y * cell, w * cell, h * cell);
    }
  }
}

function drawImageLayer(ctx: Ctx2D, layer: ImageLayer, env: DrawEnv, ext: Extension) {
  let img = env.getImage(layer.assetId);
  if (!img) {
    ctx.fillStyle = 'rgba(128,128,128,0.25)';
    ctx.fillRect(0, 0, layer.w, layer.h);
    return;
  }
  ctx.save();
  if (layer.mask) clipToMask(ctx, layer.mask, layer.w, layer.h);
  if (layer.adjust.blur) img = blurredImage(img, blurRadiusPx(layer, img));
  const c = cropOf(layer);
  const src = { x: c.x * img.width, y: c.y * img.height, w: c.w * img.width, h: c.h * img.height };
  const f = filterFor(layer);
  if (f !== 'none') ctx.filter = f;
  let e = ext;
  if (layer.flipX) {
    ctx.translate(layer.w, 0);
    ctx.scale(-1, 1);
    e = { ...e, left: e.right, right: e.left };
  }
  if (layer.flipY) {
    ctx.translate(0, layer.h);
    ctx.scale(1, -1);
    e = { ...e, top: e.bottom, bottom: e.top };
  }
  drawImageWithBleed(ctx, img, src, layer.w, layer.h, e, layer.bleedFill === 'stretch' ? 'stretch' : 'mirror');
  ctx.restore();
}

/** The layer's own pixels, without shadow or blend. */
function drawContent(ctx: Ctx2D, layer: Layer, env: DrawEnv, ext: Extension) {
  switch (layer.type) {
    case 'fill':
      // The gradient spans the layer box; the bleed beyond it simply continues it.
      ctx.fillStyle = paintFor(ctx, layer.color, layer.gradient, layer.w, layer.h);
      ctx.fillRect(-ext.left, -ext.top, layer.w + ext.left + ext.right, layer.h + ext.top + ext.bottom);
      break;
    case 'shape':
      drawShape(ctx, layer);
      break;
    case 'text':
      drawTextLayout(ctx, layer, layoutText(ctx, layer));
      break;
    case 'qr':
      drawQr(ctx, layer, env);
      break;
    case 'image':
      drawImageLayer(ctx, layer, env, ext);
      break;
  }
}

/** Where a layer's pixels can be, in its box coordinates (for the shadow's scratch canvas). */
function contentBounds(layer: Layer, ext: Extension): Rect {
  let pad = 0.5;
  if (layer.type === 'text') pad += layer.fontSize * PT_TO_MM + (layer.outline?.width ?? 0);
  if (layer.type === 'shape' && layer.stroke) pad += layer.strokeWidth / 2;
  return { x: -ext.left - pad, y: -ext.top - pad, w: layer.w + ext.left + ext.right + 2 * pad, h: layer.h + ext.top + ext.bottom + 2 * pad };
}

/** In the layer's box coordinates (0..w, 0..h), with its effects. */
export function drawLayerLocal(ctx: Ctx2D, layer: Layer, env: DrawEnv): void {
  const ext = autoExtension(layer, env.dieline, env.side, env.bleed);
  ctx.save();
  const op = blendOp(layer);
  if (op !== 'source-over') ctx.globalCompositeOperation = op;
  const shadow = activeShadow(layer);
  if (shadow) drawWithShadow(ctx, shadow, contentBounds(layer, ext), (c) => drawContent(c, layer, env, ext));
  else drawContent(ctx, layer, env, ext);
  ctx.restore();
}

/** In trim coordinates. */
export function layerClipRect(layer: Layer, env: DrawEnv) {
  if (!layer.clip) return null;
  const p = findPanel(env.dieline, env.side, layer.clip.panelId);
  return p ? panelBleedRect(p, env.bleed) : null;
}

/** In trim coordinates; applies clip, opacity and transform. */
export function drawLayer(ctx: Ctx2D, layer: Layer, env: DrawEnv): void {
  if (!layer.visible) return;
  ctx.save();
  const clip = layerClipRect(layer, env);
  if (clip) {
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
  }
  ctx.globalAlpha *= layer.opacity;
  ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.translate(-layer.w / 2, -layer.h / 2);
  drawLayerLocal(ctx, layer, env);
  ctx.restore();
}
