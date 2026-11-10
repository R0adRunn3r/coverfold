import { faceLayers, isMultiPage, pageCount } from './faces';
import { fitsSheet } from './imposition';
import { findPanel } from './layout';
import type { Layer, Piece } from './model';
import { splitRanges, type PartRange } from './split';
import { buildDieline, defaultParams, getTemplate } from './templates/catalog';
import type { Dieline, Side } from './templates/types';

/** Separator between a booklet id and its spread index in expanded piece ids. */
export const SPREAD_SEP = '~s';
/** Separator between a split piece id and its part index. */
export const PART_SEP = '~p';

/** Original piece id of a (possibly expanded) piece id. */
export const sourcePieceId = (id: string): string => id.split('~')[0];

/** Part index and count of an expanded part piece, or null. */
export function partOf(piece: Piece): { index: number; count: number } | null {
  const p = piece.params;
  return p.__part !== undefined ? { index: p.__part, count: p.__parts } : null;
}

/**
 * Saddle stitching: page numbers on each nested sheet, outermost first.
 * Sheet i of an N-page booklet carries pages [N-2i | 1+2i] outside and
 * [2+2i | N-1-2i] inside (left | right, as seen on each face).
 */
export function saddleStitchSpreads(n: number): { outside: [number, number]; inside: [number, number] }[] {
  return Array.from({ length: n / 4 }, (_, i) => ({
    outside: [n - 2 * i, 1 + 2 * i] as [number, number],
    inside: [2 + 2 * i, n - 1 - 2 * i] as [number, number],
  }));
}

function placePage(piece: Piece, page: number, panelId: string, dx: number): Layer[] {
  return faceLayers(piece, `p${page}` as Side).map((l) => ({ ...l, x: l.x + dx, clip: { panelId } }) as Layer);
}

function expandBooklet(piece: Piece): Piece[] {
  const t = getTemplate(piece.templateId);
  const params = { ...defaultParams(t), ...piece.params };
  const pw = params.pw;
  return saddleStitchSpreads(pageCount(piece)).map((s, i): Piece => ({
    ...piece,
    id: `${piece.id}${SPREAD_SEP}${i}`,
    templateId: 'jewel.booklet4',
    params: { pw, h: params.h },
    layers: {
      outside: [...placePage(piece, s.outside[0], 'back', 0), ...placePage(piece, s.outside[1], 'front', pw)],
      inside: [...placePage(piece, s.inside[0], 'p2', 0), ...placePage(piece, s.inside[1], 'p3', pw)],
    },
  }));
}

/** What a sheet can hold: used to decide whether a piece must be split. */
export interface SheetFit { printerMargin: number; margin: number; minMargin: number }

/** Seams for a piece that does not fit a sheet even with the minimum margin; null if it fits. */
export function splitFor(d: Dieline, fit: SheetFit): PartRange[] | null {
  if (fitsSheet(d.w, d.h, fit.printerMargin, fit.minMargin)) return null;
  return splitRanges(d, (w, h) => fitsSheet(w, h, fit.printerMargin, fit.margin))
    ?? splitRanges(d, (w, h) => fitsSheet(w, h, fit.printerMargin, fit.minMargin));
}

/** Layers of one face moved into a part; layers clipped to a panel the part lacks are dropped. */
function partLayers(piece: Piece, side: Side, dx: number, part: Dieline): Layer[] {
  return faceLayers(piece, side)
    .filter((l) => !l.clip || findPanel(part, side, l.clip.panelId))
    .map((l) => ({ ...l, x: l.x + dx }) as Layer);
}

function expandParts(piece: Piece, ranges: PartRange[]): Piece[] {
  const W = buildDieline(piece.templateId, piece.params).w;
  return ranges.map((r, i): Piece => {
    const params = { ...piece.params, __x0: r.x0, __x1: r.x1, __tab: r.tab, __part: i, __parts: ranges.length };
    const part = buildDieline(piece.templateId, params);
    const e = r.x0 + part.w;
    return {
      ...piece,
      id: `${piece.id}${PART_SEP}${i}`,
      params,
      layers: {
        outside: partLayers(piece, 'outside', -r.x0, part),
        inside: partLayers(piece, 'inside', -(W - e), part),
      },
    };
  });
}

/**
 * Turns pieces into what is actually printed: multi-page booklets become
 * two-sided spreads (4-page booklet geometry), and with `fit`, pieces wider
 * than a sheet become parts joined by glue tabs. Imposition, rendering and
 * marks then need no special case.
 */
export function expandForPrint(pieces: Piece[], fit?: SheetFit): Piece[] {
  return pieces.flatMap((piece) => {
    if (isMultiPage(piece)) return expandBooklet(piece);
    if (!fit) return [piece];
    const ranges = splitFor(buildDieline(piece.templateId, piece.params), fit);
    return ranges ? expandParts(piece, ranges) : [piece];
  });
}
