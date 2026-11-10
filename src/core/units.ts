export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export const A4 = { w: 210, h: 297 } as const;

export const mmToPt = (mm: number): number => (mm * PT_PER_INCH) / MM_PER_INCH;
export const ptToMm = (pt: number): number => (pt * MM_PER_INCH) / PT_PER_INCH;
export const mmToPx = (mm: number, dpi: number): number => (mm * dpi) / MM_PER_INCH;
export const pxToMm = (px: number, dpi: number): number => (px * MM_PER_INCH) / dpi;

/** Effective resolution of an image of `px` pixels printed over `mm` millimetres. */
export const effectiveDpi = (px: number, mm: number): number => (mm > 0 ? (px * MM_PER_INCH) / mm : 0);

export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
