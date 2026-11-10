// What holds the disc inside a digipak or wallet: a tray (bought, or 3D printed
// from Coverfold's STL) or a paper pocket, a separate piece glued on the same
// inside panel and open towards the spine.
import type { Piece, Project } from './model';
import { buildDieline, defaultParams, getTemplate, HOLDER_POCKET } from './templates/catalog';
import type { PanelDef } from './templates/types';

export type Holder = 'tray' | 'pocket';

export const POCKET_ID = 'wallet.pocket';
/** The pocket's usual size (mm) and its limits. */
export const POCKET_W = 126, POCKET_H = 124;
export const POCKET_MIN_W = 122, POCKET_MAX_W = 140, POCKET_MIN_H = 122, POCKET_MAX_H = 130;
/** Room left between the pocket and the panel edges (the folds), both sides together. */
export const POCKET_SPARE_W = 4, POCKET_SPARE_H = 1;

const params = (piece: Piece) => ({ ...defaultParams(getTemplate(piece.templateId)), ...piece.params });

export function holderOf(piece: Piece): Holder | null {
  if (!getTemplate(piece.templateId).discHolder) return null;
  return params(piece).holder === HOLDER_POCKET ? 'pocket' : 'tray';
}

/** The outside panel whose inside holds the disc. */
export function holderPanel(piece: Piece): PanelDef | null {
  const id = getTemplate(piece.templateId).discHolder?.panelId;
  return id ? buildDieline(piece.templateId, piece.params).panels.find((p) => p.id === id) ?? null : null;
}

/** Size of a pocket piece (the part that shows; its tabs fold underneath). */
export function pocketSize(pocket: Piece): { w: number; h: number } {
  const p = params(pocket);
  return { w: p.pw, h: p.h };
}

export const projectPocket = (project: Project): Piece | null => project.pieces.find((p) => p.templateId === POCKET_ID) ?? null;

/** Largest pocket that fits the panel, up to the usual size, in 0.5 mm steps; null when even the smallest does not fit. */
export function pocketFor(panel: PanelDef): { w: number; h: number } | null {
  const w = Math.min(POCKET_W, panel.rect.w - POCKET_SPARE_W);
  const h = Math.min(POCKET_H, panel.rect.h - POCKET_SPARE_H);
  if (w < POCKET_MIN_W || h < POCKET_MIN_H) return null;
  return { w: Math.floor(w * 2) / 2, h: Math.floor(h * 2) / 2 };
}

export const pocketFits = (size: { w: number; h: number }, panel: PanelDef) =>
  size.w <= panel.rect.w - POCKET_SPARE_W + 1e-6 && size.h <= panel.rect.h - POCKET_SPARE_H + 1e-6;
