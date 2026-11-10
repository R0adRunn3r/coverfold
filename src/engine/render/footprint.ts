// Where a picture is opaque, on the coarse grid saved with QR logos
// (core/qrLogo). A cell counts as opaque when any pixel in it is, so thin
// strokes and edges are never lost when the picture is scaled down.
import { FOOTPRINT_CELLS, packFootprint } from '../../core/qrLogo';
import type { Footprint } from '../../core/model';
import type { DrawableImage } from './draw';

/** Pixels whose alpha is at least this (0-255) are part of the logo; fainter ones are a soft edge. */
const ALPHA_MIN = 24;
/** Pixels sampled per grid cell along each side. */
const SAMPLES = 4;

export function imageFootprint(img: DrawableImage, naturalW: number, naturalH: number): Footprint {
  const k = FOOTPRINT_CELLS / Math.max(naturalW, naturalH);
  const w = Math.max(1, Math.round(naturalW * k)), h = Math.max(1, Math.round(naturalH * k));
  const pw = w * SAMPLES, ph = h * SAMPLES;
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, pw, ph);
  const alpha = ctx.getImageData(0, 0, pw, ph).data;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (alpha[(y * pw + x) * 4 + 3] >= ALPHA_MIN) cells[Math.floor(y / SAMPLES) * w + Math.floor(x / SAMPLES)] = 1;
    }
  }
  return packFootprint(w, h, cells);
}
