import { useEffect, useMemo, useRef, useState } from 'react';
import { preflight, type Issue } from '../../core/preflight';
import { activeLayers, activePiece } from '../../core/store';
import { faceDieline, faceIds, faceLayers, isMultiPage } from '../../core/faces';
import type { Piece } from '../../core/model';
import { getTemplate } from '../../core/templates/catalog';
import type { Side } from '../../core/templates/types';
import { EditorCanvas } from '../../engine/editor/EditorCanvas';
import { attachAutosave, loadProject, type SaveStatus } from '../../engine/persistence';
import { preloadPreviews } from '../../engine/render/preview';
import { Icon, IconButton, Segmented } from '../components';
import { editor, useEditor } from '../editorInstance';
import { navigate, useT } from '../hooks';
import { AppSettings } from '../AppSettings';
import { Toaster } from '../toast';
import { dropAsset, dropFiles, importFiles, selectedPanel } from './actions';
import { EnhanceHost } from './EnhanceDialog';
import { openEnhance } from './enhance';
import { Inspector } from './Inspector';
import { LeftPanel } from './LeftPanel';
import { PiecesStrip } from './PiecesStrip';
import { Preview3D } from './Preview3D';
import { PrintDialog } from './PrintDialog';

/** Outside/inside toggle, or page navigator for multi-page booklets. */
function FaceSwitcher({ piece, side }: { piece: Piece; side: Side }) {
  const t = useT();
  const faces = faceIds(piece);
  if (faces.length < 2) return null;
  if (!isMultiPage(piece)) {
    return (
      <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-lg bg-panel/90 shadow-sm">
        <Segmented<Side> value={side} onChange={(v) => editor.setSide(v)} ariaLabel={t('side.outside')}
          options={faces.map((sd) => ({ value: sd, label: t(`side.${sd}`) }))} />
      </div>
    );
  }
  const i = faces.indexOf(side);
  const go = (k: number) => editor.setSide(faces[Math.max(0, Math.min(faces.length - 1, k))]);
  return (
    <div className="absolute left-1/2 top-3 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-1 rounded-lg bg-panel/95 p-1 shadow-sm" data-testid="page-nav">
      <IconButton icon="back" label={t('editor.prevPage')} onClick={() => go(i - 1)} disabled={i <= 0} />
      <div className="flex flex-wrap justify-center gap-0.5">
        {faces.map((f, k) => (
          <button key={f} onClick={() => go(k)} aria-pressed={f === side} title={t(k === 0 ? 'panel.cover' : k === faces.length - 1 ? 'panel.backCover' : 'panel.pageN', { n: k + 1 })}
            className={`h-6 min-w-6 rounded px-1 text-xs tabular-nums ${f === side ? 'bg-accent text-white' : faceLayers(piece, f).length ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover'} ${k % 2 === 1 ? 'ml-1' : ''}`}>
            {k + 1}
          </button>
        ))}
      </div>
      <IconButton icon="back" label={t('editor.nextPage')} onClick={() => go(i + 1)} disabled={i >= faces.length - 1} className="rotate-180" />
    </div>
  );
}

/** Colour key of the canvas guides (same colours as the editor overlay). */
function GuideLegend({ glue }: { glue: boolean }) {
  const t = useT();
  const item = (label: string, style: React.CSSProperties) => (
    <li className="flex items-center gap-2"><span className="inline-block w-6" style={style} />{label}</li>
  );
  return (
    <ul className="space-y-1 rounded-lg bg-panel/90 px-3 py-2 text-[11px] text-muted shadow-sm" data-testid="guide-legend">
      {item(t('legend.cut'), { borderTop: '2px solid #d92d2d' })}
      {item(t('legend.bleed'), { borderTop: '2px dashed #2f6fd3', background: 'rgba(217,45,45,0.10)', height: 8 })}
      {item(t('legend.safe'), { borderTop: '2px dotted #2f9e5a' })}
      {item(t('legend.fold'), { borderTop: '2px dashed #5b6170' })}
      {glue && item(t('legend.glue'), { height: 8, background: 'repeating-linear-gradient(45deg, rgba(91,97,112,0.45) 0 1px, transparent 1px 4px)' })}
    </ul>
  );
}

