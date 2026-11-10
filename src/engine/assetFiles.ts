// Saves pictures as the original files they were imported from, to edit them
// elsewhere and bring them back with "Replace picture".
import { zipSync, type Zippable } from 'fflate';
import { db } from './db';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp',
};

/** Adds the extension the type calls for and replaces characters file systems refuse. */
export function fileNameFor(name: string, type: string): string {
  const clean = (name.trim() || 'image').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const ext = EXT[type];
  if (!ext) return clean;
  const has = /\.([a-z0-9]{2,5})$/i.exec(clean);
  const same = has && (has[1].toLowerCase() === ext || (ext === 'jpg' && has[1].toLowerCase() === 'jpeg'));
  if (same) return clean;
  return `${has ? clean.slice(0, -has[0].length) : clean}.${ext}`;
}

/** Unique within one folder, ignoring case: "a.jpg", "a (2).jpg", ... */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    let out = n;
    const dot = n.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
    for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base} (${i})${ext}`;
    used.add(out.toLowerCase());
    return out;
  });
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadAsset(id: string): Promise<boolean> {
  const row = await db.assets.get(id);
  if (!row) return false;
  save(row.blob, fileNameFor(row.name, row.type));
  return true;
}

/**
 * One picture is saved as is, several in an uncompressed ZIP (pictures are
 * compressed already). Returns how many were saved.
 */
export async function downloadAssets(ids: string[], zipName: string): Promise<number> {
  const rows = (await db.assets.bulkGet(ids)).filter((r): r is NonNullable<typeof r> => !!r);
  if (rows.length === 0) return 0;
  if (rows.length === 1) {
    save(rows[0].blob, fileNameFor(rows[0].name, rows[0].type));
    return 1;
  }
  const names = uniqueNames(rows.map((r) => fileNameFor(r.name, r.type)));
  const files: Zippable = {};
  for (const [i, r] of rows.entries()) files[names[i]] = [new Uint8Array(await r.blob.arrayBuffer()), { level: 0 }];
  save(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), fileNameFor(zipName, '').replace(/\.zip$/i, '') + '.zip');
  return rows.length;
}
