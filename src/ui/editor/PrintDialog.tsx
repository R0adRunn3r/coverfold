import { useEffect, useMemo, useRef, useState } from 'react';
import type { DuplexMode, ImageFormat, Piece, PrintSettings, Project } from '../../core/model';
import { buildPrintPlan, type SheetPage } from '../../core/printPlan';
import { getTemplate } from '../../core/templates/catalog';
import { A4 } from '../../core/units';
import { cancelExport, downloadBytes, exportPdf, safeFileName } from '../../engine/render/exportClient';
import { drawSheetPreview, preloadPreviews } from '../../engine/render/preview';
import { printStrings } from '../../i18n';
import { formatBytes, Icon, Modal, NumberField, Row, Segmented, Slider } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';

/** Above this the browser canvas (16384 px per side) or the memory becomes the limit. */
export const MAX_LOSSLESS_DPI = 600;
// PDF size estimate in bytes per mm^2 per dpi^2: between smooth artwork and noisy photos.
const JPEG_K = 1.6e-4;
const FLATE_K = 2.0e-3;

/** A4 preview drawn at the size it is shown (device pixels), so hairline marks stay visible. */
function SheetCanvas({ page, project, pieces, className = '' }: { page: SheetPage; project: Project; pieces: Piece[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width * (window.devicePixelRatio || 1))));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c || width < 10) return;
    c.width = width;
    c.height = Math.round((width * A4.h) / A4.w);
    drawSheetPreview(c, page, project, pieces);
  }, [page, project, pieces, width]);
  return <canvas ref={ref} className={`paper block aspect-[210/297] ${className}`} />;
}

/** Large view of one sheet, to check marks and placement; the arrow keys browse the sheets. */
function SheetZoom({ sheets, index, setIndex, project, pieces }: {
  sheets: SheetPage[]; index: number; setIndex: (i: number | null) => void; project: Project; pieces: Piece[];
}) {
  const t = useT();
  const pg = sheets[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex(Math.min(sheets.length - 1, index + 1));
      if (e.key === 'ArrowLeft') setIndex(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, sheets.length, setIndex]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/85 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setIndex(null); }} data-testid="sheet-zoom">
      <div className="flex items-center gap-3">
        <button className="btn btn-icon" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label={t('print.prevSheet')}><Icon name="back" /></button>
        <SheetCanvas page={pg} project={project} pieces={pieces} className="h-[calc(100vh-7.5rem)] w-auto max-w-[calc(100vw-8rem)]" />
        <button className="btn btn-icon" disabled={index === sheets.length - 1} onClick={() => setIndex(index + 1)} aria-label={t('print.nextSheet')}><Icon name="back" className="rotate-180" /></button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-white/90">
        <span className="font-medium">{t(pg.face === 'front' ? 'print.sheetFront' : 'print.sheetBack', { n: pg.sheetIndex + 1 })} ({t(`paper.${pg.paper}`)})</span>
        <span className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden="true"><path d="M1 4h8 M13 4h8" stroke="currentColor" strokeWidth="1.5" /></svg>{t('print.legendCrop')}</span>
        <span className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" /></svg>{t('print.legendFold')}</span>
        <span className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" stroke="currentColor" strokeWidth="0.8" /></svg>{t('print.legendCut')}</span>
        <button className="btn btn-sm" onClick={() => setIndex(null)}><Icon name="x" size={14} />{t('common.close')}</button>
      </div>
    </div>
  );
}

const Toggle = ({ label, checked, onChange, hint, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testId?: string }) => (
  <label className="flex cursor-pointer items-start gap-2 text-sm">
    <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    <span className="min-w-0">{label}{hint && <span className="block text-[11px] leading-relaxed text-muted">{hint}</span>}</span>
  </label>
);