function CanvasView({ canvasRef, onZoom, guides }: { canvasRef: React.RefObject<EditorCanvas | null>; onZoom: (z: number) => void; guides: boolean }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const piece = useEditor(activePiece);
  const side = useEditor((s) => s.selection.side);
  const empty = useEditor((s) => activeLayers(s).length === 0);
  const noPieces = useEditor((s) => (s.project?.pieces.length ?? 0) === 0);
  const hasGlue = piece ? faceDieline(piece, side).glue.length > 0 && side === 'outside' : false;
  useEffect(() => {
    if (!host.current) return;
    const c = new EditorCanvas(host.current, editor, {
      onDropAsset: (id, panelId, at) => void dropAsset(id, panelId, at),
      onDropFiles: (files, panelId, at) => void dropFiles(files, panelId, at),
      onViewChange: onZoom,
    });
    canvasRef.current = c;
    return () => { c.destroy(); canvasRef.current = null; };
  }, [canvasRef, onZoom]);
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      {piece && <FaceSwitcher piece={piece} side={side} />}
      <div ref={host} className="min-h-0 flex-1 bg-canvas" data-testid="editor-canvas" />
      {/* Legend left, hints right, in one row so they never overlap (it wraps when narrow). */}
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap-reverse items-end justify-between gap-2" data-testid="canvas-overlays">
        {guides && piece ? <GuideLegend glue={hasGlue} /> : <span />}
        <div className="flex max-w-xs flex-col items-end gap-2">
          {(empty || noPieces) && <div className="rounded-2xl bg-black/75 px-4 py-1.5 text-right text-xs text-white">{t(noPieces ? 'editor.noPieces' : 'editor.emptyCanvas')}</div>}
          {side === 'inside' && <div className="rounded bg-panel/90 px-3 py-1 text-right text-xs text-muted shadow-sm">{t('editor.insideHint')}</div>}
        </div>
      </div>
    </div>
  );
}

