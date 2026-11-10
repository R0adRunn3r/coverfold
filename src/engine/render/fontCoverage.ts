import fontkit from '@pdf-lib/fontkit';
import { woffToSfnt } from '../../core/export/woff';
import { loadFontForPdf } from '../fonts';

// Export worker only: fontkit is large, so it must not reach the UI bundle.
const coverage = new Map<string, Promise<(codePoint: number) => boolean>>();

/** Which characters the bundled font file really contains (no browser fallback). */
export function fontCoverage(family: string, weight: number, italic: boolean): Promise<(codePoint: number) => boolean> {
  const key = `${family}|${weight}|${italic}`;
  let p = coverage.get(key);
  if (!p) {
    p = loadFontForPdf(family, weight, italic, woffToSfnt).then((bytes) => {
      const font = fontkit.create(bytes);
      return (cp: number) => font.hasGlyphForCodePoint(cp);
    });
    coverage.set(key, p);
  }
  return p;
}
