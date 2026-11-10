import { useEffect, useRef, useState } from 'react';
import { buildDieline, getTemplate } from '../../core/templates/catalog';
import { holderOf, holderPanel, pocketFor, pocketSize, projectPocket } from '../../core/discHolder';
import { trayFor } from '../../core/tray';
import { downloadTraySTL, useTrayFit } from './TrayPanel';
import type { FoldViewer } from '../../engine/render/fold3d';
import { Icon, Modal } from '../components';
import { useEditor } from '../editorInstance';
import { useT } from '../hooks';

/** The selected piece in 3D, with its artwork, folded from flat to assembled. */
export function Preview3D({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useEditor((s) => s.project)!;
  const selected = useEditor((s) => s.selection.pieceId);
  const [pieceId, setPieceId] = useState(selected ?? project.pieces[0]?.id ?? null);
  const [fold, setFold] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<FoldViewer | null>(null);
  const piece = project.pieces.find((p) => p.id === pieceId) ?? null;
  const folds = piece ? buildDieline(piece.templateId, piece.params).folds.length > 0 : false;
  const fit = useTrayFit();
  const [showTray, setShowTray] = useState(true);
  const holder = piece ? holderOf(piece) : null;
  const tray = piece ? trayFor(piece, fit) : null;
  const disc = project.pieces.find((p) => p.templateId === 'disc.label') ?? null;
  // Pocket: the project's pocket piece, else plain paper sized for the panel (none if there is no room).
  const pocketPiece = projectPocket(project);
  const panel = piece && holder === 'pocket' ? holderPanel(piece) : null;
  const pocketBox = panel && (pocketPiece ? pocketSize(pocketPiece) : pocketFor(panel));
  const pocket = panel && pocketBox ? { panelId: panel.id, ...pocketBox, piece: pocketPiece } : null;
  const extras = () => ({ tray: showTray ? tray : null, pocket: showTray ? pocket : null, disc });

  useEffect(() => {
    let alive = true;
    void import('../../engine/render/fold3d').then(({ FoldViewer }) => {
      if (!alive || !host.current) return;
      try {
        viewer.current = new FoldViewer(host.current);
        // Development aid: inspect the 3D view from the console.
        if (import.meta.env.DEV) (window as unknown as { __viewer: unknown }).__viewer = viewer.current;
        if (piece) void viewer.current.setPiece(piece, extras());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => { alive = false; viewer.current?.dispose(); viewer.current = null; };
    // The viewer is created once; piece changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (piece && viewer.current) void viewer.current.setPiece(piece, extras());
    // tray and pocket are derived from the piece, the fit and the pocket piece
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, showTray, fit, disc, pocketPiece]);
  useEffect(() => { viewer.current?.setFold(fold); }, [fold]);

  // Fold animation: flat to assembled and back, in a loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = ((now - t0) / 3000) % 2;
      setFold(k < 1 ? k : 2 - k);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <Modal onClose={onClose} labelledBy="p3d-title" wide>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="p3d-title" className="flex items-center gap-2 text-lg font-semibold"><Icon name="cube" />{t('p3d.title')}</h2>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" /></button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line px-5 py-2" role="tablist">
        {project.pieces.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === pieceId} onClick={() => setPieceId(p.id)}
            className={`btn btn-sm ${p.id === pieceId ? 'border-accent bg-accent-soft text-accent' : ''}`}>
            {t(getTemplate(p.templateId).nameKey)}
          </button>
        ))}
      </div>
      <div className="relative h-[min(64vh,620px)] bg-gradient-to-b from-canvas to-subtle" data-testid="p3d-view">
        <div ref={host} className="absolute inset-0" />
        {error && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-danger">{t('p3d.error', { message: error })}</p>}
        <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-muted">{t('p3d.hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 text-sm">
        {folds && <>
        <span className="text-xs text-muted">{t('p3d.flat')}</span>
        <input type="range" className="min-w-40 flex-1" min={0} max={1} step={0.01} value={fold} aria-label={t('p3d.fold')}
          onChange={(e) => { setPlaying(false); setFold(parseFloat(e.target.value)); }} data-testid="p3d-fold" />
        <span className="text-xs text-muted">{t('p3d.assembled')}</span>
        <button className="btn btn-sm" onClick={() => setPlaying(!playing)} aria-pressed={playing}><Icon name={playing ? 'x' : 'play'} size={14} />{t(playing ? 'p3d.stop' : 'p3d.play')}</button>
        </>}
        {!folds && <span className="flex-1" />}
        {(tray || pocket) && (
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={showTray} onChange={(e) => setShowTray(e.target.checked)} data-testid="p3d-tray" />{t(pocket ? 'p3d.pocket' : 'p3d.tray')}</label>
        )}
        {tray && <button className="btn btn-sm" onClick={() => piece && void downloadTraySTL(piece, fit, `${project.name} - ${t('tray.fileName')}`)}><Icon name="download" size={14} />STL</button>}
        <button className="btn btn-sm" onClick={() => viewer.current?.frame(true)} data-testid="p3d-inside">{t('p3d.inside')}</button>
        <button className="btn btn-sm" onClick={() => viewer.current?.frame()}><Icon name="fit" size={14} />{t('p3d.reset')}</button>
      </div>
    </Modal>
  );
}
