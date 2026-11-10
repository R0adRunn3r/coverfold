import { useEffect, useMemo, useRef, useState } from 'react';
import { assetDpi, assetUseCount, defaultMultiplier, ENHANCE_BELOW_DPI, enhancedName, MAX_AI_DPI, multiplierOptions, type Multiplier } from '../../core/upscalePlan';
import { getAssetInfos, importImage, type AssetInfo } from '../../engine/assets';
import { db } from '../../engine/db';
import { AiError, type AiErrorCode } from '../../engine/ai/errors';
import { MODELS, modelBytes, type ModelId, type UpscaleModel } from '../../engine/ai/models';
import { deleteModels, downloadedModels } from '../../engine/ai/modelStore';
import { probeAi, releaseAi, startUpscale, type Job, type Probe, type Stage, type TileDone } from '../../engine/ai/upscaler';
import { formatBytes, Icon, Modal, ProgressBar, Spinner } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';
import { showToast } from '../toast';
import { CompareView, type After } from './CompareView';
import { closeEnhance, useEnhanceTarget } from './enhance';

/** At most this many results are kept to compare (each is a full PNG in memory). */
const MAX_ATTEMPTS = 4;

interface Attempt { key: string; model: ModelId; m: Multiplier; url: string; blob: Blob; width: number; height: number; ms: number; backend: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; stage: Stage | null; tilesSince: number | null; eta: number | null; model: ModelId; m: Multiplier }
  | { kind: 'error'; code: AiErrorCode; detail: string; model: ModelId };

const fmtTime = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

/** Mounted once in the editor: shows the dialog for the picture it was opened for. */
export function EnhanceHost() {
  const target = useEnhanceTarget();
  return target ? <EnhanceDialog key={target} assetId={target} /> : null;
}

