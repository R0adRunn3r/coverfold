import { useSyncExternalStore } from 'react';

/** Colour theme: follow the operating system, or force light/dark. Stored per browser. */
export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_PREFS: ThemePref[] = ['system', 'light', 'dark'];

// Same key and logic as the inline script in index.html (applied before first paint).
const KEY = 'coverfold.theme';
const listeners = new Set<() => void>();
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* storage blocked: the choice lasts for this page only */ }
  apply(pref);
  listeners.forEach((f) => f());
}

/** Applies the stored theme and follows OS changes while on "system". */
export function initTheme(): void {
  apply(themePref());
  media().addEventListener('change', () => { if (themePref() === 'system') apply('system'); });
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

export const useThemePref = (): ThemePref => useSyncExternalStore(subscribe, themePref);
