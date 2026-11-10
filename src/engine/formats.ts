// The user's saved formats: a template plus measurements, reusable in any project.
import { db, type FormatRow } from './db';

export type SavedFormat = FormatRow;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export const onFormatsChange = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => { listeners.delete(f); };
};

export const listFormats = async (): Promise<SavedFormat[]> => db.formats.orderBy('createdAt').toArray();

export async function saveFormat(name: string, templateId: string, params: Record<string, number>): Promise<SavedFormat> {
  const row: SavedFormat = { id: crypto.randomUUID(), name, templateId, params: { ...params }, createdAt: Date.now() };
  await db.formats.put(row);
  changed();
  return row;
}

export async function deleteFormat(id: string): Promise<void> {
  await db.formats.delete(id);
  changed();
}
