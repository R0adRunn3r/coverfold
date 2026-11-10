// QR code matrix, no canvas. Encoding is done by qrcode-generator (MIT); results
// are cached because the editor redraws the layer every frame. What a QR layer
// prints (robustness, room for a logo, warnings) is in core/qrLayer.
import qrcode from 'qrcode-generator';
import type { QrEcc, QrLayer } from './model';

export interface QrMatrix {
  /** Modules per side. */
  size: number;
  /** Row-major, 1 = dark module. */
  dark: Uint8Array;
  version: number;
}

/** Light margin around the code, in modules, kept inside the layer box. */
export const QR_QUIET = 2;
/** Below this module size (mm) phones start to struggle with home prints. */
export const QR_MIN_MODULE = 0.4;
/** Below this side (mm) a code is hard to aim at, whatever its content. */
export const QR_MIN_SIZE = 15;

const cache = new Map<string, QrMatrix | null>();

/** UTF-8 bytes as a "binary string": the library reads one byte per character. */
const utf8 = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

/**
 * The code for `text`, or null when it is empty or too long. `version` 0 picks
 * the smallest code that holds the text; a higher version has more, smaller modules.
 */
export function qrMatrix(text: string, ecc: QrEcc, version = 0): QrMatrix | null {
  const key = `${ecc}${version}\u0000${text}`;
  if (cache.has(key)) return cache.get(key)!;
  let out: QrMatrix | null = null;
  if (text.length > 0) {
    try {
      const qr = qrcode(version as Parameters<typeof qrcode>[0], ecc);
      qr.addData(utf8(text), 'Byte');
      qr.make();
      const size = qr.getModuleCount();
      const dark = new Uint8Array(size * size);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark[r * size + c] = qr.isDark(r, c) ? 1 : 0;
      out = { size, dark, version: (size - 17) / 4 };
    } catch {
      out = null; // more data than the code holds
    }
  }
  if (cache.size > 256) cache.clear();
  cache.set(key, out);
  return out;
}

/** Side of the square code inside the layer box (mm). */
export const qrSide = (l: Pick<QrLayer, 'w' | 'h'>) => Math.min(l.w, l.h);

/** Printed size of one module (mm). */
export const moduleSize = (l: Pick<QrLayer, 'w' | 'h'>, m: QrMatrix) => qrSide(l) / (m.size + 2 * QR_QUIET);