export function PrintDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useEditor((s) => s.project)!;
  const s = project.print;
  const set = (patch: Partial<PrintSettings>) => editor.setPrint(patch);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneBytes, setDoneBytes] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => { void preloadPreviews(project.pieces).then(() => setReady(true)); }, [project.pieces]);
  const plan = useMemo(() => buildPrintPlan(project, printStrings()), [project]);
  const sheets = plan.pages.filter((p): p is SheetPage => p.kind === 'sheet');
  const names = (ids: string[]) => ids.map((id) => {
    const p = project.pieces.find((x) => x.id === id);
    return p ? t(getTemplate(p.templateId).nameKey) : id;
  }).join(', ');

  const estimate = useMemo(() => {
    const area = sheets.reduce((a, pg) => a + pg.images.reduce((b, i) => b + i.rect.w * i.rect.h, 0), 0);
    return area * s.dpi * s.dpi * (s.format === 'jpeg' ? JPEG_K : FLATE_K);
  }, [sheets, s.dpi, s.format]);

  const run = async () => {
    setError(null);
    setDoneBytes(null);
    setProgress({ done: 0, total: 1 });
    try {
      const bytes = await exportPdf(project, printStrings(), (done, total) => setProgress({ done, total }));
      downloadBytes(bytes, `${safeFileName(project.name)}.pdf`);
      setDoneBytes(bytes.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const dpiOptions = [150, 300, 600, 1200].map((v) => ({
    value: v,
    label: (
      <span className="flex flex-col leading-tight">
        <span>{v}</span>
        <span className="text-[10px] opacity-70">{v === 600 ? t('print.recommended') : t(`print.dpi${v}`)}</span>
      </span>
    ),
    title: t(`print.dpi${v}`),
  }));

  // What to load in the printer, by paper kind.
  const paperCounts = new Map<string, number>();
  for (const pg of sheets) if (pg.face === 'front') paperCounts.set(pg.paper, (paperCounts.get(pg.paper) ?? 0) + 1);
  const paperSummary = paperCounts.size
    ? t('print.summary', { list: [...paperCounts].map(([paper, count]) => t('print.summaryItem', { count, paper: t(`paper.${paper}`) })).join(', ') })
    : '';

  return (
    <Modal onClose={() => { if (zoom !== null) setZoom(null); else if (!progress) onClose(); }} labelledBy="print-title" wide>
      {zoom !== null && sheets[zoom] && <SheetZoom sheets={sheets} index={zoom} setIndex={setZoom} project={project} pieces={plan.pieces} />}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="print-title" className="flex items-center gap-2 text-lg font-semibold"><Icon name="printer" />{t('print.title')}</h2>
        <button className="btn btn-ghost btn-icon" onClick={onClose} disabled={!!progress} aria-label={t('common.close')}><Icon name="x" /></button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_340px]">
        <div className="min-h-0 overflow-y-auto bg-canvas p-5" data-testid="print-preview">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
            <span>{t('print.sheets', { count: plan.sheetCount })}</span>
            <span className="text-xs">{t('print.zoomHint')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
            {ready && sheets.map((pg, i) => (
              <figure key={i}>
                <button className="group relative block w-full cursor-zoom-in" onClick={() => setZoom(i)} aria-label={t('print.zoomSheet', { n: pg.sheetIndex + 1 })} data-testid={`sheet-${i}`}>
                  <SheetCanvas page={pg} project={project} pieces={plan.pieces} className="h-auto w-full" />
                  <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100"><Icon name="search" size={14} /></span>
                </button>
                <figcaption className="mt-1 text-center text-xs text-muted">
                  {t(pg.face === 'front' ? 'print.sheetFront' : 'print.sheetBack', { n: pg.sheetIndex + 1 })} ({t(`paper.${pg.paper}`)})
                </figcaption>
              </figure>
            ))}
            {plan.pages.some((p) => p.kind === 'instructions') && (
              <figure>
                <div className="paper flex aspect-[210/297] w-full flex-col gap-1.5 p-4">
                  <div className="h-2 w-2/3 rounded bg-gray-300" />
                  {Array.from({ length: 12 }, (_, i) => <div key={i} className="h-1 rounded bg-gray-200" style={{ width: `${55 + ((i * 37) % 40)}%` }} />)}
                </div>
                <figcaption className="mt-1 text-center text-xs text-muted">{t('print.instructions')}</figcaption>
              </figure>
            )}
          </div>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto border-l border-line p-5 text-sm">
          {paperSummary && <p className="rounded-md bg-subtle p-3 text-xs" data-testid="paper-summary">{paperSummary}</p>}
          <div className="space-y-2">
            <div className="label">{t('print.quality')}</div>
            <Segmented value={s.dpi} options={dpiOptions} ariaLabel={t('print.quality')}
              onChange={(dpi) => set({ dpi, format: s.format === 'png' && dpi > MAX_LOSSLESS_DPI ? 'jpeg' : s.format })} />
            {s.dpi > 600 && <p className="text-xs text-warn">{t('print.slowWarning')}</p>}
          </div>
          <div className="space-y-2">
            <div className="label">{t('print.format')}</div>
            <Segmented<ImageFormat> value={s.format} ariaLabel={t('print.format')} data-testid="print-format"
              onChange={(format) => set({ format, dpi: format === 'png' ? Math.min(s.dpi, MAX_LOSSLESS_DPI) : s.dpi })}
              options={[{ value: 'png', label: t('print.png'), title: t('print.losslessLimited') }, { value: 'jpeg', label: t('print.jpeg') }]} />
            <p className="text-[11px] leading-relaxed text-muted">{t(s.format === 'png' ? 'print.pngHint' : 'print.jpegHint')}</p>
          </div>
          <div className="space-y-2">
            <div className="label">{t('print.duplex')}</div>
            <Segmented<DuplexMode> value={s.duplex} onChange={(duplex) => set({ duplex })} ariaLabel={t('print.duplex')}
              options={[{ value: 'none', label: t('print.duplexNone') }, { value: 'long', label: t('print.duplexLong') }, { value: 'short', label: t('print.duplexShort') }]} />
            {s.duplex !== 'none' && (
              <>
                <Row label={t('print.backOffset')}>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField value={s.backOffsetX} step={0.1} min={-5} max={5} suffix="X" onChange={(backOffsetX) => set({ backOffsetX })} ariaLabel="X" />
                    <NumberField value={s.backOffsetY} step={0.1} min={-5} max={5} suffix="Y" onChange={(backOffsetY) => set({ backOffsetY })} ariaLabel="Y" />
                  </div>
                </Row>
                <button className="btn btn-sm w-full" data-testid="calibration" onClick={async () => {
                  const { composeCalibrationPdf } = await import('../../core/export/calibration');
                  const bytes = await composeCalibrationPdf({
                    title: t('calib.title'),
                    steps: [t('calib.step1'), t('calib.step2'), t('calib.step3'), t('calib.step4')],
                    backTitle: t('calib.backTitle'), xLabel: t('calib.xLabel'), yLabel: t('calib.yLabel'),
                  });
                  downloadBytes(bytes, `${t('print.calibrationFile')}.pdf`);
                }}>
                  <Icon name="download" size={14} />{t('print.calibration')}
                </button>
                <p className="text-[11px] text-muted">{t('print.calibrationHint')}</p>
              </>
            )}
          </div>

          <div className="space-y-2" data-testid="print-contents">
            <div className="label">{t('print.pdfContents')}</div>
            <Toggle label={t('print.ruler')} hint={t('print.rulerHint')} checked={s.ruler} onChange={(ruler) => set({ ruler })} testId="print-ruler" />
            {plan.rulerMissing && <p className="text-xs leading-relaxed text-warn" data-testid="ruler-missing">{t('print.rulerMissing')}</p>}
            <Toggle label={t('print.instructions')} hint={t('print.instructionsHint')} checked={s.instructions} onChange={(instructions) => set({ instructions })} testId="print-instructions" />
          </div>

          <details className="group rounded-md border border-line" data-testid="print-advanced">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium">
              {t('print.advanced')}<Icon name="down" size={14} className="transition group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-line px-3 py-3">
              <div className="space-y-2">
                <div className="label">{t('print.bleed')}</div>
                <Slider value={s.bleed} min={0} max={5} step={0.5} onChange={(bleed) => set({ bleed })} format={(v) => `${v} mm`} ariaLabel={t('print.bleed')} />
              </div>
              <div className="space-y-2">
                <div className="label">{t('print.marks')}</div>
                <Toggle label={t('print.cropMarks')} checked={s.cropMarks} onChange={(cropMarks) => set({ cropMarks })} />
                <Toggle label={t('print.foldMarks')} checked={s.foldMarks} onChange={(foldMarks) => set({ foldMarks })} />
                <Row label={t('print.cutLine')}>
                  <select className="field" value={s.cutLine} onChange={(e) => set({ cutLine: e.target.value as PrintSettings['cutLine'] })}>
                    <option value="auto">{t('print.cutAuto')}</option>
                    <option value="always">{t('print.cutAlways')}</option>
                    <option value="never">{t('print.cutNever')}</option>
                  </select>
                </Row>
              </div>
              <Row label={t('print.printerMargin')}>
                <div className="flex items-center gap-2">
                  <NumberField value={s.printerMargin} step={0.5} min={0} max={15} suffix="mm" onChange={(printerMargin) => set({ printerMargin })} ariaLabel={t('print.printerMargin')} />
                  <button className={`btn btn-sm whitespace-nowrap ${s.printerMargin === 0 ? 'border-accent text-accent' : ''}`} onClick={() => set({ printerMargin: 0 })}>{t('print.borderless')}</button>
                </div>
              </Row>
              <div className="space-y-2">
                <div className="label">{t('print.extras')}</div>
                <Toggle label={t('print.vectorText')} checked={s.vectorText !== false} onChange={(vectorText) => set({ vectorText })} />
                <Toggle label={t('print.enhanceSmall')} checked={s.enhanceSmall !== false} onChange={(enhanceSmall) => set({ enhanceSmall })} />
              </div>
            </div>
          </details>

          {(plan.tooLarge.length > 0 || plan.tight.length > 0 || plan.insideIgnored.length > 0) && (
            <div className="space-y-1 rounded-md bg-warn-soft p-3 text-xs text-warn" data-testid="print-warnings">
              {plan.tooLarge.length > 0 && <p>{t('print.tooLarge', { names: names(plan.tooLarge) })}</p>}
              {plan.tight.length > 0 && <p>{t('print.tight', { names: names(plan.tight) })}</p>}
              {plan.insideIgnored.length > 0 && <p>{t('print.insideIgnored', { names: names(plan.insideIgnored) })}</p>}
            </div>
          )}
          {plan.split.length > 0 && (
            <p className="flex gap-2 rounded-md bg-subtle p-3 text-xs" data-testid="print-split"><Icon name="info" size={14} className="mt-0.5 shrink-0 text-accent" />{t('print.splitInfo', { names: names(plan.split.map((x) => x.pieceId)), count: plan.split.length })}</p>
          )}
          <p className="rounded-md bg-accent-soft p-3 text-xs text-accent-dark">{t('print.tip')}</p>
          {error && <p className="rounded-md bg-danger-soft p-3 text-xs text-danger">{t('print.error', { message: error })}</p>}
          {doneBytes !== null && <p className="text-xs text-ok" data-testid="export-done"><Icon name="check" size={12} className="mr-1 inline" />{t('print.done')}, {formatBytes(doneBytes)}</p>}

          {/* Pinned to the bottom edge (it covers the column padding, so nothing scrolls under it). */}
          <div className="sticky -bottom-5 -mx-5 -mb-5 border-t border-line bg-panel px-5 py-3">
            {progress ? (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded bg-subtle"><div className="h-full bg-accent transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{t('print.exporting', { done: progress.done, total: progress.total })}</span>
                  <button className="btn btn-sm" onClick={() => { cancelExport(); setProgress(null); }}>{t('print.cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary w-full flex-col gap-0 py-2" onClick={run} disabled={plan.sheetCount === 0} data-testid="export-pdf">
                <span className="flex items-center gap-1.5 font-medium"><Icon name="download" />{t('print.export')}</span>
                <span className="text-[11px] opacity-85">{t('print.sheets', { count: plan.sheetCount })}, {t('print.estimate', { size: formatBytes(estimate) })}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

