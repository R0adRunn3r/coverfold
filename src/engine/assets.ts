import { db, type AssetRow } from './db';

export interface AssetInfo { id: string; name: string; width: number; height: number; size: number; type: string }

export const PREVIEW_MAX = 2048;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'];

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const info = (r: AssetRow): AssetInfo => ({ id: r.id, name: r.name, width: r.width, height: r.height, size: r.size, type: r.type });

async function makePreview(bitmap: ImageBitmap): Promise<Blob> {
  const k = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  // WebP keeps transparency (logos) and stays small for photos.
  return c.convertToBlob({ type: 'image/webp', quality: 0.9 });
}

/** Deduplicated by content hash. */
export async function importImage(file: Blob, name: string): Promise<AssetInfo> {
  const bytes = await file.arrayBuffer();
  const id = toHex(await crypto.subtle.digest('SHA-256', bytes));
  const existing = await db.assets.get(id);
  if (existing) return info(existing);
  const bitmap = await createImageBitmap(file);
  try {
    const row: AssetRow = {
      id,
      name,
      type: file.type,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      blob: file,
      preview: await makePreview(bitmap),
      createdAt: Date.now(),
    };
    await db.assets.put(row);
    return info(row);
  } finally {
    bitmap.close();
  }
}

export async function getAssetInfos(ids: string[]): Promise<AssetInfo[]> {
  const rows = await db.assets.bulkGet(ids);
  return rows.filter((r): r is AssetRow => !!r).map(info);
}

const previews = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap | null>>();

/** Null until loadPreview has finished. */
export function getPreview(id: string): ImageBitmap | null {
  return previews.get(id) ?? null;
}

export function loadPreview(id: string): Promise<ImageBitmap | null> {
  const hit = previews.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = db.assets.get(id).then(async (row) => {
      if (!row) return null;
      const bmp = await createImageBitmap(row.preview);
      previews.set(id, bmp);
      return bmp;
    }).finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

/** The caller must close() it. */
export async function loadOriginal(id: string): Promise<ImageBitmap | null> {
  const row = await db.assets.get(id);
  return row ? createImageBitmap(row.blob) : null;
}

/** Deletes assets no project references and returns how many. */
export async function collectGarbage(): Promise<number> {
  const used = new Set<string>();
  await db.projects.each((p) => p.data.assetIds.forEach((id) => used.add(id)));
  const all = await db.assets.toCollection().primaryKeys();
  const unused = all.filter((id) => !used.has(id));
  await db.assets.bulkDelete(unused);
  for (const id of unused) {
    previews.get(id)?.close();
    previews.delete(id);
  }
  return unused.length;
}
