import { useEffect, useState, useSyncExternalStore } from 'react';
import { i18n, t } from '../i18n';

/** Re-renders the component when the language changes. */
export function useT(): typeof t {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    i18n.on('languageChanged', on);
    return () => i18n.off('languageChanged', on);
  }, []);
  return t;
}

export type Route = { name: 'home' } | { name: 'new' } | { name: 'editor'; id: string };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'new') return { name: 'new' };
  const m = /^p\/(.+)$/.exec(h);
  if (m) return { name: 'editor', id: decodeURIComponent(m[1]) };
  return { name: 'home' };
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** Hash routing: works on any static host (GitHub Pages included) without 404s. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parse(hash);
}

export function navigate(route: Route): void {
  const hash = route.name === 'home' ? '#/' : route.name === 'editor' ? `#/p/${encodeURIComponent(route.id)}` : `#/${route.name}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}
