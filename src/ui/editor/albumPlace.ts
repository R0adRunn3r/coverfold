// Puts an imported album into the project: each downloaded cover on the panel
// chosen for it, title and tracklist as text, all as one undo step. Text is
// white over a picture and dark on a blank panel.
import { onPanel, type PanelChoice } from '../../core/albumTargets';
import { makeTextLayer } from '../../core/model';
import type { FaceRef } from '../../core/store';
import type { AssetInfo } from '../../engine/assets';
import { tracklistText, type ReleaseDetail } from '../../engine/musicbrainz';
import { editor } from '../editorInstance';

export interface AlbumCover { asset: AssetInfo; target: PanelChoice | null }

export interface AlbumTexts {
  detail: ReleaseDetail;
  titles: PanelChoice | null;
  tracklist: PanelChoice | null;
  rename: string | null;
  discLabel: (n: number) => string;
}

const face = (c: PanelChoice): FaceRef => ({ pieceId: c.pieceId, side: c.side });

/** Places everything; returns the first picture placed (to show it), if any. */
export function placeAlbum(covers: AlbumCover[], texts: AlbumTexts): { face: FaceRef; layerId: string } | null {
  const pictured = new Set(covers.filter((c) => c.target).map((c) => c.target!.key));
  let first: { face: FaceRef; layerId: string } | null = null;
  editor.batch(() => {
    editor.addAssets(covers.map((c) => c.asset.id));
    for (const c of covers) {
      if (!c.target) continue;
      const id = editor.placeImage(c.asset, c.target.panel.id, undefined, face(c.target));
      if (id && !first) first = { face: face(c.target), layerId: id };
    }
    const { detail, titles, tracklist } = texts;
    if (titles) {
      const p = titles.panel, r = p.rect, safe = p.safe;
      const color = pictured.has(titles.key) ? '#ffffff' : '#111111';
      const title = makeTextLayer(detail.title, { x: r.x + safe, y: r.y + safe + 6, w: r.w - 2 * safe, h: 12 }, { fontFamily: 'Bebas Neue', fontSize: 32, align: 'center', color });
      const artist = makeTextLayer(detail.artist, { x: r.x + safe, y: r.y + safe + 22, w: r.w - 2 * safe, h: 7 }, { fontFamily: 'Oswald', fontSize: 14, align: 'center', letterSpacing: 0.08, color });
      for (const l of [title, artist]) editor.addLayer({ ...l, ...onPanel(l, p) }, false, face(titles));
    }
    if (tracklist && detail.tracks.length) {
      const p = tracklist.panel, r = p.rect, safe = p.safe;
      const text = tracklistText(detail, texts.discLabel);
      const lines = text.split('\n').length;
      // As large as fits the panel's height (9 pt at most, 5 pt at least).
      const room = r.h - 2 * safe - 12;
      const size = Math.max(5, Math.min(9, Math.floor((room / (lines * 0.3528 * 1.5)) * 2) / 2));
      const box = { x: r.x + safe + 6, y: r.y + safe + 6, w: r.w - 2 * safe - 12, h: lines * size * 0.3528 * 1.5 };
      const color = pictured.has(tracklist.key) ? '#ffffff' : '#111111';
      const l = makeTextLayer(text, box, { fontSize: size, lineHeight: 1.5, mode: 'tracklist', color });
      editor.addLayer({ ...l, ...onPanel(l, p) }, false, face(tracklist));
    }
    if (texts.rename) editor.rename(texts.rename);
  });
  return first;
}
