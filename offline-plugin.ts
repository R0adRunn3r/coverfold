// Build-time service worker for offline use (PWA): after the first visit every
// file of the build is cached. Hand-written (no Workbox) so it caches exactly
// the build output and nothing else.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

function listPublic(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listPublic(p, root) : [relative(root, p).replace(/\\/g, '/')];
  });
}

// The AI engine's .wasm (about 29 MB) is not part of the install: it is cached
// on first use, in its own cache that survives app updates while unchanged.
export const isLazy = (f: string) => f.endsWith('.wasm');
/** The AI models (75 MB) are fetched and cached by the app itself, one at a time, when chosen. */
const onDemand = (f: string) => f.startsWith('models/');
/** Files for crawlers, link previews and missing pages, not for the app: never cached. */
const NOT_APP = new Set(['og-image.jpg', 'robots.txt', 'sitemap.xml', '404.html']);
const shareOnly = (f: string) => NOT_APP.has(f);

const swSource = (files: string[], lazy: string[], version: string) => `// Coverfold offline cache (generated at build time).
const CACHE = 'coverfold-${version}';
const LAZY = 'coverfold-lazy';
const FILES = ${JSON.stringify(['./', ...files])};
const LAZY_FILES = ${JSON.stringify(lazy)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Old app versions go; the AI models (coverfold-ai-*) and still-used lazy files stay.
  const keepLazy = new Set(LAZY_FILES.map((f) => new URL(f, self.registration.scope).href));
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('coverfold-') && k !== CACHE && k !== LAZY && !k.startsWith('coverfold-ai-')).map((k) => caches.delete(k))))
    .then(() => caches.open(LAZY))
    .then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => !keepLazy.has(r.url)).map((r) => c.delete(r)))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Pages: network first (fresh version when online), cached app when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true, ignoreVary: true })));
    return;
  }
  // Build files are content-hashed: cache first.
  // ignoreVary: module scripts and styles are requested with an Origin header the cached copy lacks.
  e.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res.ok && url.pathname.endsWith('.wasm')) {
        const copy = res.clone();
        caches.open(LAZY).then((c) => c.put(url.href, copy)).catch(() => undefined);
      }
      return res;
    });
  }));
});
`;

export function offline(): Plugin {
  let publicDir = '';
  return {
    name: 'coverfold-offline',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { publicDir = c.publicDir; },
    generateBundle(_, bundle) {
      const all = [...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...listPublic(publicDir)].filter((f) => f !== 'sw.js');
      const files = all.filter((f) => !isLazy(f) && !onDemand(f) && !shareOnly(f)).sort();
      const lazy = all.filter(isLazy).sort();
      // New build files or new worker code give a new cache name; old caches are dropped on activate.
      const version = createHash('sha256').update([...files, ...lazy].join('|') + swSource([], [], '')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(files, lazy, version) });
    },
  };
}
