import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { A4, mmToPt } from '../units';
import { toWinAnsi } from './winansi';

export interface CalibrationStrings {
  title: string;
  steps: string[];
  backTitle: string;
  xLabel: string;
  yLabel: string;
}

const PAGE_W = mmToPt(A4.w);
const PAGE_H = mmToPt(A4.h);
const X = (mm: number) => mmToPt(mm);
const Y = (mm: number) => PAGE_H - mmToPt(mm);
const CX = A4.w / 2;
const CY = A4.h / 2;
const RANGE = 4; // mm either side

const line = (page: PDFPage, x1: number, y1: number, x2: number, y2: number, w = 0.2) =>
  page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: mmToPt(w), color: rgb(0, 0, 0) });

const text = (page: PDFPage, font: PDFFont, s: string, x: number, y: number, size: number, center = false) => {
  const t = toWinAnsi(s);
  const w = center ? font.widthOfTextAtSize(t, size) / 2 : 0;
  page.drawText(t, { x: X(x) - w, y: Y(y), size, font, color: rgb(0.15, 0.15, 0.15) });
};

/**
 * Two pages to print double-sided: a thin cross through the sheet centre on
 * the front, two scales around the same point on the back. Held against the
 * light, the front lines cross the scales at the X/Y correction to type in
 * (in back-side coordinates, as the correction is applied). The centre is
 * symmetric, so this works for both long- and short-edge flipping.
 */
export async function composeCalibrationPdf(s: CalibrationStrings): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(s.title));
  doc.setCreator('Coverfold');
  const font = doc.embedStandardFont(StandardFonts.Helvetica);
  const bold = doc.embedStandardFont(StandardFonts.HelveticaBold);

  const front = doc.addPage([PAGE_W, PAGE_H]);
  text(front, bold, s.title, 18, 22, 15);
  s.steps.forEach((step, i) => text(front, font, `${i + 1}. ${step}`, 18, 32 + i * 6, 9));
  line(front, CX - 95, CY, CX + 95, CY, 0.15);
  line(front, CX, CY - 40, CX, CY + 100, 0.15);

  const back = doc.addPage([PAGE_W, PAGE_H]);
  text(back, bold, s.backTitle, CX, 40, 13, true);
  // Staircases of 0.5 mm ticks, one per row (X) or column (Y) with its own
  // label, so the tick the front line covers can be read off.
  const steps = Math.round(RANGE * 2);
  for (let i = -steps; i <= steps; i++) {
    const v = i / 2;
    const label = `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    const k = i + steps;
    const zero = i === 0;
    // X: vertical tick at x = CX + v on its own row below the centre.
    const ry = CY + 18 + k * 3.2;
    line(back, CX + v, ry, CX + v, ry + 2.4, zero ? 0.25 : 0.12);
    text(back, zero ? bold : font, label, CX + v + 1.2, ry + 2, 5.5);
    // Y: horizontal tick at y = CY + v on its own column right of the centre.
    const cx = CX + 18 + k * 2.9;
    line(back, cx, CY + v, cx + 2.2, CY + v, zero ? 0.25 : 0.12);
    if (i % 2 === 0) text(back, zero ? bold : font, label, cx + 1.1, i % 4 === 0 ? CY - 9 : CY - 13, 5.5, true);
  }
  text(back, bold, s.xLabel, CX - 22, CY + 18 + steps * 3.2, 9);
  text(back, bold, s.yLabel, CX + 18 + steps * 2.9, CY - 20, 9, true);
  return doc.save();
}
