import { useEffect, useMemo, useRef, useState } from 'react';
import { BACKUP_EXT, BackupError, exportProjectFile, importProjectFile } from '../../engine/backup';
import { createDemoProject } from '../../engine/demo';
import { deleteProject, duplicateProject, listProjects, loadProject, renameProject, saveProject, type ProjectSummary } from '../../engine/persistence';
import { downloadBytes, safeFileName } from '../../engine/render/exportClient';
import { renderThumbnail } from '../../engine/render/preview';
import { requestPersistence, storageInfo, type StorageInfo } from '../../engine/storage';
import { currentLang } from '../../i18n';
import { AppLinks, AppSettings } from '../AppSettings';
import { installApp, useCanInstall } from '../install';
import { formatBytes, Icon } from '../components';
import { navigate, useT } from '../hooks';

function Thumb({ blob }: { blob?: Blob }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url ? <img src={url} alt="" className="max-h-full max-w-full object-contain drop-shadow" /> : <Icon name="disc" size={40} className="text-muted/40" />;
}

/** Where projects are kept, how much space they use, and the backup hint. */
function StorageNote({ count }: { count: number }) {
  const t = useT();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  useEffect(() => { void storageInfo().then(setInfo); }, [count]);
  return (
    <section className="mt-10 flex gap-3 rounded-xl border border-line bg-panel/60 p-4 text-xs text-muted" data-testid="storage-note">
      <Icon name="database" size={18} className="mt-0.5 shrink-0 text-accent" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{t('home.storageTitle')}</p>
        <p className="max-w-3xl leading-relaxed">{t('home.storageText')}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {info?.usage != null && <span>{t('home.storageUsed', { size: formatBytes(info.usage) })}</span>}
          {info?.persisted === false && <span className="text-warn">{t('home.storageNotProtected')}</span>}
        </p>
      </div>
    </section>
  );
}