function IssuesButton({ issues }: { issues: Issue[] }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const [open, setOpen] = useState(false);
  if (!project) return null;
  const nameOf = (pieceId: string) => {
    const p = project.pieces.find((x) => x.id === pieceId);
    return p ? t(getTemplate(p.templateId).nameKey) : '';
  };
  const lowResAsset = (iss: Issue): string | null => {
    if ((iss.kind !== 'lowDpi' && iss.kind !== 'veryLowDpi') || !iss.layerId) return null;
    const p = project.pieces.find((x) => x.id === iss.pieceId);
    const l = p && faceLayers(p, iss.side).find((x) => x.id === iss.layerId);
    return l && l.type === 'image' ? l.assetId : null;
  };
  return (
    <div className="relative">
      <button className={`btn btn-sm ${issues.length ? 'border-warn/40 bg-warn-soft text-warn' : 'text-ok'}`} onClick={() => setOpen(!open)} data-testid="issues"
        title={issues.length ? undefined : t('preflight.none')} aria-label={issues.length ? undefined : t('preflight.none')}>
        <Icon name={issues.length ? 'alert' : 'check'} size={14} />
        {issues.length ? t('editor.warnings', { count: issues.length }) : <span className="hidden xl:inline">{t('preflight.none')}</span>}
      </button>
      {open && issues.length > 0 && (
        <ul className="absolute right-0 top-full z-40 mt-1 max-h-80 w-80 overflow-y-auto rounded-lg border border-line bg-panel p-1 text-xs shadow-lg">
          {issues.map((iss, i) => {
            const asset = lowResAsset(iss);
            return (
              <li key={i} className="flex items-start gap-1">
                <button className="min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-hover" onClick={() => {
                  editor.selectPiece(iss.pieceId);
                  editor.setSide(iss.side);
                  if (iss.layerId) editor.select([iss.layerId]);
                  setOpen(false);
                }}>
                  <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${iss.severity === 'error' ? 'bg-danger' : 'bg-warn'}`} aria-hidden="true" />
                  <span className="font-medium">{nameOf(iss.pieceId)}</span>: {t(`preflight.${iss.kind}`, iss.values ?? {})}
                </button>
                {/* A picture too small for print: straight to AI enlargement. */}
                {asset && (
                  <button className="btn btn-sm mt-0.5 shrink-0" onClick={() => { setOpen(false); openEnhance(asset); }} title={t('ai.open')} data-testid="issue-enhance">
                    <Icon name="sparkle" size={13} />{t('ai.short')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Properties column: back to the top whenever another layer (or none) is selected. */
function InspectorPane() {
  const ref = useRef<HTMLDivElement>(null);
  const selection = useEditor((s) => `${s.selection.pieceId}|${s.selection.side}|${s.selection.layerIds.join(',')}`);
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [selection]);
  return <div ref={ref} className="min-h-0 flex-1 overflow-y-auto" data-testid="inspector-pane"><Inspector /></div>;
}

export function EditorScreen({ id }: { id: string }) {
  const t = useT();
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [printing, setPrinting] = useState(false);
  const [view3d, setView3d] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [guides, setGuides] = useState(true);
  const canvasRef = useRef<EditorCanvas | null>(null);
  const project = useEditor((s) => s.project);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const issues = useMemo(() => (project ? preflight(project) : []), [project]);

  useEffect(() => {
    let detach: (() => void) | null = null;
    let alive = true;
    void loadProject(id).then(async (p) => {
      if (!alive) return;
      if (!p) { setState('missing'); return; }
      await preloadPreviews(p.pieces);
      if (!alive) return;
      editor.load(p);
      detach = attachAutosave(editor, setStatus);
      setState('ready');
    });
    return () => {
      alive = false;
      detach?.();
      editor.close();
    };
  }, [id]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void importFiles(files).then((assets) => {
        const panel = selectedPanel()?.id ?? null;
        assets.forEach((a) => editor.placeImage(a, panel));
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => { canvasRef.current?.setGuidesVisible(guides); }, [guides]);

  if (state === 'missing') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted">404</p>
        <button className="btn" onClick={() => navigate({ name: 'home' })}>{t('editor.home')}</button>
      </div>
    );
  }
  if (state === 'loading' || !project) return <div className="flex h-full items-center justify-center text-muted">...</div>;

  return (
    <div className="flex h-full flex-col">
      <header className="toolbar flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'home' })} data-testid="back-home"><Icon name="back" />{t('editor.home')}</button>
        <input className="field w-40 min-w-28 border-transparent font-medium hover:border-line xl:w-64" value={project.name} onChange={(e) => editor.rename(e.target.value)} aria-label={t('newProject.name')} />
        <span className={`flex items-center gap-1 whitespace-nowrap text-xs ${status === 'error' ? 'text-danger' : 'text-muted'}`} data-testid="save-status" title={t('common.savedHint')}>
          <Icon name={status === 'error' ? 'alert' : status === 'saving' ? 'database' : 'check'} size={13} />
          {/* The full label only where the bar has room; the icon and tooltip say it anyway. */}
          <span className="hidden xl:inline">{status === 'saving' ? t('common.saving') : status === 'error' ? t('common.saveError') : t('common.saved')}</span>
        </span>
        <div className="mx-1 h-5 w-px bg-line xl:mx-2" />
        <IconButton icon="undo" label={t('editor.undo')} onClick={() => editor.undo()} disabled={!canUndo} />
        <IconButton icon="redo" label={t('editor.redo')} onClick={() => editor.redo()} disabled={!canRedo} />
        <div className="mx-1 h-5 w-px bg-line xl:mx-2" />
        <IconButton icon="minus" label={t('editor.zoomOut')} onClick={() => canvasRef.current?.zoomBy(0.8)} />
        <span className="w-11 shrink-0 text-center text-xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        <IconButton icon="plus" label={t('editor.zoomIn')} onClick={() => canvasRef.current?.zoomBy(1.25)} />
        {/* Narrow windows: short labels (tooltips keep the full ones) so the bar never overflows. */}
        <button className="btn btn-ghost btn-sm" onClick={() => canvasRef.current?.zoomToFit()} title={t('editor.zoomFit')} aria-label={t('editor.zoomFit')}>
          <Icon name="fit" size={14} /><span className="hidden xl:inline">{t('editor.zoomFit')}</span>
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => canvasRef.current?.zoomReal()} title={t('editor.zoomReal')} aria-label={t('editor.zoomReal')}>
          <span className="xl:hidden">1:1</span><span className="hidden xl:inline">{t('editor.zoomReal')}</span>
        </button>
        <IconButton icon="grid" label={t('editor.guides')} active={guides} onClick={() => setGuides(!guides)} />
        <div className="flex-1" />
        <IssuesButton issues={issues} />
        <button className="btn" onClick={() => setView3d(true)} disabled={project.pieces.length === 0} title={t('p3d.open')} data-testid="open-3d"><Icon name="cube" />3D</button>
        <AppSettings compact />
        <button className="btn btn-primary" onClick={() => setPrinting(true)} data-testid="open-print"><Icon name="printer" />{t('editor.print')}</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <CanvasView canvasRef={canvasRef} onZoom={setZoom} guides={guides} />
        <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
          <InspectorPane />
        </aside>
      </div>
      <PiecesStrip />
      {printing && <PrintDialog onClose={() => setPrinting(false)} />}
      {view3d && <Preview3D onClose={() => setView3d(false)} />}
      <EnhanceHost />
      <Toaster />
    </div>
  );
}
