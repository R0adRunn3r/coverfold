import * as Comlink from 'comlink';
import { composePdf } from '../../core/export/composePdf';
import { woffToSfnt } from '../../core/export/woff';
import { layerAssetIds, type Project } from '../../core/model';
import { allLayers, faceLayers } from '../../core/faces';
import { buildPrintPlan, type PrintStrings } from '../../core/printPlan';
import { loadOriginal } from '../assets';
import { loadFontForPdf, loadFonts } from '../fonts';
import { mmToPx } from '../../core/units';
import { cropOf } from '../../core/crop';
import type { DrawableImage } from './draw';
import { renderFace } from './renderFace';
import { enlarge } from './upscale';

export type ProgressFn = (done: number, total: number) => void;

function usedFonts(project: Project): Set<string> {
  const out = new Set<string>();
  for (const p of project.pieces) for (const l of allLayers(p)) if (l.type === 'text') out.add(l.fontFamily);
  return out;
}

async function exportProject(project: Project, strings: PrintStrings, onProgress?: ProgressFn): Promise<Uint8Array> {
  await loadFonts(usedFonts(project));
  const plan = buildPrintPlan(project, strings);
  const pieces = new Map(plan.pieces.map((p) => [p.id, p]));
  const cache = new Map<string, ImageBitmap>();
  const s = project.print;
  const bytes = await composePdf(plan, {
    title: project.name,
    onProgress,
    loadFont: (f) => loadFontForPdf(f.family, f.weight, f.italic, woffToSfnt),
    renderFace: async (img) => {
      const piece = pieces.get(img.face.pieceId)!;
      // Per face: the image to draw for each asset (an enlarged copy when it is blown up).
      const forFace = new Map<string, DrawableImage>();
      for (const l of faceLayers(piece, img.face.side)) {
        if (!l.visible) continue;
        for (const id of layerAssetIds(l)) {
          if (cache.has(id)) continue;
          const bmp = await loadOriginal(id);
          if (bmp) cache.set(id, bmp);
        }
        if (l.type !== 'image') continue; // QR logos are small: printed from the original
        const src = cache.get(l.assetId);
        if (!src) continue;
        // A cropped picture is blown up more: the whole picture is printed at its zoomed size.
        const c = cropOf(l);
        const enlarged = s.enhanceSmall !== false ? enlargedFor(src, l.assetId, mmToPx(l.w / c.w, s.dpi), mmToPx(l.h / c.h, s.dpi)) : null;
        const prev = forFace.get(l.assetId);
        if (!prev || (enlarged && enlarged.width > prev.width)) forFace.set(l.assetId, enlarged ?? src);
      }
      return renderFace(
        { piece, side: img.face.side, bleed: s.bleed, dpi: s.dpi, quarter: img.quarter, format: s.format, jpegQuality: s.jpegQuality, vectorText: s.vectorText !== false },
        (id) => forFace.get(id) ?? cache.get(id) ?? null,
      );
    },
  });
  for (const b of cache.values()) b.close();
  enlargedCache.clear();
  return bytes;
}

/** Below this blow-up the browser's own scaling is as good. */
const ENLARGE_FROM = 1.25;
/** Largest enlarged copy (pixels): beyond it the browser scales the rest. */
const ENLARGE_MAX_PX = 16_000_000;
const enlargedCache = new Map<string, OffscreenCanvas>();

/**
 * `src` enlarged to its printed size (Lanczos-3 and light sharpening), or null
 * when it is not blown up enough to matter.
 */
function enlargedFor(src: ImageBitmap, assetId: string, pxW: number, pxH: number): OffscreenCanvas | null {
  const factor = Math.min(pxW / src.width, pxH / src.height);
  if (!(factor >= ENLARGE_FROM)) return null;
  const k = Math.min(1, Math.sqrt(ENLARGE_MAX_PX / (pxW * pxH)));
  const tw = Math.min(16000, Math.round(pxW * k)), th = Math.min(16000, Math.round(pxH * k));
  if (tw <= src.width * ENLARGE_FROM) return null;
  const key = `${assetId}@${tw}x${th}`;
  const hit = enlargedCache.get(key);
  if (hit) return hit;
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const pixels = ctx.getImageData(0, 0, src.width, src.height);
  const big = enlarge(pixels, tw, th);
  const out = new OffscreenCanvas(tw, th);
  out.getContext('2d')!.putImageData(new ImageData(big.data as Uint8ClampedArray<ArrayBuffer>, tw, th), 0, 0);
  enlargedCache.set(key, out);
  return out;
}

const api = {
  async exportPdf(project: Project, strings: PrintStrings, onProgress?: ProgressFn): Promise<Uint8Array> {
    const bytes = await exportProject(project, strings, onProgress);
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
};

export type ExportWorkerApi = typeof api;

Comlink.expose(api);
