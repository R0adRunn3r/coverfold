import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components';
import { useT } from '../hooks';

export type After =
  | { kind: 'image'; url: string }
  | { kind: 'canvas'; canvas: HTMLCanvasElement }
  | null;

/**
 * Before/after viewer: original left of the divider, result right. Drag the
 * divider to compare, drag elsewhere to pan; "100%" is one result pixel per screen pixel.
 */
export function CompareView({ before, after, width, height, overlay }: {
  before: string | null;
  after: After;
  /** Size of the result in pixels (the original is stretched to it). */
  width: number;
  height: number;
  overlay?: ReactNode;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [pos, setPos] = useState(0.5);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ mode: 'pan' | 'divider'; sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const fitted = useRef(false);

  const fitZoom = useCallback(() => (boxSize.w && boxSize.h ? Math.min(boxSize.w / width, boxSize.h / height) * 0.96 : 1), [boxSize, width, height]);

  const zoomTo = useCallback((zoom: number, cx?: number, cy?: number) => {
    setView((v) => {
      const z = Math.max(fitZoom() * 0.5, Math.min(16, zoom));
      const px = cx ?? boxSize.w / 2, py = cy ?? boxSize.h / 2;
      // Keep the point under (px, py) where it is.
      return { zoom: z, x: px - ((px - v.x) * z) / v.zoom, y: py - ((py - v.y) * z) / v.zoom };
    });
  }, [boxSize, fitZoom]);

  const fit = useCallback(() => {
    const z = fitZoom();
    setView({ zoom: z, x: (boxSize.w - width * z) / 2, y: (boxSize.h - height * z) / 2 });
  }, [boxSize, fitZoom, width, height]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBoxSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit when first measured; when the result size changes, keep the same part of the picture in view.
  const lastSize = useRef({ width, height });
  useEffect(() => {
    if (!boxSize.w) return;
    if (!fitted.current) { fitted.current = true; fit(); lastSize.current = { width, height }; return; }
    const k = width / lastSize.current.width;
    lastSize.current = { width, height };
    if (k !== 1) setView((v) => ({ zoom: v.zoom / k, x: v.x, y: v.y }));
  }, [boxSize, width, height, fit]);

  // The live canvas (tiles filling in) is a DOM node owned by the dialog.
  useEffect(() => {
    const host = canvasHost.current;
    if (!host || after?.kind !== 'canvas') return;
    const c = after.canvas;
    host.appendChild(c);
    return () => { if (c.parentNode === host) host.removeChild(c); };
  }, [after]);

  const onWheel = (e: React.WheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    zoomTo(view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const r = box.current!.getBoundingClientRect();
    const nearDivider = after && Math.abs(e.clientX - r.left - pos * r.width) < 14;
    drag.current = { mode: nearDivider ? 'divider' : 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    setPanning(!nearDivider);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = box.current!.getBoundingClientRect();
    if (d.mode === 'divider') setPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    else setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  };
  const onPointerUp = () => { drag.current = null; setPanning(false); };

  const place = { left: view.x, top: view.y, width: width * view.zoom, height: height * view.zoom };
  const shown = after ? `inset(0 0 0 ${pos * 100}%)` : undefined;
  const real = Math.abs(view.zoom - 1) < 0.01;

  return (
    <div className="relative h-full min-h-0 w-full select-none overflow-hidden rounded-lg bg-[repeating-conic-gradient(var(--color-checker)_0_25%,var(--color-panel)_0_50%)] bg-[length:16px_16px]"
      ref={box} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ cursor: panning ? 'grabbing' : 'grab', touchAction: 'none' }} data-testid="compare-view">
      {before && <img src={before} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={place} />}
      {after && (
        <div className="pointer-events-none absolute inset-0" style={{ clipPath: shown }}>
          {after.kind === 'image'
            ? <img src={after.url} alt="" draggable={false} className="absolute max-w-none" style={place} />
            : <div ref={canvasHost} className="absolute" style={place} />}
        </div>
      )}
      {after && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${pos * 100}%` }} />
          <div role="slider" tabIndex={0} aria-label={t('ai.compare')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
            className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-neutral-700 shadow-md ring-1 ring-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ left: `${pos * 100}%` }} data-testid="compare-handle"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { setPos((p) => Math.max(0, p - 0.05)); e.preventDefault(); }
              if (e.key === 'ArrowRight') { setPos((p) => Math.min(1, p + 0.05)); e.preventDefault(); }
            }}>
            <Icon name="back" size={12} /><Icon name="back" size={12} className="rotate-180" />
          </div>
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">{t('ai.before')}</span>
          <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">{t('ai.after')}</span>
        </>
      )}
      {overlay}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-panel/90 p-0.5 shadow" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm px-1.5" onClick={() => zoomTo(view.zoom / 1.25)} aria-label={t('ai.zoomOut')} title={t('ai.zoomOut')}><Icon name="minus" size={14} /></button>
        <span className="w-11 text-center text-[11px] tabular-nums text-muted">{Math.round(view.zoom * 100)}%</span>
        <button className="btn btn-ghost btn-sm px-1.5" onClick={() => zoomTo(view.zoom * 1.25)} aria-label={t('ai.zoomIn')} title={t('ai.zoomIn')}><Icon name="plus" size={14} /></button>
        <button className="btn btn-ghost btn-sm px-1.5" onClick={fit} title={t('ai.zoomFit')} aria-label={t('ai.zoomFit')}><Icon name="fit" size={14} /></button>
        <button className={`btn btn-ghost btn-sm px-1.5 text-[11px] ${real ? 'text-accent' : ''}`} onClick={() => zoomTo(1)} title={t('ai.zoomReal')} data-testid="compare-100">100%</button>
      </div>
    </div>
  );
}
