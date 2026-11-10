import * as Comlink from 'comlink';
import type { Project } from '../../core/model';
import type { PrintStrings } from '../../core/printPlan';
import type { ExportWorkerApi, ProgressFn } from './export.worker';

let remote: Comlink.Remote<ExportWorkerApi> | null = null;
let worker: Worker | null = null;

function exportWorker(): Comlink.Remote<ExportWorkerApi> {
  if (!remote) {
    worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module', name: 'coverfold-export' });
    remote = Comlink.wrap<ExportWorkerApi>(worker);
  }
  return remote;
}

/** Terminates the worker; the next call creates a new one. */
export function cancelExport(): void {
  worker?.terminate();
  worker = null;
  remote = null;
}

export async function exportPdf(project: Project, strings: PrintStrings, onProgress?: ProgressFn): Promise<Uint8Array> {
  return exportWorker().exportPdf(structuredClone(project), strings, onProgress ? Comlink.proxy(onProgress) : undefined);
}

export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/pdf'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeFileName = (name: string) => (name.trim() || 'coverfold').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
