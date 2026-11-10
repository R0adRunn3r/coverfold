import type { Project } from '../core/model';
import type { Editor } from '../core/store';
import { collectGarbage } from './assets';
import { db, type ProjectRow } from './db';
import { renderThumbnail } from './render/preview';

export interface ProjectSummary { id: string; name: string; updatedAt: number; thumb?: Blob; pieces: number }

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await db.projects.orderBy('updatedAt').reverse().toArray();
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, thumb: r.thumb, pieces: r.data.pieces.length }));
}

export const loadProject = async (id: string): Promise<Project | null> => (await db.projects.get(id))?.data ?? null;

export async function saveProject(project: Project, thumb?: Blob): Promise<void> {
  const row: ProjectRow = { id: project.id, name: project.name, updatedAt: project.updatedAt, data: project };
  if (thumb) row.thumb = thumb;
  else {
    const old = await db.projects.get(project.id);
    if (old?.thumb) row.thumb = old.thumb;
  }
  await db.projects.put(row);
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
  await collectGarbage();
}

export async function renameProject(id: string, name: string): Promise<void> {
  const row = await db.projects.get(id);
  if (!row) return;
  row.data = { ...row.data, name, updatedAt: Date.now() };
  row.name = name;
  row.updatedAt = row.data.updatedAt;
  await db.projects.put(row);
}

export async function duplicateProject(id: string, suffix: string): Promise<string | null> {
  const row = await db.projects.get(id);
  if (!row) return null;
  const copy: Project = { ...structuredClone(row.data), id: crypto.randomUUID(), name: `${row.name} ${suffix}`, createdAt: Date.now(), updatedAt: Date.now() };
  await db.projects.put({ id: copy.id, name: copy.name, updatedAt: copy.updatedAt, data: copy, thumb: row.thumb });
  return copy.id;
}

export type SaveStatus = 'saved' | 'saving' | 'error';

/**
 * Saves the open project shortly after every change. The thumbnail is
 * refreshed less often because it is the expensive part.
 */
export function attachAutosave(editor: Editor, onStatus: (s: SaveStatus) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastThumb = 0;
  let pending: Project | null = null;

  const flush = async () => {
    timer = null;
    const project = pending;
    pending = null;
    if (!project) return;
    try {
      let thumb: Blob | undefined;
      if (Date.now() - lastThumb > 4000) {
        lastThumb = Date.now();
        thumb = (await renderThumbnail(project)) ?? undefined;
      }
      await saveProject(project, thumb);
      onStatus(pending ? 'saving' : 'saved');
    } catch (e) {
      console.error(e);
      onStatus('error');
    }
  };

  const unsub = editor.store.subscribe((s, prev) => {
    if (!s.project || s.project === prev.project || prev.project?.id !== s.project.id) return;
    pending = s.project;
    onStatus('saving');
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 600);
  });

  const onUnload = () => {
    if (pending) void saveProject(pending);
  };
  window.addEventListener('beforeunload', onUnload);

  return () => {
    unsub();
    window.removeEventListener('beforeunload', onUnload);
    if (timer) clearTimeout(timer);
    if (pending) void flush();
  };
}
