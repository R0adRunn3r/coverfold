import { layerBounds } from './align';
import { facePanels, panelSafeRect } from './layout';
import type { Layer, Project } from './model';
import { faceDieline, faceIds, faceLayers, isMultiPage, pageNumber, pieceHasContent } from './faces';
import { getTemplate } from './templates/catalog';
import type { Side } from './templates/types';
import { effectiveDpi } from './units';
import { qrProblem } from './qrLayer';
import { croppedPixels } from './crop';
import { holderOf, holderPanel, pocketFits, pocketSize, projectPocket } from './discHolder';

export type IssueKind = 'veryLowDpi' | 'lowDpi' | 'textOutsideSafe' | 'textOnFold' | 'emptyPiece' | 'insideIgnored'
  | 'qrEmpty' | 'qrTooLong' | 'qrLogoBig' | 'qrSmall' | 'qrContrast' | 'qrOnFold' | 'pocketTooBig';

export interface Issue {
  kind: IssueKind;
  severity: 'warning' | 'error';
  pieceId: string;
  side: Side;
  layerId?: string;
  /** Extra values for the message (e.g. dpi). */
  values?: Record<string, string | number>;
}

export const LOW_DPI = 200;
export const VERY_LOW_DPI = 120;

/** Effective print resolution of an image layer at its current size. */
export const layerDpi = (l: Layer): number | null => {
  if (l.type !== 'image') return null;
  const px = croppedPixels(l);
  return Math.min(effectiveDpi(px.w, l.w), effectiveDpi(px.h, l.h));
};

/** Non-blocking checks shown before printing. */
export function preflight(project: Project): Issue[] {
  const issues: Issue[] = [];
  const pocket = projectPocket(project);
  for (const piece of project.pieces) {
    const faces = faceIds(piece);
    // The project's pocket has to go inside the panel it is glued on.
    const panel = pocket && holderOf(piece) === 'pocket' ? holderPanel(piece) : null;
    if (pocket && panel && !pocketFits(pocketSize(pocket), panel)) {
      const size = pocketSize(pocket);
      issues.push({ kind: 'pocketTooBig', severity: 'warning', pieceId: piece.id, side: 'inside', values: { w: size.w, h: size.h, pw: panel.rect.w, ph: panel.rect.h } });
    }
    if (!pieceHasContent(piece)) {
      issues.push({ kind: 'emptyPiece', severity: 'warning', pieceId: piece.id, side: faces[0] });
    }
    // Faces that only print on the back of the sheet (inside, or inner booklet pages).
    const backFaces = isMultiPage(piece)
      ? faces.filter((f) => { const n = pageNumber(f)!; return n !== 1 && n !== faces.length; })
      : getTemplate(piece.templateId).sides.filter((f) => f === 'inside');
    const hidden = backFaces.find((f) => faceLayers(piece, f).some((l) => l.visible));
    if (project.print.duplex === 'none' && hidden) {
      issues.push({ kind: 'insideIgnored', severity: 'warning', pieceId: piece.id, side: hidden });
    }
    for (const side of faces) {
      const d = faceDieline(piece, side);
      const panels = facePanels(d, side);
      for (const l of faceLayers(piece, side)) {
        if (!l.visible) continue;
        const dpi = layerDpi(l);
        if (dpi !== null && dpi < VERY_LOW_DPI) issues.push({ kind: 'veryLowDpi', severity: 'error', pieceId: piece.id, side, layerId: l.id, values: { dpi: Math.round(dpi) } });
        else if (dpi !== null && dpi < LOW_DPI) issues.push({ kind: 'lowDpi', severity: 'warning', pieceId: piece.id, side, layerId: l.id, values: { dpi: Math.round(dpi) } });
        if (l.type === 'qr') {
          const problem = qrProblem(l);
          if (problem) {
            const kind = (`qr${problem[0].toUpperCase()}${problem.slice(1)}`) as IssueKind;
            issues.push({ kind, severity: problem === 'empty' || problem === 'tooLong' ? 'error' : 'warning', pieceId: piece.id, side, layerId: l.id });
          }
        }
        if (!(l.type === 'text' && l.text.trim()) && l.type !== 'qr') continue;
        const b = layerBounds(l);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const home = panels.find((p) => cx >= p.rect.x && cx <= p.rect.x + p.rect.w && cy >= p.rect.y && cy <= p.rect.y + p.rect.h);
        if (!home || home.shape === 'disc') continue;
        const s = panelSafeRect(home);
        const eps = 0.05;
        const outside = b.x < s.x - eps || b.y < s.y - eps || b.x + b.w > s.x + s.w + eps || b.y + b.h > s.y + s.h + eps;
        const crossesFold = d.folds.some((f) => (f.x1 === f.x2 ? f.x1 > b.x + eps && f.x1 < b.x + b.w - eps && b.y < Math.max(f.y1, f.y2) && b.y + b.h > Math.min(f.y1, f.y2)
          : f.y1 > b.y + eps && f.y1 < b.y + b.h - eps && b.x < Math.max(f.x1, f.x2) && b.x + b.w > Math.min(f.x1, f.x2)));
        if (crossesFold) issues.push({ kind: l.type === 'qr' ? 'qrOnFold' : 'textOnFold', severity: 'warning', pieceId: piece.id, side, layerId: l.id });
        else if (outside && l.type === 'text') issues.push({ kind: 'textOutsideSafe', severity: 'warning', pieceId: piece.id, side, layerId: l.id });
      }
    }
  }
  return issues;
}
