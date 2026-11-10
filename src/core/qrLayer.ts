// A QR layer as printed: which code (robustness and, with a logo, how many
// modules), how big its modules come out, and what would stop a phone from
// reading it. Pure encoding is in core/qr, logo geometry in core/qrLogo.
import { contrastRatio, luminance } from './color';
import type { QrEcc, QrLayer, QrLogo } from './model';
import { QR_MIN_MODULE, QR_MIN_SIZE, QR_QUIET, moduleSize, qrMatrix, qrSide, type QrMatrix } from './qr';
import { QR_LOGO_DEFAULT_SIZE, QR_LOGO_MAX_SIZE, QR_LOGO_MIN_SIZE, logoFits, qrLogoPlan } from './qrLogo';

/** Robustness actually used: a logo needs the most (H repairs 30% of the code). */
export const qrEcc = (l: Pick<QrLayer, 'ecc' | 'logo'>): QrEcc => (l.logo ? 'H' : l.ecc);

/**
 * Smallest module (mm) the app picks on its own to make room for a logo:
 * kept above the readability limit so a denser code still prints well.
 */
export const QR_LOGO_MIN_MODULE = 0.5;

type QrBox = Pick<QrLayer, 'text' | 'w' | 'h'>;

/**
 * Codes that can carry a logo, smallest first: the one the text needs, then
 * denser ones while modules stay >= QR_LOGO_MIN_MODULE. A denser code has room
 * for a bigger logo, as the gap around it and the patterns near the middle
 * cost relatively less.
 */
function logoCodes(l: QrBox): QrMatrix[] {
  const first = qrMatrix(l.text, 'H');
  if (!first) return [];
  const out = [first];
  for (let v = first.version + 1; v <= 40; v++) {
    if (qrSide(l) / (17 + 4 * v + 2 * QR_QUIET) < QR_LOGO_MIN_MODULE) break;
    const m = qrMatrix(l.text, 'H', v);
    if (m) out.push(m);
  }
  return out;
}

const fitsAt = (m: QrMatrix, logo: Omit<QrLogo, 'size'>, size: number) => logoFits(qrLogoPlan(m, { ...logo, size }));

const chosen = new Map<string, QrMatrix | null>();

/**
 * The code printed for the layer. With a logo: the least dense code where
 * the logo fits (the smallest one when none does, and the checks warn).
 */
export function layerQrMatrix(l: QrLayer): QrMatrix | null {
  if (!l.logo) return qrMatrix(l.text, l.ecc);
  const logo = l.logo;
  // Cached: the editor redraws the layer every frame.
  const key = `${qrSide(l)}|${logo.size}|${logo.naturalW}x${logo.naturalH}|${logo.footprint.bits}\u0000${l.text}`;
  if (chosen.has(key)) return chosen.get(key)!;
  const codes = logoCodes(l);
  const m = codes.find((c) => fitsAt(c, logo, logo.size)) ?? codes[0] ?? null;
  if (chosen.size > 64) chosen.clear();
  chosen.set(key, m);
  return m;
}

/** Whether the code was made denser than its text needs, to make room for the logo. */
export function denserForLogo(l: QrLayer): boolean {
  const m = layerQrMatrix(l);
  return !!(l.logo && m && m.version > (qrMatrix(l.text, 'H')?.version ?? m.version));
}

/**
 * Largest logo size (share of the side, in 1% steps) a code for this text and
 * box can carry; null when not even the smallest size fits.
 */
export function maxLogoSize(l: QrBox, logo: Omit<QrLogo, 'size'>): number | null {
  const lo0 = Math.round(QR_LOGO_MIN_SIZE * 100), hi0 = Math.round(QR_LOGO_MAX_SIZE * 100);
  let best = 0;
  for (const m of logoCodes(l)) {
    const fits = (p: number) => fitsAt(m, logo, p / 100);
    if (!fits(lo0) || (best && !fits(best + 1))) continue;
    let lo = Math.max(lo0, best), hi = hi0;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    best = Math.max(best, lo);
  }
  return best ? best / 100 : null;
}

/** Size for a new logo: the default, or less when the code has no room for it. */
export function fitLogoSize(l: QrBox, logo: Omit<QrLogo, 'size'>): number {
  return Math.min(QR_LOGO_DEFAULT_SIZE, maxLogoSize(l, logo) ?? QR_LOGO_MIN_SIZE);
}

/** Printed size of one module (mm), or null when there is no code. */
export function qrModule(l: QrLayer): number | null {
  const m = layerQrMatrix(l);
  return m ? moduleSize(l, m) : null;
}

export type QrProblem = 'empty' | 'tooLong' | 'logoBig' | 'small' | 'contrast';

/** What would stop a phone from reading the printed code (null = looks fine). */
export function qrProblem(l: QrLayer): QrProblem | null {
  if (!l.text.trim()) return 'empty';
  const m = layerQrMatrix(l);
  if (!m) return 'tooLong';
  if (l.logo && !logoFits(qrLogoPlan(m, l.logo))) return 'logoBig';
  if (moduleSize(l, m) < QR_MIN_MODULE || qrSide(l) < QR_MIN_SIZE) return 'small';
  // Readers expect dark modules on a lighter ground, with clear contrast.
  if (l.background) {
    const ratio = contrastRatio(l.color, l.background);
    const lc = luminance(l.color), lb = luminance(l.background);
    if (ratio !== null && (ratio < 3 || (lc !== null && lb !== null && lc > lb))) return 'contrast';
  } else {
    const lc = luminance(l.color);
    if (lc !== null && lc > 0.4) return 'contrast';
  }
  return null;
}
