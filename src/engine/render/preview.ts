// Low-resolution renders for the UI (piece strip, project thumbnails, print
// preview). Same drawing code as the export, but with editor previews.
import { bleedShapePath } from '../../core/bleedShape';
import { layerAssetIds, type Piece, type Project } from '../../core/model';
import type { SheetPage } from '../../core/printPlan';
import { allLayers, faceDieline, faceIds, faceLayers, pieceHasContent } from '../../core/faces';
import type { Side } from '../../core/templates/types';
import { faceMatrix } from '../../core/geometry';
import { A4 } from '../../core/units';
import { getPreview, loadPreview } from '../assets';
import { drawLayer, tracePath, type Ctx2D } from './draw';

/** Makes sure the editor previews of every image of these pieces are decoded. */
export async function preloadPreviews(pieces: Piece[]): Promise<void> {
  const ids = new Set<string>();
  for (const p of pieces) for (const l of allLayers(p)) layerAssetIds(l).forEach((id) => ids.add(id));
  await Promise.all([...ids].map((id) => loadPreview(id)));
}

/**
 * (ox, oy) px is the top-left of the rotated bleed box. `bleed` sets how much
 * bleed is shown; with 0 the cut line is the clip.
 */
export function drawFace(ctx: Ctx2D, piece: Piece, side: Side, bleed: number, pxPerMm: number, ox: number, oy: number, quarter = 0): void {
  const d = faceDieline(piece, side);
  const m = faceMatrix(d.w, d.h, bleed, quarter, pxPerMm, pxPerMm);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  tracePath(ctx, bleed > 0 ? bleedShapePath(d, bleed) : d.cut);
  ctx.clip('evenodd');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-bleed - 1, -bleed - 1, d.w + 2 * bleed + 2, d.h + 2 * bleed + 2);
  const env = { getImage: getPreview, bleed, dieline: d, side };
  for (const l of faceLayers(piece, side)) drawLayer(ctx, l, env);
  ctx.restore();
}

export function drawPieceThumb(canvas: HTMLCanvasElement, piece: Piece, side: Side): void {
  const d = faceDieline(piece, side);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = Math.min((canvas.width - 4) / d.w, (canvas.height - 4) / d.h);
  const ox = (canvas.width - d.w * k) / 2;
  const oy = (canvas.height - d.h * k) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 3;
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.fillStyle = '#fff';
  tracePath(ctx, d.cut);
  ctx.fill('evenodd');
  ctx.restore();
  drawFace(ctx, piece, side, 0, k, ox, oy);
}

/** WebP of the first piece with artwork, for the project list. */
export async function renderThumbnail(project: Project): Promise<Blob | null> {
  const piece = project.pieces.find(pieceHasContent) ?? project.pieces[0];
  if (!piece) return null;
  await preloadPreviews([piece]);
  const face = faceIds(piece).find((f) => faceLayers(piece, f).some((l) => l.visible)) ?? faceIds(piece)[0];
  const d = faceDieline(piece, face);
  const k = 320 / Math.max(d.w, d.h);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(d.w * k)), Math.max(1, Math.round(d.h * k)));
  const ctx = canvas.getContext('2d')!;
  drawFace(ctx, piece, face, 0, k, 0, 0);
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
}

/** One A4 page as the export will print it. */
export function drawSheetPreview(canvas: HTMLCanvasElement, page: SheetPage, project: Project, printPieces: Piece[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const k = canvas.width / A4.w;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pieces = new Map(printPieces.map((p) => [p.id, p]));
  for (const img of page.images) {
    const piece = pieces.get(img.face.pieceId);
    if (piece) drawFace(ctx, piece, img.face.side, project.print.bleed, k, img.rect.x * k, img.rect.y * k, img.quarter);
  }
  ctx.save();
  ctx.scale(k, k);
  // Marks are hairlines on paper: at least one canvas pixel here, or they vanish.
  const px = 1 / k;
  const rgbOf = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  for (const p of page.paths) {
    ctx.setLineDash(p.dash ?? []);
    if (p.halo) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(p.halo, 2.5 * px);
      tracePath(ctx, p.path);
      ctx.stroke();
    }
    ctx.strokeStyle = rgbOf(p.color);
    ctx.lineWidth = Math.max(p.width, px);
    tracePath(ctx, p.path);
    ctx.stroke();
  }
  for (const l of page.lines) {
    ctx.strokeStyle = rgbOf(l.color);
    ctx.lineWidth = Math.max(l.width, px);
    // Dashes are scaled up with the line so they stay readable as dashes.
    ctx.setLineDash((l.dash ?? []).map((d) => Math.max(d, 2 * px)));
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
  ctx.restore();
}
