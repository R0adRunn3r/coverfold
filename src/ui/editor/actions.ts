import { layerPanel } from '../../core/align';
import { facePanels } from '../../core/layout';
import { isPicturePanel } from '../../core/placement';
import { activeLayers, activePiece, selectedLayers, type EditorState } from '../../core/store';
import { solidFootprint } from '../../core/qrLogo';
import { fitLogoSize } from '../../core/qrLayer';
import { imageFootprint } from '../../engine/render/footprint';
import { faceDieline, faceLayers } from '../../core/faces';
import type { PanelDef } from '../../core/templates/types';
import { ACCEPTED_TYPES, importImage, loadPreview, type AssetInfo } from '../../engine/assets';
import { db } from '../../engine/db';
import { t } from '../../i18n';
import { editor } from '../editorInstance';

/** The panel new content goes to by default: the front if there is one. */
export function mainPanel(panels: PanelDef[]): PanelDef {
  return panels.find((p) => p.id === 'front' || p.id === 'disc') ?? panels.find((p) => p.labelKey !== 'panel.hidden' && p.rect.w > 20) ?? panels[0];
}

/** Panels of the open face that can take a picture and have none yet. */
function emptyPanels(s: EditorState = editor.store.getState()): PanelDef[] {
  const piece = activePiece(s);
  if (!piece) return [];
  const d = faceDieline(piece, s.selection.side);
  const layers = faceLayers(piece, s.selection.side);
  return facePanels(d, s.selection.side).filter((p) => isPicturePanel(p)
    && !layers.some((l) => l.type === 'image' && layerPanel(l, d, s.selection.side)?.id === p.id));
}

/** Panel the (first) selected layer sits on. */
export function selectedPanel(s: EditorState = editor.store.getState()): PanelDef | undefined {
  const piece = activePiece(s);
  const l = selectedLayers(s)[0];
  return piece && l ? layerPanel(l, faceDieline(piece, s.selection.side), s.selection.side) : undefined;
}

/**
 * Where a click on a library image puts it: the first panel without a
 * picture (so clicking a few images in a row dresses the whole piece), else
 * the selected layer's panel, else free in the middle.
 */
export function clickTarget(s: EditorState = editor.store.getState()): { panel: PanelDef | undefined; why: 'empty' | 'selected' | 'free' } {
  const empty = emptyPanels(s)[0];
  if (empty) return { panel: empty, why: 'empty' };
  const sel = selectedPanel(s);
  return sel && isPicturePanel(sel) ? { panel: sel, why: 'selected' } : { panel: undefined, why: 'free' };
}

export function placeAssetSmart(asset: AssetInfo): void {
  editor.placeImage(asset, clickTarget().panel?.id ?? null);
}

export async function importFiles(files: File[]): Promise<AssetInfo[]> {
  const out: AssetInfo[] = [];
  for (const f of files) {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      alert(t('editor.unsupported', { name: f.name }));
      continue;
    }
    out.push(await importImage(f, f.name));
  }
  editor.addAssets(out.map((a) => a.id));
  return out;
}

/** Files dropped on the canvas: the first fills the panel under the pointer, the others fill empty panels. */
export async function dropFiles(files: File[], panelId: string | null, at: { x: number; y: number }): Promise<void> {
  const assets = await importFiles(files);
  assets.forEach((a, i) => {
    if (i === 0) editor.placeImage(a, panelId, at);
    else {
      const free = emptyPanels()[0];
      if (free) editor.placeImage(a, free.id);
    }
  });
}

export async function dropAsset(assetId: string, panelId: string | null, at: { x: number; y: number }): Promise<void> {
  const row = await db.assets.get(assetId);
  if (row) editor.placeImage({ id: row.id, name: row.name, width: row.width, height: row.height }, panelId, at);
}

/** A few representative colours of the project images (for backgrounds). */
export async function dominantColors(assetIds: string[], max = 10): Promise<string[]> {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (const id of assetIds.slice(0, 6)) {
    const row = await db.assets.get(id);
    if (!row) continue;
    const bmp = await createImageBitmap(row.preview, { resizeWidth: 48, resizeHeight: 48 });
    const c = new OffscreenCanvas(48, 48);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const data = ctx.getImageData(0, 0, 48, 48).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = `${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`;
      const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(key, b);
    }
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, max).map((b) => `#${hex(b.r / b.n)}${hex(b.g / b.n)}${hex(b.b / b.n)}`);
}

/**
 * Puts a picture in the middle of a QR code, as big as it safely can be.
 * Its transparent parts are measured once, so the code keeps every module
 * the logo does not really cover.
 */
export async function setQrLogo(layerId: string, asset: AssetInfo): Promise<void> {
  const bmp = await loadPreview(asset.id);
  const layer = activeLayers(editor.store.getState()).find((l) => l.id === layerId);
  if (!layer || layer.type !== 'qr') return;
  const footprint = bmp ? imageFootprint(bmp, asset.width, asset.height) : solidFootprint(asset.width, asset.height);
  const logo = { assetId: asset.id, name: asset.name, naturalW: asset.width, naturalH: asset.height, footprint };
  editor.updateLayer(layerId, { logo: { ...logo, size: fitLogoSize(layer, logo) } });
}
