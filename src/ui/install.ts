import { useSyncExternalStore } from 'react';

/** Chrome/Edge "install this app" prompt, kept until the user asks for it. */
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  notify();
});
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

export async function installApp(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  notify();
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** True when the browser offers to install the app (only for the built app, over https or localhost). */
export const useCanInstall = (): boolean => useSyncExternalStore(subscribe, () => deferred !== null);
