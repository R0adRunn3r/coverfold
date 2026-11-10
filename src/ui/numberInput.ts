// Typing an exact number where a control usually drags (the value beside a
// slider): what the user may type, and how it becomes a valid value.

/** A number as the app shows it, in every language: a point for decimals, at most `decimals` of them. */
export const fmtNum = (v: number, decimals = 1): string => String(Math.round(v * 10 ** decimals) / 10 ** decimals);

/** Decimals a step needs (0.05 -> 2, 0.5 -> 1, 5 -> 0). */
export function stepDecimals(step: number): number {
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * A number typed by hand: comma or point, with or without its unit ("25 %",
 * "1,5mm", "+10"); a typographic minus or en dash counts as "-". Null if no number.
 */
export function parseTyped(raw: string): number | null {
  const m = raw.replace(/[−–]/g, '-').replace(',', '.').match(/[-+]?(\d+\.?\d*|\.\d+)/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

/**
 * A typed value made valid for a slider: clamped, and rounded to the step's
 * decimals but not to whole steps (37 on a 15-degree slider stays 37).
 */
export function settle(v: number, min: number, max: number, step: number): number {
  const k = 10 ** stepDecimals(step);
  return Math.min(max, Math.max(min, Math.round(v * k) / k));
}

/** The unit a formatted value carries ("25%" -> "%", "1.5 mm" -> "mm", "+10" -> ""). */
export const unitOf = (formatted: string): string => formatted.replace(/^\s*[-+−]?[\d.,]+\s*/, '').trim();
