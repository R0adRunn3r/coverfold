// Which picture the "Enhance with AI" dialog is open for (one at a time).
// The picture list, the inspector and the low-resolution warnings all open it.
import { useSyncExternalStore } from 'react';

let target: string | null = null;
const listeners = new Set<() => void>();

export function openEnhance(assetId: string): void {
  target = assetId;
  listeners.forEach((l) => l());
}

export function closeEnhance(): void {
  target = null;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useEnhanceTarget = (): string | null => useSyncExternalStore(subscribe, () => target);
