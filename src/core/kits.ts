import { expandForPrint } from './expand';
import { impose } from './imposition';
import { POCKET_ID } from './discHolder';
import { DEFAULT_PRINT, makePiece, type Piece, type PrintSettings } from './model';
import { wantedMargin } from './printPlan';
import { buildDieline, getTemplate, HOLDER_POCKET } from './templates/catalog';
import type { Family, PaperKind } from './templates/types';

/** A piece a kit offers; `params` set its choices (e.g. a pocket rather than a tray). */
export interface KitPiece { templateId: string; selected: boolean; params?: Record<string, number> }
export interface KitDef { id: Family; nameKey: string; descKey: string; pieces: KitPiece[] }

export const KITS: KitDef[] = [
  {
    id: 'jewel',
    nameKey: 'kit.jewel.name',
    descKey: 'kit.jewel.desc',
    pieces: [
      { templateId: 'jewel.booklet4', selected: true },
      { templateId: 'jewel.booklet1', selected: false },
      { templateId: 'jewel.bookletN', selected: false },
      { templateId: 'jewel.tray', selected: true },
      { templateId: 'disc.label', selected: true },
      { templateId: 'jewel.obi', selected: false },
      { templateId: 'jewel.ocard', selected: false },
    ],
  },
  {
    id: 'dvd',
    nameKey: 'kit.dvd.name',
    descKey: 'kit.dvd.desc',
    pieces: [
      { templateId: 'dvd.wrap', selected: true },
      { templateId: 'disc.label', selected: true },
      { templateId: 'dvd.slipcover', selected: false },
    ],
  },
  {
    id: 'bluray',
    nameKey: 'kit.bluray.name',
    descKey: 'kit.bluray.desc',
    pieces: [
      { templateId: 'bluray.wrap', selected: true },
      { templateId: 'disc.label', selected: true },
      { templateId: 'bluray.slipcover', selected: false },
    ],
  },
  {
    id: 'sleeve',
    nameKey: 'kit.sleeve.name',
    descKey: 'kit.sleeve.desc',
    pieces: [
      { templateId: 'sleeve.card', selected: true },
      { templateId: 'sleeve.flap', selected: false },
      { templateId: 'sleeve.inner', selected: false },
      { templateId: 'sleeve.slipcase', selected: false },
      { templateId: 'disc.label', selected: true },
    ],
  },
  {
    // Digipak, gatefold and wallet: cardboard covers that open like a book,
    // holding the disc on a tray or in a pocket.
    id: 'digipak',
    nameKey: 'kit.digipak.name',
    descKey: 'kit.digipak.desc',
    pieces: [
      { templateId: 'digipak.4p', selected: true },
      { templateId: 'wallet.six', selected: false },
      { templateId: 'wallet.pocket', selected: false },
      { templateId: 'jewel.booklet1', selected: false },
      { templateId: 'disc.label', selected: true },
      { templateId: 'dvd.digipak', selected: false },
    ],
  },
  {
    id: 'disc',
    nameKey: 'kit.disc.name',
    descKey: 'kit.disc.desc',
    pieces: [{ templateId: 'disc.label', selected: true }],
  },
];

export const getKit = (id: string): KitDef => KITS.find((k) => k.id === id) ?? KITS[0];

/**
 * The pieces a new project starts with. With the pocket among them, the
 * digipaks and wallets hold their disc in it (a tray otherwise).
 */
export function kitPieces(chosen: Pick<KitPiece, 'templateId' | 'params'>[]): Piece[] {
  const pocket = chosen.some((p) => p.templateId === POCKET_ID);
  return chosen.map((p) => makePiece(p.templateId, {
    ...(pocket && getTemplate(p.templateId).discHolder ? { holder: HOLDER_POCKET } : {}),
    ...p.params,
  }));
}

/** Sheets needed for a set of pieces (template ids, or kit pieces with their params), as if every piece had artwork. */
export function estimateSheets(pieces: (string | Pick<KitPiece, 'templateId' | 'params'>)[], print: PrintSettings = DEFAULT_PRINT): { sheets: number; papers: PaperKind[] } {
  const margin = wantedMargin(print);
  // Booklets print as several spreads: expand them like the real export does.
  const fit = { printerMargin: print.printerMargin, margin, minMargin: print.bleed };
  const made = pieces.map((p) => (typeof p === 'string' ? makePiece(p) : makePiece(p.templateId, { ...p.params })));
  const items = expandForPrint(made, fit).map((p, i) => {
    const d = buildDieline(p.templateId, p.params);
    return { key: `${p.id}#${i}`, paper: getTemplate(p.templateId).paper, w: d.w, h: d.h, margin, minMargin: print.bleed };
  });
  const r = impose(items, print.printerMargin);
  return { sheets: r.sheets.length, papers: [...new Set(r.sheets.map((s) => s.paper))] };
}
