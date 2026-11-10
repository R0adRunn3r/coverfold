import Dexie, { type Table } from 'dexie';
import type { Project } from '../core/model';

export interface ProjectRow {
  id: string;
  name: string;
  updatedAt: number;
  data: Project;
  thumb?: Blob;
}

export interface AssetRow {
  /** SHA-256 of the file bytes: identical files are stored once. */
  id: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  blob: Blob;
  /** Smaller copy for the editor (PREVIEW_MAX in assets.ts). */
  preview: Blob;
  createdAt: number;
}

/** A template with the user's own measurements (e.g. a case that differs by a millimetre). */
export interface FormatRow {
  id: string;
  name: string;
  templateId: string;
  params: Record<string, number>;
  createdAt: number;
}

class CoverfoldDB extends Dexie {
  projects!: Table<ProjectRow, string>;
  assets!: Table<AssetRow, string>;
  formats!: Table<FormatRow, string>;

  constructor() {
    super('coverfold');
    this.version(1).stores({ projects: 'id, updatedAt', assets: 'id, createdAt' });
    this.version(2).stores({ projects: 'id, updatedAt', assets: 'id, createdAt', formats: 'id, templateId, createdAt' });
  }
}

/** Shared by the main thread and the export worker (IndexedDB works in both). */
export const db = new CoverfoldDB();
