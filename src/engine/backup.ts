// Project backup files (.coverfold): a zip with the project and its original
// images, to keep a copy outside the browser or move a project elsewhere.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { allLayers } from '../core/faces';
import { layerAssetIds, type Project } from '../core/model';
import { importImage } from './assets';
import { db } from './db';
import { saveProject } from './persistence';

const FORMAT = 'coverfold-project';
const VERSION = 1;
export const BACKUP_EXT = '.coverfold';

interface BackupAsset { id: string; name: string; type: string; path: string }
interface BackupFile { format: typeof FORMAT; version: number; project: Project; assets: BackupAsset[] }

export async function exportProjectFile(id: string): Promise<{ bytes: Uint8Array; name: string } | null> {
  const row = await db.projects.get(id);
  if (!row) return null;
  const project = row.data;
  const ids = new Set(project.assetIds);
  for (const p of project.pieces) for (const l of allLayers(p)) layerAssetIds(l).forEach((a) => ids.add(a));
  const files: Zippable = {};
  const assets: BackupAsset[] = [];
  for (const a of await db.assets.bulkGet([...ids])) {
    if (!a) continue;
    const path = `images/${a.id}`;
    // Images are compressed already: store them as is.
    files[path] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }];
    assets.push({ id: a.id, name: a.name, type: a.type, path });
  }
  const data: BackupFile = { format: FORMAT, version: VERSION, project, assets };
  files['project.json'] = strToU8(JSON.stringify(data));
  return { bytes: zipSync(files, { level: 6 }), name: project.name };
}

export class BackupError extends Error {}

/** Always creates a new project (never overwrites one) and returns its id. */
export async function importProjectFile(file: Blob): Promise<string> {
  let files: Record<string, Uint8Array>;
  let data: BackupFile;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    data = JSON.parse(strFromU8(files['project.json']));
  } catch {
    throw new BackupError('invalid');
  }
  if (data?.format !== FORMAT || !Array.isArray(data.project?.pieces)) throw new BackupError('invalid');
  if (data.version > VERSION) throw new BackupError('newer');
  for (const a of data.assets ?? []) {
    const bytes = files[a.path];
    if (!bytes) continue;
    // Asset ids are content hashes: the same image gets the same id here.
    await importImage(new Blob([bytes as BlobPart], { type: a.type }), a.name);
  }
  const taken = await db.projects.get(data.project.id);
  const now = Date.now();
  const project: Project = { ...data.project, id: taken ? crypto.randomUUID() : data.project.id, updatedAt: now };
  await saveProject(project);
  return project.id;
}
