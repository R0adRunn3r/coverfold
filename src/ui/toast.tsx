// Short notices at the bottom of the editor, with an optional action such as
// Undo. They close on their own but stay while hovered so they can be read.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Icon } from './components';
import { useT } from './hooks';

export interface Toast {
  id: number;
  title: string;
  lines?: string[];
  action?: { label: string; run: () => void };
  /** How long it stays (ms). */
  ms: number;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(t: Omit<Toast, 'id' | 'ms'> & { ms?: number }): number {
  const id = nextId++;
  // One at a time: a new notice replaces the old one.
  toasts = [{ ms: 10_000, ...t, id }];
  emit();
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function ToastCard({ toast }: { toast: Toast }) {
  const t = useT();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = (ms: number) => { timer.current = setTimeout(() => dismissToast(toast.id), ms); };
  const stop = () => { if (timer.current) clearTimeout(timer.current); };
  useEffect(() => { start(toast.ms); return stop; }, [toast.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card pointer-events-auto flex w-[min(460px,calc(100vw-32px))] items-start gap-3 p-3 shadow-lg" data-testid="toast"
      onMouseEnter={stop} onMouseLeave={() => start(4000)}>
      <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">{toast.title}</div>
        {toast.lines && toast.lines.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {toast.lines.map((l) => <li key={l} className="break-words">{l}</li>)}
          </ul>
        )}
      </div>
      {toast.action && (
        <button className="btn btn-sm shrink-0" onClick={() => { toast.action!.run(); dismissToast(toast.id); }} data-testid="toast-action">{toast.action.label}</button>
      )}
      <button className="btn btn-ghost btn-icon -m-1 h-7 w-7" onClick={() => dismissToast(toast.id)} aria-label={t('common.close')}><Icon name="x" size={14} /></button>
    </div>
  );
}

/** Where notices show: bottom centre, above the pieces strip. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  // Leaving the editor drops what is still showing.
  useEffect(() => () => { toasts = []; }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {list.map((t) => <ToastCard key={t.id} toast={t} />)}
    </div>
  );
}
