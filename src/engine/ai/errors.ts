// AI upscaler errors, grouped by what the user can do about them. The UI
// shows a message per code (ai.error.<code>) and the matching actions.

export type AiErrorCode =
  /** No internet and the model is not downloaded yet. */
  | 'offline'
  /** The download failed (server, connection dropped). */
  | 'network'
  /** The downloaded file is not the expected one. */
  | 'integrity'
  /** The browser refused to store the model (disk full, private window). */
  | 'storage'
  | 'aborted'
  /** The graphics card failed or ran out of memory. */
  | 'gpu'
  /** The picture is too big to process here. */
  | 'memory'
  /** Anything else (a bug): the message has the details. */
  | 'internal';

export class AiError extends Error {
  constructor(readonly code: AiErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'AiError';
  }
}

export const isAbort = (e: unknown): boolean => (e instanceof AiError && e.code === 'aborted') || (e instanceof DOMException && e.name === 'AbortError');

/** Any thrown value as an AiError (errors cross the worker boundary as plain Errors). */
export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (isAbort(e)) return new AiError('aborted');
  const msg = e instanceof Error ? e.message : String(e);
  const m = /^AiError:(\w+):?(.*)$/s.exec(msg);
  if (m) return new AiError(m[1] as AiErrorCode, m[2] || undefined);
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return new AiError('storage', msg);
  if (/out of memory|OOM|allocation failed|Array buffer allocation|Invalid typed array length/i.test(msg)) return new AiError('memory', msg);
  if (/GPU|WebGPU|device (was )?lost|GPUBuffer|mapAsync/i.test(msg)) return new AiError('gpu', msg);
  return new AiError('internal', msg);
}

/** How an AiError is sent across the worker boundary (Comlink keeps only the message). */
export const encodeAiError = (e: unknown): Error => {
  const a = toAiError(e);
  return new Error(`AiError:${a.code}:${a.message === a.code ? '' : a.message}`);
};
