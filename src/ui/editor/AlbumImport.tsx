// "Search album online": find an edition on MusicBrainz, choose where each
// cover and text goes, then download and place everything. Busy servers are
// retried with the wait shown; the import blocks the dialog until done or cancelled.
import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultAlbumPlan, picturePanels, type PanelChoice } from '../../core/albumTargets';
import { isMultiPage } from '../../core/faces';
import type { Project } from '../../core/model';
import { activePiece } from '../../core/store';
import { getTemplate } from '../../core/templates/catalog';
import { importImage, type AssetInfo } from '../../engine/assets';
import {
  downloadCover, getCovers, getRelease, searchReleases, tracklistText,
  type CoverImage, type NetOptions, type ReleaseDetail, type ReleaseHit,
} from '../../engine/musicbrainz';
import { HttpError, NetworkError, StalledError, type RetryInfo } from '../../engine/net';
import { formatBytes, Icon, Modal, ProgressBar, Spinner } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';
import { showToast } from '../toast';
import { placeAlbum } from './albumPlace';

type T = ReturnType<typeof useT>;
type Phase = 'idle' | 'searching' | 'loading' | 'covers' | 'importing';
/** Where a cover goes: not imported, only into the image library, or onto a panel (its key). */
type Dest = 'skip' | 'library' | string;
interface Retry { info: RetryInfo; at: number }

/** Plain words for what went wrong, and what to do about it. */
function describeError(t: T, e: unknown): string {
  if (e instanceof HttpError) return t(e.busy ? 'album.errBusy' : 'album.errHttp', { service: e.service, status: e.status });
  if (e instanceof NetworkError) return t('album.errOffline', { service: e.service });
  if (e instanceof StalledError) return t('album.errStalled', { service: e.service });
  return t('album.error', { message: e instanceof Error ? e.message : String(e) });
}

/** Retry countdown, e.g. "Server busy (503): trying again in 3 s, attempt 2 of 4". */
function RetryNote({ retry }: { retry: Retry }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const s = Math.ceil((retry.at - now) / 1000);
  const vars = { status: retry.info.status, s, n: retry.info.attempt, of: retry.info.of };
  return (
    <p className="text-xs leading-relaxed text-warn" data-testid="album-retry">
      {t(s <= 0 ? 'album.retryNow' : retry.info.status ? 'album.retryBusy' : 'album.retryOffline', vars)}
    </p>
  );
}

/** What the dialog is waiting for, with the retry countdown when a server is busy. */
function Busy({ label, retry }: { label: string; retry: Retry | null }) {
  return (
    <div className="space-y-1.5 p-3" role="status">
      <p className="flex items-center gap-2 text-sm text-muted"><Spinner />{label}</p>
      {retry && <RetryNote retry={retry} />}
    </div>
  );
}

/** Cover Art Archive types in the user's language ("Back, Spine" -> "Retro, Dorso"). */
const typeLabel = (t: T, c: CoverImage) => (c.types.length ? c.types : ['Other']).map((x) => t(`album.type.${x}`, { defaultValue: x })).join(', ');

interface Group { label: string; items: { key: string; label: string; rank: number }[] }

/** Order inside a face: the front first, then pages by number, the back last. */
function panelRank(c: PanelChoice, i: number): number {
  const p = c.panel;
  if (p.id === 'front' || p.labelKey === 'panel.cover') return -1000;
  if (p.id === 'back' || p.labelKey === 'panel.backCover') return 1000;
  const page = /page(\d+)$/.exec(p.labelKey);
  return page ? Number(page[1]) : i;
}

