// Fonts are bundled (SIL Open Font License) so the app works offline and the
// exact same files are used by the editor and by the export worker.
import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interItalic from '@fontsource/inter/files/inter-latin-400-italic.woff2?url';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import interBoldItalic from '@fontsource/inter/files/inter-latin-700-italic.woff2?url';
import oswaldRegular from '@fontsource/oswald/files/oswald-latin-400-normal.woff2?url';
import oswaldBold from '@fontsource/oswald/files/oswald-latin-700-normal.woff2?url';
import playfairRegular from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url';
import playfairItalic from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff2?url';
import playfairBold from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url';
import playfairBoldItalic from '@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff2?url';
import bebasRegular from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import markerRegular from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url';
import monoRegular from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2?url';
import monoBold from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff2?url';

import interRegularWoff from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import interItalicWoff from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import interBoldWoff from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import interBoldItalicWoff from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import oswaldRegularWoff from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import oswaldBoldWoff from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import playfairRegularWoff from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import playfairItalicWoff from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff?url';
import playfairBoldWoff from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?url';
import playfairBoldItalicWoff from '@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff?url';
import bebasRegularWoff from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import markerRegularWoff from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff?url';
import monoRegularWoff from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url';
import monoBoldWoff from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url';

/** `url` (WOFF2) is for the browser, `woff` is converted to TrueType for PDF embedding. */
export interface FontFile { family: string; weight: 400 | 700; style: 'normal' | 'italic'; url: string; woff: string }

export const FONT_FILES: FontFile[] = [
  { family: 'Inter', weight: 400, style: 'normal', url: interRegular, woff: interRegularWoff },
  { family: 'Inter', weight: 400, style: 'italic', url: interItalic, woff: interItalicWoff },
  { family: 'Inter', weight: 700, style: 'normal', url: interBold, woff: interBoldWoff },
  { family: 'Inter', weight: 700, style: 'italic', url: interBoldItalic, woff: interBoldItalicWoff },
  { family: 'Oswald', weight: 400, style: 'normal', url: oswaldRegular, woff: oswaldRegularWoff },
  { family: 'Oswald', weight: 700, style: 'normal', url: oswaldBold, woff: oswaldBoldWoff },
  { family: 'Playfair Display', weight: 400, style: 'normal', url: playfairRegular, woff: playfairRegularWoff },
  { family: 'Playfair Display', weight: 400, style: 'italic', url: playfairItalic, woff: playfairItalicWoff },
  { family: 'Playfair Display', weight: 700, style: 'normal', url: playfairBold, woff: playfairBoldWoff },
  { family: 'Playfair Display', weight: 700, style: 'italic', url: playfairBoldItalic, woff: playfairBoldItalicWoff },
  { family: 'Bebas Neue', weight: 400, style: 'normal', url: bebasRegular, woff: bebasRegularWoff },
  { family: 'Permanent Marker', weight: 400, style: 'normal', url: markerRegular, woff: markerRegularWoff },
  { family: 'Roboto Mono', weight: 400, style: 'normal', url: monoRegular, woff: monoRegularWoff },
  { family: 'Roboto Mono', weight: 700, style: 'normal', url: monoBold, woff: monoBoldWoff },
];

export const FONT_FAMILIES = [...new Set(FONT_FILES.map((f) => f.family))];

type FontScope = { fonts: FontFaceSet };
const loaded = new Set<string>();

const defaultScope = (): FontScope => (typeof document !== 'undefined' ? document : (self as unknown as FontScope));

/** Loads into the document or, in a worker, into self. */
export async function loadFonts(families: Iterable<string>, scope: FontScope = defaultScope()): Promise<void> {
  const wanted = new Set(families);
  await Promise.all(
    FONT_FILES.filter((f) => wanted.has(f.family)).map(async (f) => {
      const key = `${f.family}|${f.weight}|${f.style}`;
      if (loaded.has(key)) return;
      loaded.add(key);
      const face = new FontFace(f.family, `url(${new URL(f.url, self.location.href).href})`, { weight: String(f.weight), style: f.style });
      await face.load();
      scope.fonts.add(face);
    }),
  );
}

export const loadAllFonts = () => loadFonts(FONT_FAMILIES);

const sfntCache = new Map<string, Promise<Uint8Array>>();

/** TrueType bytes of the closest bundled face, for embedding in the PDF. */
export function loadFontForPdf(family: string, weight: number, italic: boolean, toSfnt: (woff: Uint8Array) => Uint8Array): Promise<Uint8Array> {
  const style = italic ? 'italic' : 'normal';
  const candidates = FONT_FILES.filter((f) => f.family === family);
  const pick = candidates.find((f) => f.weight === weight && f.style === style)
    ?? candidates.find((f) => f.weight === weight)
    ?? candidates.find((f) => f.style === style)
    ?? candidates[0] ?? FONT_FILES[0];
  let p = sfntCache.get(pick.woff);
  if (!p) {
    p = fetch(new URL(pick.woff, self.location.href)).then((r) => r.arrayBuffer()).then((b) => toSfnt(new Uint8Array(b)));
    sfntCache.set(pick.woff, p);
  }
  return p;
}