export function Home() {
  const t = useT();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canInstall = useCanInstall();
  const refresh = () => listProjects().then(setProjects);
  useEffect(() => { void refresh(); }, []);
  // Projects created outside the editor have no thumbnail yet: draw them once.
  useEffect(() => {
    const missing = projects?.filter((p) => !p.thumb && p.pieces > 0) ?? [];
    if (!missing.length) return;
    let alive = true;
    void (async () => {
      for (const p of missing) {
        const project = await loadProject(p.id);
        const thumb = project ? await renderThumbnail(project) : null;
        if (project && thumb) await saveProject(project, thumb);
      }
      if (alive) void refresh();
    })();
    return () => { alive = false; };
  }, [projects]);

  const importBackup = async (file: File) => {
    setImportError(null);
    try {
      const id = await importProjectFile(file);
      void requestPersistence();
      navigate({ name: 'editor', id });
    } catch (e) {
      setImportError(t(e instanceof BackupError && e.message === 'newer' ? 'home.importNewer' : 'home.importInvalid', { name: file.name }));
    }
  };

  const exportBackup = async (id: string) => {
    const r = await exportProjectFile(id);
    if (r) downloadBytes(r.bytes, `${safeFileName(r.name)}${BACKUP_EXT}`, 'application/zip');
  };

  const demo = async () => {
    setBusy(true);
    void requestPersistence();
    try {
      const p = await createDemoProject(t('home.demoName'), {
        title: t('editor.sampleTitle'),
        artist: t('editor.sampleSubtitle'),
        tracks: t('home.demoTracks'),
        spine: t('editor.sampleSpine'),
        background: t('editor.background'),
        rect: t('editor.rect'),
      });
      navigate({ name: 'editor', id: p.id });
    } finally {
      setBusy(false);
    }
  };

  // Short dates: the year only when it is not the current one.
  const thisYear = new Date().getFullYear();
  const shortFmt = new Intl.DateTimeFormat(currentLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const longFmt = new Intl.DateTimeFormat(currentLang(), { day: 'numeric', month: 'short', year: 'numeric' });
  const dateFmt = { format: (ts: number) => (new Date(ts).getFullYear() === thisYear ? shortFmt : longFmt).format(ts) };

  return (
    <div className="min-h-full">
      <header className="toolbar flex items-center justify-between border-b border-line bg-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
          <div>
            <div className="font-semibold leading-tight">{t('app.name')}</div>
            <div className="text-xs text-muted">{t('app.tagline')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canInstall && <button className="btn btn-sm" onClick={() => void installApp()} title={t('home.installHint')} data-testid="install-app"><Icon name="download" size={14} />{t('home.install')}</button>}
          <AppSettings />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
            <p className="mt-1 text-sm text-muted" data-testid="slogan">{t('home.slogan')}</p>
          </div>
          <div className="toolbar flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept={`${BACKUP_EXT},.zip`} className="hidden" data-testid="import-input"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f); }} />
            <button className="btn" onClick={() => fileInput.current?.click()} title={t('home.importHint')} data-testid="import-project"><Icon name="upload" />{t('home.import')}</button>
            <button className="btn" onClick={demo} disabled={busy} data-testid="demo-project"><Icon name="sparkle" />{t('home.demo')}</button>
            <button className="btn btn-primary" onClick={() => navigate({ name: 'new' })} data-testid="new-project"><Icon name="plus" />{t('home.new')}</button>
          </div>
        </div>
        {importError && <p className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger" role="alert">{importError}</p>}
        <ol className="mb-8 grid gap-3 md:grid-cols-3" data-testid="how-it-works">
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n} className="flex items-start gap-3 rounded-xl bg-panel/70 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{n}</span>
              <span>
                <span className="block text-sm font-medium">{t(`home.how${n}`)}</span>
                <span className="block text-xs text-muted">{t(`home.how${n}d`)}</span>
              </span>
            </li>
          ))}
        </ol>
        {projects && projects.length === 0 && (
          <button onClick={() => navigate({ name: 'new' })} className="card flex w-full flex-col items-center gap-3 border-dashed p-12 text-center text-muted hover:border-accent hover:text-accent">
            <Icon name="disc" size={44} />
            <span className="max-w-md">{t('home.empty')}</span>
          </button>
        )}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {projects?.map((p) => (
            <li key={p.id} className="card group overflow-hidden">
              <button className="flex h-40 w-full items-center justify-center bg-canvas p-4" onClick={() => navigate({ name: 'editor', id: p.id })} aria-label={p.name}>
                <Thumb blob={p.thumb} />
              </button>
              <div className="px-3 pb-2 pt-2">
                <div className="truncate text-sm font-medium" title={p.name}>{p.name}</div>
                <div className="flex items-center justify-between gap-1">
                  <div className="truncate text-xs text-muted">{dateFmt.format(p.updatedAt)}</div>
                  <div className="-mr-1.5 flex shrink-0 opacity-70 group-hover:opacity-100">
                    <button className="btn btn-ghost h-7 w-7 p-0" title={t('common.rename')} aria-label={t('common.rename')} onClick={async () => {
                      const name = prompt(t('common.rename'), p.name);
                      if (name?.trim()) { await renameProject(p.id, name.trim()); void refresh(); }
                    }}><Icon name="edit" size={15} /></button>
                    <button className="btn btn-ghost h-7 w-7 p-0" title={t('home.exportBackup')} aria-label={t('home.exportBackup')} onClick={() => void exportBackup(p.id)} data-testid="export-backup"><Icon name="download" size={15} /></button>
                    <button className="btn btn-ghost h-7 w-7 p-0" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={async () => { await duplicateProject(p.id, t('home.copySuffix')); void refresh(); }}><Icon name="copy" size={15} /></button>
                    <button className="btn btn-ghost h-7 w-7 p-0 hover:text-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={async () => {
                      if (confirm(t('home.confirmDelete', { name: p.name }))) { await deleteProject(p.id); void refresh(); }
                    }}><Icon name="trash" size={15} /></button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {projects && <StorageNote count={projects.length} />}
        <AppLinks className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-1" />
      </main>
    </div>
  );
}