function EnhanceDialog({ assetId }: { assetId: string }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const [asset, setAsset] = useState<AssetInfo | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [model, setModel] = useState<ModelId>('standard');
  // The user's enlargement; until they pick one, the suggested one.
  const [picked, setM] = useState<Multiplier | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [live, setLive] = useState<HTMLCanvasElement | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [credits, setCredits] = useState(false);
  const job = useRef<Job | null>(null);
  const attemptsRef = useRef<Attempt[]>([]);
  useEffect(() => { attemptsRef.current = attempts; }, [attempts]);

  useEffect(() => {
    let url: string | null = null;
    void getAssetInfos([assetId]).then(([a]) => setAsset(a ?? null));
    void db.assets.get(assetId).then((row) => { if (row) { url = URL.createObjectURL(row.blob); setBefore(url); } });
    void probeAi().then((p) => {
      setProbe(p);
      if (!p.webgpu) setModel('lite');
    });
    void downloadedModels().then(setDownloaded);
    return () => {
      if (url) URL.revokeObjectURL(url);
      job.current?.cancel();
      for (const a of attemptsRef.current) URL.revokeObjectURL(a.url);
      releaseAi();
    };
  }, [assetId]);

  const dpi = useMemo(() => (project ? assetDpi(project, assetId) : null), [project, assetId]);
  const uses = useMemo(() => (project ? assetUseCount(project, assetId) : 0), [project, assetId]);
  const options = useMemo(() => (asset ? multiplierOptions(asset, dpi) : []), [asset, dpi]);
  const m = picked ?? defaultMultiplier(options);
  const option = options.find((o) => o.m === m) ?? null;
  const running = phase.kind === 'running';
  const current = attempts.find((a) => a.key === shown) ?? null;
  const gpu = probe?.webgpu ?? true;
  const usable = (x: UpscaleModel) => gpu || x.id === 'lite';

  const requestClose = () => {
    if (running || (attempts.length > 0 && !saving)) setConfirmClose(true);
    else closeEnhance();
  };

  const start = () => {
    if (!asset || !m || running) return;
    setStopped(false);
    setConfirmClose(false);
    // The result fills in tile by tile over a dimmed copy of the original.
    const canvas = document.createElement('canvas');
    canvas.width = asset.width * m;
    canvas.height = asset.height * m;
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    const ctx = canvas.getContext('2d')!;
    if (before) {
      const img = new Image();
      img.onload = () => {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };
      img.src = before;
    }
    setLive(canvas);
    // Stopped or failed: back to the result that was on screen.
    const previous = shown;
    setShown(null);
    setPhase({ kind: 'running', stage: null, tilesSince: null, eta: null, model, m });
    const onStage = (s: Stage) => {
      const now = performance.now();
      setPhase((p) => {
        if (p.kind !== 'running') return p;
        const since = s.stage === 'tiles' && p.tilesSince === null ? now : p.tilesSince;
        // Time left: the average tile so far times the tiles still to do.
        const eta = s.stage === 'tiles' && s.done > 0 && since !== null ? ((now - since) / s.done) * (s.total - s.done) : null;
        return { ...p, stage: s, tilesSince: since, eta };
      });
    };
    const onTile = (tile: TileDone) => ctx.putImageData(new ImageData(tile.pixels as Uint8ClampedArray<ArrayBuffer>, tile.w, tile.h), tile.x, tile.y);
    const j = startUpscale({ assetId, model, scale: m, cpu: !gpu }, onStage, onTile);
    job.current = j;
    j.result.then((res) => {
      const a: Attempt = { key: `${model}-${m}-${Date.now()}`, model, m, url: URL.createObjectURL(res.blob), blob: res.blob, width: res.width, height: res.height, ms: res.ms, backend: res.prepared.backend };
      setAttempts((list) => {
        const next = [...list, a];
        while (next.length > MAX_ATTEMPTS) URL.revokeObjectURL(next.shift()!.url);
        return next;
      });
      setShown(a.key);
      setPhase({ kind: 'idle' });
    }).catch((e: unknown) => {
      const err = e instanceof AiError ? e : new AiError('internal', String(e));
      setShown(previous);
      if (err.code === 'aborted') { setStopped(true); setPhase({ kind: 'idle' }); }
      else setPhase({ kind: 'error', code: err.code, detail: err.message === err.code ? '' : err.message, model });
    }).finally(() => {
      job.current = null;
      setLive(null);
      void downloadedModels().then(setDownloaded);
    });
  };

  const stop = () => job.current?.cancel();

  const apply = async (replace: boolean) => {
    if (!current || !asset) return;
    setSaving(true);
    try {
      const name = enhancedName(asset.name, t(MODELS.find((x) => x.id === current.model)!.nameKey), current.m);
      const info = await importImage(current.blob, name);
      if (replace) {
        editor.replaceAsset(assetId, info);
        showToast({ title: t('ai.replacedToast'), lines: [name], action: { label: t('ai.undo'), run: () => editor.undo() } });
      } else {
        editor.addAssets([info.id]);
        showToast({ title: t('ai.addedToast'), lines: [name] });
      }
      closeEnhance();
    } catch (e) {
      setSaving(false);
      setPhase({ kind: 'error', code: 'storage', detail: e instanceof Error ? e.message : String(e), model: current.model });
    }
  };

  const after: After = live ? { kind: 'canvas', canvas: live } : current ? { kind: 'image', url: current.url } : null;
  const view = live && phase.kind === 'running'
    ? { w: (asset?.width ?? 1) * phase.m, h: (asset?.height ?? 1) * phase.m }
    : current ? { w: current.width, h: current.height } : { w: (asset?.width ?? 1) * (m ?? 4), h: (asset?.height ?? 1) * (m ?? 4) };

  return (
    <Modal onClose={requestClose} labelledBy="ai-title" wide>
      <div className="flex h-[min(860px,calc(100vh-2rem))] min-h-0 flex-col" data-testid="enhance-dialog">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <Icon name="sparkle" className="mt-0.5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 id="ai-title" className="font-semibold">{t('ai.title')}</h2>
            {asset && (
              <p className="truncate text-xs text-muted" data-testid="ai-source">
                {asset.name}, {asset.width} × {asset.height} px, {dpi === null ? t('ai.unused') : t('ai.dpiNow', { dpi: Math.round(dpi), count: uses })}
              </p>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={requestClose} aria-label={t('common.close')} data-testid="ai-close"><Icon name="x" /></button>
        </header>

        {confirmClose && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warn/40 bg-warn-soft px-4 py-2 text-sm text-warn" role="alert" data-testid="ai-confirm-close">
            <span className="min-w-0 flex-1">{t(running ? 'ai.confirmStop' : 'ai.confirmDiscard')}</span>
            <button className="btn btn-sm" onClick={() => setConfirmClose(false)}>{t(running ? 'ai.keepGoing' : 'ai.keepOpen')}</button>
            <button className="btn btn-sm border-transparent bg-danger text-white hover:opacity-90" onClick={() => { job.current?.cancel(); closeEnhance(); }} data-testid="ai-confirm-close-yes">{t(running ? 'ai.stopAndClose' : 'ai.discardAndClose')}</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="min-h-[240px] flex-1 p-3 md:min-h-0">
            <CompareView before={before} after={after} width={view.w} height={view.h}
              overlay={!after && !running ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
                  <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-white">{t('ai.viewerHint')}</span>
                </div>
              ) : null} />
          </div>

          <aside className="flex max-h-[60%] w-full shrink-0 flex-col border-t border-line md:max-h-none md:w-80 md:border-l md:border-t-0 lg:w-96">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              {probe && !probe.webgpu && (
                <p className="rounded-md bg-warn-soft p-2 text-[11px] leading-relaxed text-warn" data-testid="ai-no-gpu">{t('ai.noGpu')}</p>
              )}

              <section className="space-y-1.5">
                <div className="label">{t('ai.modelLabel')}</div>
                <div role="radiogroup" aria-label={t('ai.modelLabel')} className="space-y-1.5">
                  {MODELS.map((x) => {
                    const ok = usable(x);
                    const have = downloaded.has(x.id);
                    const active = model === x.id;
                    return (
                      <div key={x.id} className={`rounded-lg border p-2 ${active ? 'border-accent bg-accent-soft' : 'border-line'} ${ok ? '' : 'opacity-60'}`}>
                        <button role="radio" aria-checked={active} disabled={!ok || running} onClick={() => setModel(x.id)}
                          className="w-full text-left disabled:cursor-not-allowed" data-testid={`ai-model-${x.id}`}>
                          <span className="flex items-center gap-1.5">
                            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${active ? 'border-accent' : 'border-line'}`}>
                              {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                            </span>
                            <span className="text-sm font-medium">{t(x.nameKey)}</span>
                            {x.nonCommercial && <span className="chip bg-warn-soft text-[10px] text-warn">{t('ai.nonCommercial')}</span>}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t(x.descKey)}</span>
                          {!ok && <span className="mt-0.5 block text-[11px] text-warn">{t('ai.needsGpu')}</span>}
                        </button>
                        <div className="mt-1 flex items-center gap-1 pl-5 text-[10px] text-muted">
                          {have
                            ? <><Icon name="check" size={11} className="text-ok" />{t('ai.downloaded', { size: formatBytes(modelBytes(x)) })}
                              <button className="ml-auto rounded px-1 hover:text-danger disabled:opacity-40" disabled={running}
                                onClick={() => void deleteModels([x.id]).then(() => downloadedModels().then(setDownloaded))}
                                title={t('ai.deleteModelHint')} data-testid={`ai-delete-${x.id}`}>{t('ai.deleteModel')}</button></>
                            : <><Icon name="download" size={11} />{t('ai.toDownload', { size: formatBytes(modelBytes(x)) })}</>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-1.5">
                <div className="label">{t('ai.multiplier')}</div>
                <div role="radiogroup" aria-label={t('ai.multiplier')} className="grid grid-cols-3 gap-1">
                  {options.map((o) => (
                    <button key={o.m} role="radio" aria-checked={m === o.m} disabled={!o.ok || running} onClick={() => setM(o.m)}
                      title={o.ok ? undefined : t(o.reason === 'dpiCap' ? 'ai.capDpi' : 'ai.capPixels', { max: MAX_AI_DPI })}
                      className={`btn btn-sm justify-center ${m === o.m ? 'border-accent bg-accent-soft text-accent' : ''}`} data-testid={`ai-mult-${o.m}`}>
                      {o.m}×
                    </button>
                  ))}
                </div>
                {option && (
                  <p className="text-[11px] leading-relaxed text-muted" data-testid="ai-result-size">
                    {t('ai.resultSize', { w: option.w, h: option.h })}
                    {option.dpi !== null && <>, <span className={option.dpi >= ENHANCE_BELOW_DPI ? 'text-ok' : 'text-warn'}>{t('ai.resultDpi', { dpi: Math.round(option.dpi) })}</span></>}
                  </p>
                )}
                {options.length > 0 && options.every((o) => !o.ok) && (
                  <p className="rounded-md bg-subtle p-2 text-[11px] leading-relaxed" data-testid="ai-not-needed">
                    {options[0].reason === 'dpiCap' ? t('ai.notNeeded', { dpi: Math.round(dpi ?? 0), max: MAX_AI_DPI }) : t('ai.tooBig')}
                  </p>
                )}
                {options.some((o) => !o.ok) && options.some((o) => o.ok) && (
                  <p className="text-[11px] leading-relaxed text-muted">{t('ai.capNote', { max: MAX_AI_DPI })}</p>
                )}
              </section>

              {attempts.length > 0 && (
                <section className="space-y-1.5">
                  <div className="label">{t('ai.attempts')}</div>
                  <div className="flex flex-wrap gap-1" data-testid="ai-attempts">
                    {attempts.map((a) => (
                      <button key={a.key} onClick={() => !running && setShown(a.key)} disabled={running}
                        className={`chip border ${a.key === shown ? 'border-accent bg-accent-soft text-accent' : 'border-line'}`}
                        title={t('ai.attemptHint', { w: a.width, h: a.height, time: fmtTime(a.ms) })}>
                        {t(MODELS.find((x) => x.id === a.model)!.nameKey)} {a.m}×
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted">{t('ai.attemptsHint')}</p>
                </section>
              )}

              <section className="space-y-1 text-[11px] leading-relaxed text-muted">
                <p>{t('ai.privacy')}</p>
                <button className="underline hover:text-ink" onClick={() => setCredits(!credits)} aria-expanded={credits} data-testid="ai-credits-toggle">{t('ai.credits')}</button>
                {credits && (
                  <ul className="space-y-1" data-testid="ai-credits">
                    {MODELS.map((x) => (
                      <li key={x.id}><span className="font-medium text-ink">{t(x.nameKey)}</span>: <a className="underline" href={x.creditUrl} target="_blank" rel="noreferrer">{x.credit}</a>, {x.license}</li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Always in view: start / progress with Stop, then what to do with the result. */}
            <footer className="shrink-0 space-y-2 border-t border-line p-3">
              {phase.kind === 'running' ? (
                <RunStatus phase={phase} onStop={stop} />
              ) : (
                <button className={`btn w-full justify-center ${attempts.length ? '' : 'btn-primary'}`} onClick={start}
                  disabled={!asset || !m || !option?.ok || !usable(MODELS.find((x) => x.id === model)!)} data-testid="ai-start">
                  <Icon name="play" size={14} />{t(attempts.length ? 'ai.startAgain' : 'ai.start')}
                </button>
              )}
              {stopped && phase.kind === 'idle' && <p className="text-[11px] text-muted" data-testid="ai-stopped">{t('ai.stopped')}</p>}
              {phase.kind === 'error' && (
                <ErrorBox code={phase.code} detail={phase.detail} gpu={gpu} onRetry={start} onLite={() => { setModel('lite'); setPhase({ kind: 'idle' }); }} />
              )}
              <div className="space-y-1.5 border-t border-line pt-2">
                {current
                  ? <p className="text-[11px] font-medium leading-relaxed" data-testid="ai-chosen">{t('ai.chosen', { name: t(MODELS.find((x) => x.id === current.model)!.nameKey), m: current.m, w: current.width, h: current.height })}</p>
                  : <p className="text-[11px] leading-relaxed text-muted">{t(running ? 'ai.whenDone' : attempts.length ? 'ai.pickAttempt' : 'ai.chooseFirst')}</p>}
                <div className="grid grid-cols-2 gap-1.5">
                  <button className="btn btn-primary justify-center" disabled={!current || running || saving} onClick={() => void apply(true)} data-testid="ai-replace"
                    title={t(uses ? 'ai.replaceHint' : 'ai.replaceHintUnused')}>
                    {saving ? <Spinner size={14} /> : <Icon name="check" size={14} />}{t('ai.replace')}
                  </button>
                  <button className="btn justify-center" disabled={!current || running || saving} onClick={() => void apply(false)} data-testid="ai-add"
                    title={t('ai.addHint')}>
                    <Icon name="plus" size={14} />{t('ai.add')}
                  </button>
                </div>
                {current && <p className="text-[11px] leading-relaxed text-muted">{t(uses ? 'ai.applyHint' : 'ai.applyHintUnused')}</p>}
              </div>
            </footer>
          </aside>
        </div>
      </div>
    </Modal>
  );
}

function RunStatus({ phase, onStop }: { phase: Extract<Phase, { kind: 'running' }>; onStop: () => void }) {
  const t = useT();
  const s = phase.stage;
  let label = t('ai.stageStart');
  let value: number | null = null;
  let detail = '';
  if (s?.stage === 'download') {
    label = t('ai.stageDownload');
    value = s.total ? s.loaded / s.total : null;
    detail = `${formatBytes(s.loaded)} / ${formatBytes(s.total)}`;
  } else if (s?.stage === 'prepare') {
    label = t('ai.stagePrepare');
  } else if (s?.stage === 'tiles') {
    label = t('ai.stageTiles', { done: s.done, total: s.total });
    value = s.total ? s.done / s.total : null;
    if (s.done > 0 && phase.eta !== null && s.done < s.total) detail = t('ai.eta', { time: fmtTime(phase.eta) });
    else if (s.done === 0) detail = t('ai.firstTile');
    else detail = t('ai.finishing');
  }
  return (
    <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft p-2.5" role="status" aria-live="polite" data-testid="ai-progress">
      <div className="flex items-center gap-2 text-sm"><Spinner size={14} className="text-accent" /><span className="min-w-0 flex-1">{label}</span></div>
      <ProgressBar value={value} label={label} />
      {detail && <p className="text-[11px] tabular-nums text-muted">{detail}</p>}
      {s?.stage === 'prepare' && <p className="text-[11px] leading-relaxed text-muted">{t('ai.prepareHint')}</p>}
      <button className="btn btn-sm w-full justify-center" onClick={onStop} data-testid="ai-stop"><Icon name="x" size={14} />{t('ai.stop')}</button>
    </div>
  );
}

function ErrorBox({ code, detail, gpu, onRetry, onLite }: { code: AiErrorCode; detail: string; gpu: boolean; onRetry: () => void; onLite: () => void }) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-soft p-2.5 text-[12px] leading-relaxed text-danger" role="alert" data-testid="ai-error">
      <div className="flex gap-2"><Icon name="alert" size={14} className="mt-0.5 shrink-0" /><span>{t(`ai.error.${code}`)}</span></div>
      {detail && code === 'internal' && <p className="break-words font-mono text-[10px] opacity-80">{detail.slice(0, 300)}</p>}
      <div className="flex flex-wrap gap-1">
        <button className="btn btn-sm" onClick={onRetry} data-testid="ai-retry"><Icon name="rotate" size={13} />{t('ai.retry')}</button>
        {(code === 'gpu' || code === 'memory') && gpu && <button className="btn btn-sm" onClick={onLite}>{t('ai.useLite')}</button>}
      </div>
    </div>
  );
}
