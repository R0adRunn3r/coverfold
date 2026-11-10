// Where an imported album goes: the panels a picture can fill and the default
// panel for each cover, the title and the tracklist. The import dialog lets the user change them.
import type { Rect } from './geometry';
import { faceDieline, faceIds } from './faces';
import { facePanels } from './layout';
import type { Project } from './model';
import { isPicturePanel } from './placement';
import type { PanelDef, Side } from './templates/types';

export interface PanelChoice {
  /** Stable id for <select> values. */
  key: string;
  pieceId: string;
  pieceIndex: number;
  side: Side;
  panel: PanelDef;
}

export const choiceKey = (pieceId: string, side: Side, panelId: string) => `${pieceId}|${side}|${panelId}`;

/** Panels a picture can fill, in piece order then face order. */
export function picturePanels(project: Project): PanelChoice[] {
  const out: PanelChoice[] = [];
  project.pieces.forEach((piece, pieceIndex) => {
    for (const side of faceIds(piece)) {
      for (const panel of facePanels(faceDieline(piece, side), side)) {
        if (isPicturePanel(panel)) out.push({ key: choiceKey(piece.id, side, panel.id), pieceId: piece.id, pieceIndex, side, panel });
      }
    }
  });
  return out;
}

/** What a cover shows, from the Cover Art Archive types. */
export type CoverKind = 'front' | 'back' | 'medium' | 'tray' | 'other';

export function coverKind(c: { front: boolean; types: string[] }): CoverKind {
  if (c.front || c.types.includes('Front')) return 'front';
  if (c.types.includes('Back')) return 'back';
  if (c.types.includes('Medium')) return 'medium';
  if (c.types.includes('Tray')) return 'tray';
  return 'other';
}

const suits: Record<Exclude<CoverKind, 'other'>, (c: PanelChoice) => boolean> = {
  front: (c) => (c.side === 'outside' && c.panel.id === 'front') || (c.side === 'p1' && c.panel.labelKey === 'panel.cover'),
  back: (c) => (c.side === 'outside' && c.panel.id === 'back') || c.panel.labelKey === 'panel.backCover',
  medium: (c) => c.panel.id === 'disc',
  tray: (c) => c.panel.id === 'trayIn' || c.panel.labelKey === 'panel.insideRightTray',
};

export interface AlbumPlan {
  /** Panel for each cover (same order as the covers), null = library only. */
  covers: (PanelChoice | null)[];
  /** Where title and artist go. */
  titles: PanelChoice | null;
  tracklist: PanelChoice | null;
}

/**
 * Default places: front cover on a front panel (open piece first), back cover
 * on a back panel of another piece if possible (the tray card of a jewel case,
 * not page 4 of the booklet), disc picture on a disc, tray picture under the
 * tray. One picture per panel; the rest stay in the library. Title and artist
 * go with the front, the tracklist with the back.
 */
export function defaultAlbumPlan(project: Project, activePieceId: string | null, covers: { front: boolean; types: string[] }[]): AlbumPlan {
  const all = picturePanels(project);
  // The open piece first, then the others in project order.
  const rank = (c: PanelChoice) => (c.pieceId === activePieceId ? -1 : c.pieceIndex);
  const byKind = (k: Exclude<CoverKind, 'other'>) => all.filter(suits[k]).sort((a, b) => rank(a) - rank(b));
  const taken = new Set<string>();
  const out: (PanelChoice | null)[] = covers.map(() => null);
  let frontPiece: string | null = null;
  // The main front picture first, so that it wins over other "Front" scans.
  const order = covers.map((_, i) => i).sort((a, b) => Number(covers[b].front) - Number(covers[a].front));
  for (const k of ['front', 'back', 'medium', 'tray'] as const) {
    for (const i of order) {
      if (coverKind(covers[i]) !== k || out[i]) continue;
      let cands = byKind(k).filter((c) => !taken.has(c.key));
      if (k === 'back' && frontPiece) cands = [...cands.filter((c) => c.pieceId !== frontPiece), ...cands.filter((c) => c.pieceId === frontPiece)];
      const pick = cands[0];
      if (!pick) continue;
      out[i] = pick;
      taken.add(pick.key);
      if (k === 'front') frontPiece = pick.pieceId;
      break; // one picture of each kind; the others stay in the library
    }
  }
  const frontCover = out.find((c, i) => c && coverKind(covers[i]) === 'front') ?? null;
  const backCover = out.find((c, i) => c && coverKind(covers[i]) === 'back') ?? null;
  const main = all.find((c) => c.pieceId === activePieceId) ?? all[0] ?? null;
  const titles = frontCover ?? byKind('front')[0] ?? main;
  // Like the back cover: on another piece than the title when there is one.
  const backs = byKind('back');
  const firstBack = backs.find((c) => c.pieceId !== titles?.pieceId) ?? backs[0] ?? null;
  return { covers: out, titles, tracklist: backCover ?? firstBack ?? main };
}

/**
 * A box laid out on a panel as it reads, put on the sheet: on an
 * upside-down panel it is mirrored within the panel and turned half a turn.
 */
export function onPanel(box: Rect, p: PanelDef): Rect & { rotation: number } {
  if (p.orientation !== 180) return { ...box, rotation: 0 };
  const r = p.rect;
  return { x: r.x + r.w - (box.x - r.x) - box.w, y: r.y + r.h - (box.y - r.y) - box.h, w: box.w, h: box.h, rotation: 180 };
}