/** Panels as <optgroup>s: one per piece face, or one per piece for stapled booklets. */
function panelGroups(t: T, project: Project, choices: PanelChoice[]): Group[] {
  const names = project.pieces.map((p) => t(getTemplate(p.templateId).nameKey));
  const pieceName = (i: number) => (names.filter((n) => n === names[i]).length > 1 ? `${names[i]} ${names.slice(0, i + 1).filter((n) => n === names[i]).length}` : names[i]);
  const groups = new Map<string, Group>();
  for (const c of choices) {
    const piece = project.pieces[c.pieceIndex];
    const multi = isMultiPage(piece);
    const id = multi ? c.pieceId : `${c.pieceId}|${c.side}`;
    const face = multi ? '' : t(`side.${c.side}`);
    const label = project.pieces.length > 1 ? [pieceName(c.pieceIndex), face].filter(Boolean).join(', ') : face || pieceName(c.pieceIndex);
    if (!groups.has(id)) groups.set(id, { label, items: [] });
    const g = groups.get(id)!;
    g.items.push({ key: c.key, label: t(c.panel.labelKey, c.panel.labelVars ?? {}), rank: panelRank(c, g.items.length) });
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.rank - b.rank);
  return [...groups.values()];
}

/** The group (piece and face) of a panel, shown under a menu: the menu itself only shows "Back". */
const groupOf = (groups: Group[], key: string) => groups.find((g) => g.items.some((i) => i.key === key))?.label ?? '';

/** A panel named the way the select shows it, with its piece and face. */
function choiceName(groups: Group[], key: string): string {
  for (const g of groups) {
    const item = g.items.find((i) => i.key === key);
    if (item) return groups.length > 1 || g.label ? `${g.label}, ${item.label}` : item.label;
  }
  return key;
}

function PanelSelect({ value, onChange, groups, ariaLabel, extra, disabled, testId }: {
  value: string; onChange: (v: string) => void; groups: Group[]; ariaLabel: string;
  extra?: { value: string; label: string }[]; disabled?: boolean; testId?: string;
}) {
  const where = groupOf(groups, value);
  return (
    <div className="min-w-0">
      <select className="field py-1 text-xs" value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} disabled={disabled} data-testid={testId}
        title={where ? choiceName(groups, value) : undefined}>
        {extra?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </optgroup>
        ))}
      </select>
      {groups.length > 1 && (
        <p className={`mt-0.5 truncate px-0.5 text-[10px] leading-tight text-muted ${disabled ? 'opacity-50' : ''}`} title={where}>{where || '\u00a0'}</p>
      )}
    </div>
  );
}

