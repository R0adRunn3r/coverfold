// Album data from MusicBrainz and covers from the Cover Art Archive: the only
// part of the app that goes online, and only when the user searches. Both
// allow CORS; they are busy public servers, so 502/503 is retried (net.ts).
import { downloadBlob, fetchRetry, HttpError, sleep, type Progress, type RetryInfo } from './net';

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';

export interface NetOptions {
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
}

// MusicBrainz allows one request per second: calls queue up, 1.1 s apart.
const MB_GAP = 1100;
let lastCall = 0;
let queue: Promise<void> = Promise.resolve();
function mbTurn(signal?: AbortSignal): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastCall + MB_GAP - Date.now();
    if (wait > 0) await sleep(wait, signal);
    lastCall = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

async function mbFetch(path: string, o: NetOptions): Promise<unknown> {
  const r = await fetchRetry(`${MB}${path}`, { headers: { Accept: 'application/json' } }, {
    service: 'MusicBrainz', signal: o.signal, onRetry: o.onRetry, before: () => mbTurn(o.signal),
  });
  if (!r.ok) throw new HttpError(r.status, 'MusicBrainz');
  return r.json();
}

/** Lucene query value: quoted, with quotes and backslashes escaped. */
const quote = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

interface MbArtistCredit { name: string; joinphrase?: string }
const creditName = (c?: MbArtistCredit[]) => (c ?? []).map((a) => a.name + (a.joinphrase ?? '')).join('');

export interface ReleaseHit {
  id: string;
  title: string;
  artist: string;
  date: string;
  country: string;
  format: string;
  tracks: number;
  disambiguation: string;
}

interface MbRelease {
  id: string; title: string; date?: string; country?: string; disambiguation?: string; 'track-count'?: number;
  'artist-credit'?: MbArtistCredit[];
  media?: { format?: string; position?: number; title?: string; tracks?: { position: number; number?: string; title: string; length?: number | null }[] }[];
}

export async function searchReleases(artist: string, album: string, o: NetOptions = {}): Promise<ReleaseHit[]> {
  const parts = [album.trim() && `release:${quote(album.trim())}`, artist.trim() && `artist:${quote(artist.trim())}`].filter(Boolean);
  if (!parts.length) return [];
  const j = (await mbFetch(`/release/?query=${encodeURIComponent(parts.join(' AND '))}&fmt=json&limit=20`, o)) as { releases?: MbRelease[] };
  return (j.releases ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    artist: creditName(r['artist-credit']),
    date: r.date ?? '',
    country: r.country ?? '',
    format: [...new Set((r.media ?? []).map((m) => m.format).filter(Boolean))].join(' + '),
    tracks: r['track-count'] ?? 0,
    disambiguation: r.disambiguation ?? '',
  }));
}

export interface Track { disc: number; n: string; title: string; ms: number | null }
export interface ReleaseDetail { id: string; title: string; artist: string; date: string; discs: number; tracks: Track[] }

export async function getRelease(id: string, o: NetOptions = {}): Promise<ReleaseDetail> {
  const r = (await mbFetch(`/release/${encodeURIComponent(id)}?inc=recordings+artist-credits&fmt=json`, o)) as MbRelease;
  const media = r.media ?? [];
  return {
    id: r.id,
    title: r.title,
    artist: creditName(r['artist-credit']),
    date: r.date ?? '',
    discs: media.length,
    tracks: media.flatMap((m, i) => (m.tracks ?? []).map((t) => ({ disc: m.position ?? i + 1, n: t.number ?? String(t.position), title: t.title, ms: t.length ?? null }))),
  };
}

export interface CoverImage { id: string; types: string[]; front: boolean; thumb: string; large: string; original: string }

const https = (u: string) => u.replace(/^http:/, 'https:');

/** Empty when the archive has none. */
export async function getCovers(id: string, o: NetOptions = {}): Promise<CoverImage[]> {
  const r = await fetchRetry(`${CAA}/release/${encodeURIComponent(id)}`, {}, { service: 'Cover Art Archive', signal: o.signal, onRetry: o.onRetry });
  if (r.status === 404) return [];
  if (!r.ok) throw new HttpError(r.status, 'Cover Art Archive');
  const j = (await r.json()) as { images: { id: string | number; types: string[]; front: boolean; image: string; thumbnails: Record<string, string> }[] };
  return j.images.map((i) => ({
    id: String(i.id),
    types: i.types,
    front: i.front,
    thumb: https(i.thumbnails['500'] ?? i.thumbnails.large ?? i.image),
    large: https(i.thumbnails['1200'] ?? i.image),
    original: https(i.image),
  }));
}

export interface DownloadOptions extends NetOptions {
  onProgress?: (p: Progress) => void;
  /** Called when the original fails and the 1200 px version is tried instead. */
  onFallback?: () => void;
}

/** The original file (best for print), or the 1200 px version when the original keeps failing or stalls. */
export async function downloadCover(c: CoverImage, o: DownloadOptions = {}): Promise<{ blob: Blob; reduced: boolean }> {
  const urls = c.large !== c.original ? [c.original, c.large] : [c.original];
  let last: unknown = null;
  for (const [i, url] of urls.entries()) {
    if (i > 0) o.onFallback?.();
    try {
      const blob = await downloadBlob(url, { service: 'Cover Art Archive', signal: o.signal, onRetry: o.onRetry, onProgress: o.onProgress, attempts: 3 });
      return { blob, reduced: i > 0 };
    } catch (e) {
      if (o.signal?.aborted) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('download failed');
}

const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** One "1. Title  3:41" line per track, with disc headings when there are several discs. */
export function tracklistText(d: ReleaseDetail, discLabel: (n: number) => string): string {
  const lines: string[] = [];
  let disc = 0;
  for (const t of d.tracks) {
    if (d.discs > 1 && t.disc !== disc) {
      disc = t.disc;
      if (lines.length) lines.push('');
      lines.push(discLabel(disc));
    }
    lines.push(`${t.n}. ${t.title}${t.ms ? `  ${mmss(t.ms)}` : ''}`);
  }
  return lines.join('\n');
}
