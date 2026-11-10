import { useMemo, useState } from 'react';
import { POCKET_ID } from '../../core/discHolder';
import { estimateSheets, kitPieces, KITS, type KitDef } from '../../core/kits';
import { makeProject } from '../../core/model';
import { getTemplate } from '../../core/templates/catalog';
import { saveProject } from '../../engine/persistence';
import { requestPersistence } from '../../engine/storage';
import { AppSettings } from '../AppSettings';
import { Icon } from '../components';
import { navigate, useT } from '../hooks';
import { ProductArt, TemplateDetails } from '../TemplatePreview';

export function NewProject() {
  const t = useT();
  const [name, setName] = useState(t('newProject.defaultName'));
  const [kit, setKit] = useState<KitDef>(KITS[0]);
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(KITS[0].pieces.map((p) => [p.templateId, p.selected])));
  // Piece shown in the preview panel: the one hovered or last clicked.
  const [focus, setFocus] = useState<string>(KITS[0].pieces[0].templateId);
  const chosen = kit.pieces.filter((p) => picked[p.templateId]);
  // Ticking the pocket puts the disc in it in the covers that can hold one.
  const withPocket = chosen.some((p) => p.templateId === POCKET_ID);
  const ids = chosen.map((p) => p.templateId);
  const idsKey = `${kit.id}:${ids.join('|')}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `chosen` is derived from the key
  const est = useMemo(() => estimateSheets(chosen), [idsKey]);

  const chooseKit = (k: KitDef) => {
    setKit(k);
    setPicked(Object.fromEntries(k.pieces.map((p) => [p.templateId, p.selected])));
    setFocus(k.pieces[0].templateId);
  };

  const create = async () => {
    if (!ids.length) return;
    const project = makeProject(name.trim() || t('newProject.defaultName'), kit.id, kitPieces(chosen));
    await saveProject(project);
    void requestPersistence();
    navigate({ name: 'editor', id: project.id });
  };

  return (
    <div className="min-h-full">
      <header className="toolbar flex items-center justify-between gap-3 border-b border-line bg-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}><Icon name="back" />{t('editor.home')}</button>
          <h1 className="text-lg font-semibold">{t('newProject.title')}</h1>
        </div>
        <AppSettings />
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        <label className="block max-w-md">
          <span className="label">{t('newProject.name')}</span>
          <input className="field mt-1 text-base" value={name} onChange={(e) => setName(e.target.value)} data-testid="project-name" />
        </label>

        <section>
          <h2 className="label mb-2">{t('newProject.package')}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {KITS.map((k) => (
              <button key={k.id} onClick={() => chooseKit(k)} data-testid={`kit-${k.id}`} aria-pressed={k.id === kit.id}
                className={`card flex flex-col items-start gap-1 p-3 text-left transition hover:border-accent ${k.id === kit.id ? 'border-accent bg-accent-soft/40 ring-1 ring-accent' : ''}`}>
                <ProductArt id={`kit:${k.id}`} className="mb-1 h-20 w-full" />
                <span className="text-sm font-medium">{t(k.nameKey)}</span>
                <span className="text-xs text-muted">{t(k.descKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="label mb-2">{t('newProject.pieces')}</h2>
          <div className="grid items-start gap-4 lg:grid-cols-[1fr_420px]">
            <div className="card divide-y divide-line overflow-hidden">
              {kit.pieces.map((p) => {
                const tpl = getTemplate(p.templateId);
                const on = !!picked[p.templateId];
                return (
                  <label key={p.templateId} onMouseEnter={() => setFocus(p.templateId)} onFocus={() => setFocus(p.templateId)}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${focus === p.templateId ? 'bg-hover' : 'hover:bg-hover'}`} data-testid={`piece-${p.templateId}`}>
                    <input type="checkbox" checked={on} onChange={(e) => { setPicked({ ...picked, [p.templateId]: e.target.checked }); setFocus(p.templateId); }} />
                    <ProductArt id={p.templateId} className={`h-12 w-16 shrink-0 ${on ? '' : 'opacity-50 grayscale'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {t(tpl.nameKey)}
                        {withPocket && on && tpl.discHolder && <span className="chip ml-1.5 bg-accent-soft align-middle text-accent" data-testid="with-pocket">{t('holder.withPocket')}</span>}
                      </span>
                      <span className="block text-xs text-muted">{t(tpl.descKey)}</span>
                    </span>
                    <span className="chip shrink-0 bg-subtle text-muted">{t(`paper.${tpl.paper}`)}</span>
                  </label>
                );
              })}
            </div>
            <aside className="card p-4 lg:sticky lg:top-4" aria-live="polite">
              <TemplateDetails templateId={focus} />
            </aside>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-muted">
            {ids.length ? (
              <>
                <span className="mr-4 font-medium text-ink">{t('newProject.estimate', { count: est.sheets })}</span>{' '}
                {t('newProject.estimatePapers', { papers: est.papers.map((p) => t(`paper.${p}`)).join(', ') })}
              </>
            ) : <span className="text-warn">{t('newProject.atLeastOne')}</span>}
          </div>
          <button className="btn btn-primary px-5 py-2" disabled={!ids.length} onClick={create} data-testid="create-project">{t('newProject.create')}</button>
        </div>
      </main>
    </div>
  );
}