/** A cover: click the picture to include it or not; the menu says where it goes. */
function CoverCard({ cover, dest, onToggle, onDest, groups, lazy }: {
  cover: CoverImage; dest: Dest; onToggle: () => void; onDest: (d: Dest) => void; groups: Group[]; lazy: boolean;
}) {
  const t = useT();
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load');
  const label = typeLabel(t, cover);
  const on = dest !== 'skip';
  return (
    <div className={`overflow-hidden rounded-md border-2 ${on ? 'border-accent' : 'border-line'}`} data-testid="album-cover">
      <button type="button" className="relative block aspect-square w-full bg-subtle" onClick={onToggle} aria-pressed={on} title={t(on ? 'album.coverExclude' : 'album.coverInclude')}>
        {state === 'load' && <span className="absolute inset-0 flex items-center justify-center text-muted"><Spinner /></span>}
        {state === 'err' && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-[11px] leading-tight text-muted">
            <Icon name="image" size={20} />{t('album.noPreview')}
          </span>
        )}
        <img src={cover.thumb} alt={label} loading={lazy ? 'lazy' : 'eager'} onLoad={() => setState('ok')} onError={() => setState('err')}
          className={`h-full w-full object-cover transition-opacity ${state === 'ok' ? '' : 'invisible'} ${on ? '' : 'opacity-40'}`} />
        <span className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? 'border-accent bg-accent text-white' : 'border-white/90 bg-black/30'}`} aria-hidden="true">
          {on && <Icon name="check" size={12} />}
        </span>
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-left text-[11px] text-white">{label}</span>
      </button>
      <div className="border-t border-line p-1">
        <PanelSelect value={dest} onChange={onDest} groups={groups} ariaLabel={t('album.coverWhere', { type: label })} testId="album-cover-dest"
          extra={[{ value: 'skip', label: t('album.skip') }, { value: 'library', label: t('album.libraryOnly') }]} />
      </div>
    </div>
  );
}

interface Step {
  id: string;
  label: string;
  state: 'wait' | 'run' | 'prep' | 'done' | 'fail';
  loaded: number;
  total: number | null;
  retry: Retry | null;
  /** The original would not download: the 1200 px version was used. */
  reduced: boolean;
  error?: string;
}

/** The import in progress: one line per picture, then placing; blocks the dialog until done or cancelled. */
function ImportProgress({ steps, placing, partial, onCancel, onRetry, onSkip }: {
  steps: Step[]; placing: boolean; partial: boolean; onCancel: () => void; onRetry: () => void; onSkip: () => void;
}) {
  const t = useT();
  const failed = steps.filter((s) => s.state === 'fail').length;
  const list = useRef<HTMLUListElement>(null);
  const running = steps.findIndex((s) => s.state === 'run' || s.state === 'prep');
  // Long lists scroll: keep the picture being downloaded in view.
  useEffect(() => {
    list.current?.querySelector('[data-state="run"], [data-state="prep"]')?.scrollIntoView({ block: 'nearest' });
  }, [running]);
  const icon = (s: Step['state']) =>
    s === 'done' ? <Icon name="check" size={16} className="text-ok" />
      : s === 'fail' ? <Icon name="alert" size={16} className="text-danger" />
        : s === 'wait' ? <span className="mx-[3px] inline-block h-2.5 w-2.5 rounded-full border-2 border-line" />
          : <Spinner className="text-accent" />;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/85 p-4 backdrop-blur-[2px]" data-testid="album-progress">
      <div className="card flex max-h-full w-full max-w-md flex-col gap-3 p-4 shadow-xl" role="alertdialog" aria-labelledby="album-progress-title" aria-busy={!partial}>
        <div>
          <h3 id="album-progress-title" className="flex items-center gap-2 font-semibold">
            {partial ? <Icon name="alert" className="text-warn" /> : <Spinner className="text-accent" />}
            {partial ? t('album.partial', { count: failed }) : t('album.busyTitle')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t(partial ? 'album.partialHint' : 'album.busyHint')}</p>
        </div>
        <ul ref={list} className="min-h-0 space-y-2.5 overflow-y-auto pr-1">
          {steps.map((s) => (
            <li key={s.id} className="space-y-1" data-testid="album-step" data-state={s.state}>
              <div className="flex items-center gap-2 text-sm">
                <span className="flex w-5 shrink-0 justify-center">{icon(s.state)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {s.state === 'wait' && t('album.stepWait')}
                  {s.state === 'run' && (s.total ? t('album.stepOf', { loaded: formatBytes(s.loaded), total: formatBytes(s.total) }) : s.loaded ? formatBytes(s.loaded) : t('album.stepStart'))}
                  {s.state === 'prep' && t('album.stepPrep')}
                  {s.state === 'done' && formatBytes(s.loaded)}
                  {s.state === 'fail' && t('album.stepFail')}
                </span>
              </div>
              {s.state === 'run' && <div className="pl-7"><ProgressBar value={s.total ? s.loaded / s.total : null} label={s.label} /></div>}
              {s.reduced && s.state !== 'fail' && <p className="pl-7 text-[11px] leading-relaxed text-warn">{t('album.stepReduced')}</p>}
              {s.retry && s.state === 'run' && <div className="pl-7"><RetryNote retry={s.retry} /></div>}
              {s.error && <p className="pl-7 text-[11px] leading-relaxed text-danger">{s.error}</p>}
            </li>
          ))}
          <li className="flex items-center gap-2 text-sm" data-testid="album-step-place">
            <span className="flex w-5 shrink-0 justify-center">{placing ? <Spinner className="text-accent" /> : <span className="mx-[3px] inline-block h-2.5 w-2.5 rounded-full border-2 border-line" />}</span>
            <span className={placing ? 'font-medium' : 'text-muted'}>{t('album.stepPlace')}</span>
          </li>
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn" onClick={onCancel} disabled={placing} data-testid="album-cancel-import">{t('common.cancel')}</button>
          {partial && <button className="btn" onClick={onSkip} data-testid="album-import-without">{t('album.importWithout')}</button>}
          {partial && <button className="btn btn-primary" onClick={onRetry} autoFocus data-testid="album-retry-failed">{t('album.retry')}</button>}
        </div>
      </div>
    </div>
  );
}

const extOf = (type: string) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg');

/** Search an album on MusicBrainz and bring its covers, title and tracklist into the project. */
export function AlbumImport({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useEditor((s) => s.project)!;
  const pieceId = useEditor((s) => activePiece(s)?.id ?? null);
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [retry, setRetry] = useState<Retry | null>(null);
  const [error, setError] = useState<{ text: string; again: () => void } | null>(null);
  const [hits, setHits] = useState<ReleaseHit[] | null>(null);
  const [hit, setHit] = useState<ReleaseHit | null>(null);
  const [detail, setDetail] = useState<ReleaseDetail | null>(null);
  const [covers, setCovers] = useState<CoverImage[]>([]);
  const [coversError, setCoversError] = useState<string | null>(null);
  const [dests, setDests] = useState<Record<string, Dest>>({});
  const lastOn = useRef<Record<string, Dest>>({});
  const [titles, setTitles] = useState<{ on: boolean; key: string }>({ on: false, key: '' });
  const [tracks, setTracks] = useState<{ on: boolean; key: string }>({ on: false, key: '' });
  const [rename, setRename] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [placing, setPlacing] = useState(false);
  const [partial, setPartial] = useState(false);
  const decide = useRef<((d: 'retry' | 'skip') => void) | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const choices = useMemo(() => picturePanels(project), [project]);
  const groups = useMemo(() => panelGroups(t, project, choices), [t, project, choices]);
  const choice = (key: string) => choices.find((c) => c.key === key) ?? null;

  /** Runs one online step; a newer step cancels the one still running. */
  const run = async <R,>(p: Phase, fn: (o: NetOptions) => Promise<R>, again: () => void): Promise<R | null> => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase(p);
    setError(null);
    setRetry(null);
    try {
      return await fn({ signal: ctl.signal, onRetry: (info) => setRetry({ info, at: Date.now() + info.waitMs }) });
    } catch (e) {
      if (!ctl.signal.aborted) setError({ text: describeError(t, e), again });
      return null;
    } finally {
      if (abort.current === ctl) { setPhase('idle'); setRetry(null); }
    }
  };

  const search = async () => {
    setDetail(null);
    setHit(null);
    const r = await run('searching', (o) => searchReleases(artist, album, o), () => void search());
    if (r) setHits(r);
  };

  /** Default places for the covers and texts of an edition (see core/albumTargets). */
  const applyPlan = (d: ReleaseDetail, c: CoverImage[]) => {
    const plan = defaultAlbumPlan(project, pieceId, c);
    const next: Record<string, Dest> = {};
    c.forEach((cv, i) => { next[cv.id] = plan.covers[i]?.key ?? 'skip'; });
    setDests(next);
    lastOn.current = {};
    const placed = new Set(Object.values(next));
    // Title and tracklist are usually printed on the covers already: added only where no cover goes.
    setTitles({ on: !!plan.titles && !placed.has(plan.titles.key), key: plan.titles?.key ?? '' });
    setTracks({ on: !!plan.tracklist && d.tracks.length > 0 && !placed.has(plan.tracklist.key), key: plan.tracklist?.key ?? '' });
    setRename(project.name === t('newProject.defaultName'));
  };

  const open = async (h: ReleaseHit) => {
    setHit(h);
    const r = await run('loading', async (o) => {
      const [d, c] = await Promise.all([
        getRelease(h.id, o),
        getCovers(h.id, o).then((list) => ({ list, err: null as string | null }), (e) => {
          if (o.signal?.aborted) throw e;
          return { list: [] as CoverImage[], err: describeError(t, e) };
        }),
      ]);
      return { d, c };
    }, () => void open(h));
    if (!r) return;
    setDetail(r.d);
    setCovers(r.c.list);
    setCoversError(r.c.err);
    applyPlan(r.d, r.c.list);
  };

  const retryCovers = async () => {
    if (!hit || !detail) return;
    const list = await run('covers', (o) => getCovers(hit.id, o), () => void retryCovers());
    if (!list) return;
    setCovers(list);
    setCoversError(null);
    applyPlan(detail, list);
  };

  /** One panel, one cover: choosing a panel another cover has sends that one to the library. */
  const setDest = (id: string, d: Dest) => {
    const next = { ...dests };
    if (d !== 'skip' && d !== 'library') for (const k of Object.keys(next)) if (k !== id && next[k] === d) next[k] = 'library';
    next[id] = d;
    if (d !== 'skip') lastOn.current[id] = d;
    setDests(next);
  };
  const toggle = (id: string) => {
    const cur = dests[id] ?? 'skip';
    if (cur !== 'skip') { lastOn.current[id] = cur; setDest(id, 'skip'); return; }
    const back = lastOn.current[id];
    // Its old panel may have been taken meanwhile: then it goes to the library.
    setDest(id, back && back !== 'library' && !Object.entries(dests).some(([k, v]) => k !== id && v === back) ? back : 'library');
  };

  const chosen = covers.filter((c) => (dests[c.id] ?? 'skip') !== 'skip');
  const anything = chosen.length > 0 || titles.on || (tracks.on && !!detail?.tracks.length) || rename;

  const doImport = async () => {
    if (!detail) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const jobs = chosen.map((c) => ({ cover: c, dest: dests[c.id] }));
    const fresh = (c: CoverImage): Step => ({ id: c.id, label: typeLabel(t, c), state: 'wait', loaded: 0, total: null, retry: null, reduced: false });
    setSteps(jobs.map((j) => fresh(j.cover)));
    setPlacing(false);
    setPartial(false);
    setError(null);
    setPhase('importing');
    const upd = (id: string, patch: Partial<Step>) => setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const got = new Map<string, AssetInfo>();
    const failed = new Map<string, string>();
    try {
      let todo = jobs;
      for (;;) {
        for (const j of todo) {
          const id = j.cover.id;
          upd(id, { ...fresh(j.cover), state: 'run' });
          try {
            const { blob, reduced } = await downloadCover(j.cover, {
              signal: ctl.signal,
              onProgress: (p) => upd(id, { loaded: p.loaded, total: p.total, retry: null }),
              onRetry: (info) => upd(id, { retry: { info, at: Date.now() + info.waitMs } }),
              onFallback: () => upd(id, { reduced: true, loaded: 0, total: null, retry: null }),
            });
            upd(id, { state: 'prep', retry: null, loaded: blob.size });
            const kind = typeLabel(t, j.cover);
            got.set(id, await importImage(blob, `${detail.artist} - ${detail.title} (${kind}).${extOf(blob.type)}`));
            ctl.signal.throwIfAborted();
            failed.delete(id);
            upd(id, { state: 'done', reduced });
          } catch (e) {
            if (ctl.signal.aborted) throw e;
            const why = describeError(t, e);
            failed.set(id, why);
            upd(id, { state: 'fail', retry: null, error: why });
          }
        }
        if (!failed.size) break;
        // Some pictures would not download: ask before going on without them.
        setPartial(true);
        const d = await new Promise<'retry' | 'skip'>((res) => { decide.current = res; });
        decide.current = null;
        setPartial(false);
        if (d === 'skip') break;
        todo = jobs.filter((j) => failed.has(j.cover.id));
      }
      setPlacing(true);
      // Let the "placing" line show before the (synchronous) work.
      await new Promise((r) => setTimeout(r, 30));
      ctl.signal.throwIfAborted();
    } catch {
      // Cancelled: nothing was added to the project.
      if (abort.current === ctl) { setPhase('idle'); setSteps([]); setPartial(false); }
      return;
    }

    const placed = jobs.filter((j) => got.has(j.cover.id)).map((j) => ({
      asset: got.get(j.cover.id)!,
      target: j.dest === 'library' ? null : choice(j.dest),
    }));
    const titleTarget = titles.on ? choice(titles.key) : null;
    const trackTarget = tracks.on ? choice(tracks.key) : null;
    const name = `${detail.artist} - ${detail.title}`;
    const first = placeAlbum(placed, { detail, titles: titleTarget, tracklist: trackTarget, rename: rename ? name : null, discLabel: (n) => t('album.disc', { n }) });
    // Show where the first picture went.
    if (first) {
      const s = editor.store.getState();
      if (s.selection.pieceId !== first.face.pieceId) editor.selectPiece(first.face.pieceId);
      if (editor.store.getState().selection.side !== first.face.side) editor.setSide(first.face.side);
      editor.select([first.layerId]);
    }
    const lines = [
      ...jobs.map((j) => {
        const what = typeLabel(t, j.cover);
        if (!got.has(j.cover.id)) return t('album.doneFailed', { what });
        return j.dest === 'library' ? t('album.doneLibrary', { what }) : t('album.doneLine', { what, where: choiceName(groups, j.dest) });
      }),
      ...(titleTarget ? [t('album.doneLine', { what: t('album.optTitles'), where: choiceName(groups, titleTarget.key) })] : []),
      ...(trackTarget && detail.tracks.length ? [t('album.doneLine', { what: t('album.optTracklist'), where: choiceName(groups, trackTarget.key) })] : []),
    ];
    showToast({ title: t('album.doneTitle'), lines, action: { label: t('album.undo'), run: () => editor.undo() }, ms: 14_000 });
    onClose();
  };

  const cancelImport = () => {
    abort.current?.abort();
    decide.current?.('skip');
    setPhase('idle');
    setSteps([]);
    setPartial(false);
  };

  const importing = phase === 'importing';
  const busy = phase !== 'idle';
  // While importing, closing the dialog would leave a half-done import: only "Cancel" stops it.
  const close = () => { if (!importing) { abort.current?.abort(); onClose(); } };

  return (
    <Modal onClose={close} labelledBy="album-title" wide>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id="album-title" className="flex items-center gap-2 text-lg font-semibold"><Icon name="search" />{t('album.title')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={close} aria-label={t('common.close')} disabled={importing}><Icon name="x" /></button>
        </div>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <label className="min-w-40 flex-1"><span className="label">{t('album.artist')}</span>
            <input className="field mt-1" value={artist} onChange={(e) => setArtist(e.target.value)} autoFocus data-testid="album-artist" /></label>
          <label className="min-w-40 flex-1"><span className="label">{t('album.album')}</span>
            <input className="field mt-1" value={album} onChange={(e) => setAlbum(e.target.value)} data-testid="album-name" /></label>
          <button className="btn btn-primary" type="submit" disabled={busy || (!artist.trim() && !album.trim())} data-testid="album-search">
            {phase === 'searching' ? <Spinner size={14} /> : <Icon name="search" size={14} />}{t('album.search')}
          </button>
          <p className="w-full text-[11px] text-muted">{t('album.privacy')}</p>
        </form>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div className="min-h-[200px] overflow-y-auto border-r border-line p-2" data-testid="album-results">
            {phase === 'searching' && <Busy label={t('album.searching')} retry={retry} />}
            {hits && hits.length === 0 && phase !== 'searching' && <p className="p-3 text-sm text-muted">{t('album.noResults')}</p>}
            {phase !== 'searching' && hits?.map((h) => (
              <button key={h.id} onClick={() => void open(h)} disabled={busy}
                className={`w-full rounded px-3 py-2 text-left disabled:cursor-wait ${hit?.id === h.id ? 'bg-accent-soft' : 'hover:bg-hover'}`}>
                <span className="block truncate text-sm font-medium">{h.title}{h.disambiguation ? <span className="font-normal text-muted"> ({h.disambiguation})</span> : null}</span>
                <span className="block truncate text-xs text-muted">{[h.artist, h.date.slice(0, 4), h.country, h.format, t('album.tracks', { count: h.tracks })].filter(Boolean).join(', ')}</span>
              </button>
            ))}
          </div>
          <div className="min-h-[200px] overflow-y-auto p-4" data-testid="album-detail">
            {phase === 'loading' && <Busy label={t('album.loading')} retry={retry} />}
            {!detail && phase !== 'loading' && !error && <p className="text-sm text-muted">{t(hits?.length ? 'album.pick' : 'album.start')}</p>}
            {detail && phase !== 'loading' && (
              <div className="space-y-4">
                <div>
                  <div className="font-semibold">{detail.title}</div>
                  <div className="text-xs text-muted">{detail.artist}{detail.date ? `, ${detail.date}` : ''}</div>
                </div>
                <section className="space-y-2">
                  <div className="label">{t('album.covers')}</div>
                  {phase === 'covers' && <Busy label={t('album.coversLoading')} retry={retry} />}
                  {coversError && phase !== 'covers' && (
                    <div className="flex items-start gap-2 rounded-md bg-warn-soft p-2 text-xs text-warn" data-testid="album-covers-error">
                      <span className="min-w-0 flex-1 leading-relaxed">{t('album.coversFailed', { reason: coversError })}</span>
                      <button className="btn btn-sm shrink-0" onClick={() => void retryCovers()}>{t('album.retry')}</button>
                    </div>
                  )}
                  {!coversError && covers.length === 0 && phase !== 'covers' && <p className="text-xs text-muted">{t('album.noCovers')}</p>}
                  {covers.length > 0 && (
                    <>
                      <p className="text-[11px] leading-relaxed text-muted">{t('album.coversHint')}</p>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                        {covers.map((c) => (
                          <CoverCard key={c.id} cover={c} dest={dests[c.id] ?? 'skip'} groups={groups} lazy={covers.length > 24}
                            onToggle={() => toggle(c.id)} onDest={(d) => setDest(c.id, d)} />
                        ))}
                      </div>
                    </>
                  )}
                </section>
                <section className="space-y-2">
                  <div className="label">{t('album.texts')}</div>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-sm">
                    <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={titles.on} onChange={() => setTitles({ ...titles, on: !titles.on })} data-testid="album-titles" />{t('album.optTitles')}</label>
                    <PanelSelect value={titles.key} onChange={(key) => setTitles({ on: true, key })} groups={groups} ariaLabel={t('album.textWhere', { what: t('album.optTitles') })} disabled={!titles.on} />
                    {detail.tracks.length > 0 && (
                      <>
                        <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={tracks.on} onChange={() => setTracks({ ...tracks, on: !tracks.on })} data-testid="album-tracklist" />{t('album.optTracklist')}</label>
                        <PanelSelect value={tracks.key} onChange={(key) => setTracks({ on: true, key })} groups={groups} ariaLabel={t('album.textWhere', { what: t('album.optTracklist') })} disabled={!tracks.on} />
                      </>
                    )}
                  </div>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={rename} onChange={() => setRename(!rename)} />
                    <span className="min-w-0 break-words">{t('album.optRename', { name: `${detail.artist} - ${detail.title}` })}</span></label>
                </section>
                {detail.tracks.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer select-none text-muted hover:text-ink">{t('album.tracklistPreview', { count: detail.tracks.length })}</summary>
                    <pre className="mt-1 max-h-40 overflow-y-auto rounded bg-subtle p-2 font-sans whitespace-pre-wrap">{tracklistText(detail, (n) => t('album.disc', { n }))}</pre>
                  </details>
                )}
                <p className="text-[11px] leading-relaxed text-muted">{t('album.where')}</p>
              </div>
            )}
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-danger-soft p-3 text-xs text-danger" role="alert" data-testid="album-error">
                <span className="min-w-0 flex-1 leading-relaxed">{error.text}</span>
                <button className="btn btn-sm shrink-0" onClick={error.again} data-testid="album-error-retry">{t('album.retry')}</button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {detail && <span className="mr-auto text-xs text-muted" data-testid="album-summary">{chosen.length ? t('album.summary', { count: chosen.length }) : t('album.summaryNone')}</span>}
          <button className="btn" onClick={close} disabled={importing}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!detail || busy || !anything} onClick={() => void doImport()} data-testid="album-import">
            <Icon name="download" size={14} />{t('album.import')}
          </button>
        </div>
        {importing && (
          <ImportProgress steps={steps} placing={placing} partial={partial} onCancel={cancelImport}
            onRetry={() => decide.current?.('retry')} onSkip={() => decide.current?.('skip')} />
        )}
      </div>
    </Modal>
  );
}
