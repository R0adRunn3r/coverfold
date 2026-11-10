// A piece has one or more editable faces: outside/inside for most templates,
// pages p1..pN for saddle-stitched booklets. Everything that edits or draws a
// face goes through these helpers.
import type { Layer, Piece } from './model';
import { buildDieline, buildPageDieline, defaultParams, getTemplate } from './templates/catalog';
import { transformPath, type Matrix } from './geometry';
import type { Dieline, Side } from './templates/types';

const NO_LAYERS: Layer[] = [];

export const isMultiPage = (piece: Piece): boolean => !!getTemplate(piece.templateId).pages;

export const pageNumber = (face: Side): number | null => (face.startsWith('p') ? Number(face.slice(1)) : null);

export function pageCount(piece: Piece): number {
  const t = getTemplate(piece.templateId);
  return t.pages ? t.pages.count({ ...defaultParams(t), ...piece.params }) : 0;
}

export function faceIds(piece: Piece): Side[] {
  const n = pageCount(piece);
  if (n) return Array.from({ length: n }, (_, i) => `p${i + 1}` as Side);
  return getTemplate(piece.templateId).sides;
}

/**
 * Dieline used to edit or draw one face (a single page for booklets). The inside
 * is seen from the back of the sheet: its outline, folds and glue zones are the
 * outside ones mirrored horizontally, and its panels are the inside panels.
 */
export function faceDieline(piece: Piece, face: Side): Dieline {
  const n = pageNumber(face);
  if (n !== null && isMultiPage(piece)) return buildPageDieline(piece.templateId, piece.params, n);
  const d = buildDieline(piece.templateId, piece.params);
  return face === 'inside' ? insideView(d) : d;
}

const mirrored = new WeakMap<Dieline, Dieline>();

/** The dieline as seen from the inside (memoised per dieline). */
export function insideView(d: Dieline): Dieline {
  let m = mirrored.get(d);
  if (!m) {
    const mx: Matrix = [-1, 0, 0, 1, d.w, 0];
    m = {
      ...d,
      cut: transformPath(d.cut, mx),
      glue: d.glue.map((g) => transformPath(g, mx)),
      slits: d.slits?.map((g) => transformPath(g, mx)),
      safeGuides: d.safeGuides.map((g) => transformPath(g, mx)),
      folds: d.folds.map((f) => ({ ...f, x1: d.w - f.x1, x2: d.w - f.x2 })),
      // So that whatever reads `panels` of this view gets the inside panels.
      panels: d.insidePanels,
    };
    mirrored.set(d, m);
  }
  return m;
}

export const faceLayers = (piece: Piece, face: Side): Layer[] => piece.layers[face] ?? NO_LAYERS;

/** Mutable layer list of a face, created on first use. */
export function ensureFace(piece: Piece, face: Side): Layer[] {
  return (piece.layers[face] ??= []);
}

export const allLayers = (piece: Piece): Layer[] => Object.values(piece.layers).flat();

export const faceHasContent = (piece: Piece, face: Side): boolean => faceLayers(piece, face).some((l) => l.visible);

export const pieceHasContent = (piece: Piece): boolean => faceIds(piece).some((f) => faceHasContent(piece, f));
