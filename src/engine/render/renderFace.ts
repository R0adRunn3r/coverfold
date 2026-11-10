import { zlibSync } from 'fflate';
import { bleedShapePath } from '../../core/bleedShape';
import type { EncodedFace, VectorText } from '../../core/export/composePdf';
import { faceMatrix, multiply, translate, type Matrix } from '../../core/geometry';
import type { ImageFormat, Layer, Piece, TextLayer } from '../../core/model';
import { faceDieline, faceLayers } from '../../core/faces';
import type { Side } from '../../core/templates/types';
import { mmToPx } from '../../core/units';
import { fontCoverage } from './fontCoverage';
import { drawLayer, layerClipRect, tracePath, type Ctx2D, type DrawableImage, type DrawEnv } from './draw';
import { needsRaster } from './effects';
import { layoutText, leaderStyle, textMode } from './textLayout';

export interface FaceRenderJob {
  piece: Piece;
  side: Side;
  bleed: number;
  dpi: number;
  quarter: 0 | 1 | 2 | 3;
  format: ImageFormat;
  jpegQuality: number;
  /** Put text that sits above every image into the PDF as real text. */
  vectorText?: boolean;
}

/**
 * Text layers that can become PDF text: visible, not curved, without effects
 * (shadow, outline, blend) and above every other visible layer (so drawing
 * them after the picture keeps the stacking).
 */
export function vectorTextLayers(layers: Layer[], canVector: (l: TextLayer) => boolean = () => true): Set<string> {
  let lastRaster = -1;
  layers.forEach((l, i) => {
    if (l.visible && (l.type !== 'text' || textMode(l) === 'arc' || needsRaster(l) || !canVector(l))) lastRaster = i;
  });
  return new Set(layers.filter((l, i) => i > lastRaster && l.visible && l.type === 'text' && l.text.trim()).map((l) => l.id));
}

/**
 * True when every character exists in the layer's own font file. A missing
 * glyph is drawn by the browser with a fallback font, which the PDF cannot do,
 * so such text stays in the picture.
 */
async function fontCovers(l: TextLayer): Promise<boolean> {
  const has = await fontCoverage(l.fontFamily, l.fontWeight, l.italic);
  return [...l.text.normalize('NFC')].every((c) => !c.trim() || has(c.codePointAt(0)!));
}

function cssToRgb(ctx: Ctx2D, color: string): { rgb: [number, number, number]; alpha: number } {
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color;
  const v = String(ctx.fillStyle);
  if (v.startsWith('#')) return { rgb: [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number], alpha: 1 };
  const m = /rgba?\(([^)]+)\)/.exec(v);
  const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [0, 0, 0, 1];
  return { rgb: [parts[0] / 255, parts[1] / 255, parts[2] / 255], alpha: parts[3] ?? 1 };
}

function toVectorText(ctx: Ctx2D, l: TextLayer, env: DrawEnv): VectorText {
  const layout = layoutText(ctx, l, true);
  const { rgb, alpha } = cssToRgb(ctx, l.color);
  const rad = (l.rotation * Math.PI) / 180;
  const rot: Matrix = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
  const transform = multiply(translate(l.x + l.w / 2, l.y + l.h / 2), multiply(rot, translate(-l.w / 2, -l.h / 2)));
  const leader = leaderStyle(layout.sizeMm);
  return {
    font: { family: l.fontFamily, weight: l.fontWeight, italic: l.italic },
    sizeMm: layout.sizeMm,
    letterSpacingMm: layout.letterSpacingMm,
    color: rgb,
    opacity: l.opacity * alpha,
    runs: layout.runs,
    leaders: layout.leaders,
    leaderWidth: leader.width,
    leaderGap: leader.gap,
    transform,
    clip: layerClipRect(l, env),
  };
}

export { faceMatrix } from '../../core/geometry';

/** Renders one face, bleed included and rotated by `quarter`, and encodes it for the PDF. */
export async function renderFace(job: FaceRenderJob, getImage: (assetId: string) => DrawableImage | null): Promise<EncodedFace> {
  // The face's own view: for the inside, the outline is mirrored like the artwork.
  const d = faceDieline(job.piece, job.side);
  const bw = d.w + 2 * job.bleed;
  const bh = d.h + 2 * job.bleed;
  const odd = job.quarter % 2 === 1;
  const mmW = odd ? bh : bw;
  const mmH = odd ? bw : bh;
  const pxW = Math.max(1, Math.round(mmToPx(mmW, job.dpi)));
  const pxH = Math.max(1, Math.round(mmToPx(mmH, job.dpi)));

  const canvas = new OffscreenCanvas(pxW, pxH);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error(`Cannot create a ${pxW}x${pxH} canvas. Try a lower resolution.`);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.imageSmoothingQuality = 'high';
  const m = faceMatrix(d.w, d.h, job.bleed, job.quarter, pxW / mmW, pxH / mmH);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

  ctx.save();
  tracePath(ctx, bleedShapePath(d, job.bleed));
  ctx.clip('evenodd');
  const env = { getImage, bleed: job.bleed, dieline: d, side: job.side };
  const layers = faceLayers(job.piece, job.side);
  const covered = new Set<string>();
  if (job.vectorText) for (const l of layers) if (l.type === 'text' && (await fontCovers(l))) covered.add(l.id);
  const vector = job.vectorText ? vectorTextLayers(layers, (l) => covered.has(l.id)) : new Set<string>();
  for (const layer of layers) if (!vector.has(layer.id)) drawLayer(ctx, layer, env);
  ctx.restore();
  const texts = layers.filter((l): l is TextLayer => vector.has(l.id)).map((l) => toVectorText(ctx, l, env));

  let out: EncodedFace;
  if (job.format === 'jpeg') {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: job.jpegQuality });
    out = { kind: 'jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
  } else {
    // Lossless: raw RGB rows, zlib-compressed (FlateDecode). Rows are read in
    // bands to avoid holding a second full-size RGBA copy.
    const rgb = new Uint8Array(pxW * pxH * 3);
    const band = Math.max(1, Math.floor(8_000_000 / pxW));
    for (let y = 0; y < pxH; y += band) {
      const hh = Math.min(band, pxH - y);
      const data = ctx.getImageData(0, y, pxW, hh).data;
      let o = y * pxW * 3;
      for (let i = 0; i < data.length; i += 4) {
        rgb[o++] = data[i];
        rgb[o++] = data[i + 1];
        rgb[o++] = data[i + 2];
      }
    }
    out = { kind: 'deflate-rgb', bytes: zlibSync(rgb, { level: 6 }), width: pxW, height: pxH };
  }
  if (texts.length) Object.assign(out, { texts, toBox: faceMatrix(d.w, d.h, job.bleed, job.quarter, 1, 1), clipPath: bleedShapePath(d, job.bleed) });
  canvas.width = canvas.height = 1; // release the backing store early
  return out;
}
