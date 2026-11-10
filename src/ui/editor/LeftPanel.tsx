import { useEffect, useMemo, useRef, useState } from 'react';
import { facePanels, findPanel, panelBleedRect } from '../../core/layout';
import { layerAssetIds, makeFillLayer, makeShapeLayer, makeTextLayer, type TextLayer } from '../../core/model';
import { activePiece } from '../../core/store';
import { allLayers, faceDieline } from '../../core/faces';
import type { PanelDef } from '../../core/templates/types';
import { ACCEPTED_TYPES, getAssetInfos, type AssetInfo } from '../../engine/assets';
import { downloadAsset, downloadAssets } from '../../engine/assetFiles';
import { db } from '../../engine/db';
import { ASSET_MIME } from '../../engine/editor/EditorCanvas';
import { Icon, Segmented, type IconName } from '../components';
import { EMPTY, editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';
import { clickTarget, dominantColors, importFiles, mainPanel, placeAssetSmart } from './actions';
import { openEnhance } from './enhance';
import { assetDpi, ENHANCE_BELOW_DPI } from '../../core/upscalePlan';
import { VERY_LOW_DPI } from '../../core/preflight';
import { AddQr } from './QrSection';
import { AlbumImport } from './AlbumImport';
import { FillEditor, fillCss, GRADIENT_PRESETS, type FillValue } from './FillEditor';
import { LayersPanel } from './LayersPanel';

type Tab = 'images' | 'text' | 'backgrounds';

function AssetThumb({ asset, used, dpi }: { asset: AssetInfo; used: number; dpi: number | null }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const low = dpi !== null && dpi < ENHANCE_BELOW_DPI;
  useEffect(() => {
    let u: string | null = null;
    void db.assets.get(asset.id).then((row) => {
      if (row) { u = URL.createObjectURL(row.preview); setUrl(u); }
    });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [asset.id]);
  return (
    <div className="group relative">
      <button
        draggable
        onDragStart={(e) => { e.dataTransfer.setData(ASSET_MIME, asset.id); e.dataTransfer.effectAllowed = 'copy'; }}
        onClick={() => placeAssetSmart(asset)}
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(var(--color-checker)_0_25%,var(--color-panel)_0_50%)] bg-[length:12px_12px] hover:border-accent"
        title={`${asset.name}\n${asset.width} × ${asset.height} px${used ? `\n${t('editor.usedTimes', { count: used })}` : ''}${dpi !== null ? `\n${t('ai.thumbDpi', { dpi: Math.round(dpi) })}` : ''}`}
      >
        {url && <img src={url} alt={asset.name} className="max-h-full max-w-full object-contain" draggable={false} />}
      </button>
      {used > 0 && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/65 px-1 text-[10px] font-medium text-white" title={t('editor.usedTimes', { count: used })}>{used}×</span>}
      {/* Too few pixels for print: the AI button stays visible and shows the DPI. */}
      {low && (
        <button className={`absolute bottom-1 right-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold text-white shadow ${dpi! < VERY_LOW_DPI ? 'bg-danger' : 'bg-warn'}`}
          title={t('ai.thumbLow', { dpi: Math.round(dpi!) })} aria-label={t('ai.thumbLow', { dpi: Math.round(dpi!) })} onClick={() => openEnhance(asset.id)} data-testid="asset-enhance-low">
          <Icon name="sparkle" size={11} />{Math.round(dpi!)}
        </button>
      )}
      {/* Shown on hover and on keyboard focus. */}
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {!low && (
          <button className="rounded bg-panel/90 p-0.5 text-muted shadow hover:text-accent" data-testid="asset-enhance"
            title={t('ai.open')} aria-label={t('ai.open')} onClick={() => openEnhance(asset.id)}>
            <Icon name="sparkle" size={12} />
          </button>
        )}
        <button className="rounded bg-panel/90 p-0.5 text-muted shadow hover:text-accent" data-testid="asset-download"
          title={t('editor.downloadImage')} aria-label={t('editor.downloadImage')} onClick={() => void downloadAsset(asset.id)}>
          <Icon name="download" size={12} />
        </button>
        <button className="rounded bg-panel/90 p-0.5 text-muted shadow hover:text-danger"
          title={t('common.delete')} aria-label={t('common.delete')} onClick={() => editor.removeAsset(asset.id)}>
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  );
}

/** Says where a click on a library image puts it (the rule is not obvious otherwise). */
function ClickHint() {
  const t = useT();
  const piece = useEditor(activePiece);
  const side = useEditor((s) => s.selection.side);
  // A string, so this re-renders only when the answer changes.
  const target = useEditor((s) => { const c = clickTarget(s); return `${c.why}:${c.panel?.id ?? ''}`; });
  const [why, id] = target.split(':');
  const panel = piece && id ? findPanel(faceDieline(piece, side), side, id) : undefined;
  const name = panel ? t(panel.labelKey, panel.labelVars ?? {}) : '';
  return (
    <p className="text-[11px] leading-relaxed text-muted" data-testid="click-hint">
      {panel ? t(why === 'empty' ? 'editor.clickEmpty' : 'editor.clickSelected', { panel: name }) : t('editor.clickFree')}
    </p>
  );
}

function ImagesTab() {
  const t = useT();
  const assetIds = useEditor((s) => s.project?.assetIds ?? EMPTY);
  const project = useEditor((s) => s.project);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [busy, setBusy] = useState(0);
  const [hover, setHover] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { void getAssetInfos(assetIds).then(setAssets); }, [assetIds]);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of project?.pieces ?? []) for (const l of allLayers(p)) for (const id of layerAssetIds(l)) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [project]);

  const onFiles = async (files: File[]) => {
    setBusy(files.length);
    try { await importFiles(files); } finally { setBusy(0); }
  };

  return (
    <div className="space-y-3 p-3">
      <div
        onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setHover(true); } }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => { e.preventDefault(); setHover(false); void onFiles([...e.dataTransfer.files]); }}
        className={`flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 text-xs text-muted ${hover ? 'border-accent bg-accent-soft' : 'border-line'}`}
      >
        <Icon name="upload" size={18} className="shrink-0" />
        <span className="min-w-0 flex-1 leading-snug">{busy ? t('editor.importing', { count: busy }) : t('editor.dropHere')}</span>
        <button className="btn btn-sm shrink-0" onClick={() => input.current?.click()} data-testid="browse-images">{t('editor.browse')}</button>
        <input ref={input} type="file" accept={ACCEPTED_TYPES.join(',')} multiple hidden data-testid="file-input"
          onChange={(e) => { void onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      {assets.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="label">{t('editor.libraryCount', { count: assets.length })}</span>
          <button className="btn btn-ghost btn-sm -mr-1 shrink-0" title={t('editor.downloadAllHint')} data-testid="download-all-images"
            onClick={() => void downloadAssets(assets.map((a) => a.id), `${project?.name ?? 'coverfold'} - ${t('editor.imagesZip')}`)}>
            <Icon name="download" size={14} />{t(assets.length > 1 ? 'editor.downloadAll' : 'editor.downloadOne')}
          </button>
        </div>
      )}
      {assets.length > 0 && <ClickHint />}
      <div className="grid grid-cols-3 gap-2" data-testid="asset-grid">
        {assets.map((a) => <AssetThumb key={a.id} asset={a} used={usage.get(a.id) ?? 0} dpi={project ? assetDpi(project, a.id) : null} />)}
      </div>
    </div>
  );
}

const TEXT_PRESETS: { key: string; icon: IconName; make: (p: PanelDef, t: (k: string) => string) => TextLayer }[] = [
  {
    key: 'editor.addTitle', icon: 'text',
    make: (p, t) => makeTextLayer(t('editor.sampleTitle'), { x: p.rect.x + p.safe, y: p.rect.y + p.safe + 6, w: p.rect.w - 2 * p.safe, h: 12 }, { fontFamily: 'Bebas Neue', fontSize: 32, align: 'center' }),
  },
  {
    key: 'editor.addSubtitle', icon: 'text',
    make: (p, t) => makeTextLayer(t('editor.sampleSubtitle'), { x: p.rect.x + p.safe, y: p.rect.y + p.safe + 22, w: p.rect.w - 2 * p.safe, h: 7 }, { fontFamily: 'Oswald', fontSize: 14, align: 'center', letterSpacing: 0.08 }),
  },
  {
    key: 'editor.addParagraph', icon: 'text',
    make: (p, t) => makeTextLayer(t('editor.sampleParagraph'), { x: p.rect.x + p.safe + 4, y: p.rect.y + p.rect.h / 2, w: p.rect.w - 2 * p.safe - 8, h: 5 }, { fontSize: 9 }),
  },
  {
    key: 'editor.addTracklist', icon: 'text',
    make: (p, t) => makeTextLayer(t('editor.sampleTracklist'), { x: p.rect.x + p.safe + 6, y: p.rect.y + p.safe + 8, w: p.rect.w - 2 * p.safe - 12, h: 20 }, { fontSize: 9, lineHeight: 1.5, mode: 'tracklist' }),
  },
];

function TextTab() {
  const t = useT();
  const piece = useEditor(activePiece);
  const side = useEditor((s) => s.selection.side);
  if (!piece) return null;
  const d = faceDieline(piece, side);
  const panels = facePanels(d, side);
  const spines = panels.filter((p) => p.textRotation === 90 || p.textRotation === 270);

  const addSpine = (p: PanelDef) => {
    const len = p.rect.h - 2 * Math.max(p.safe, 3);
    const thick = Math.max(2.5, p.rect.w - 2 * p.safe);
    const layer = makeTextLayer(t('editor.sampleSpine'), { x: p.rect.x + p.rect.w / 2 - len / 2, y: p.rect.y + p.rect.h / 2 - thick / 2, w: len, h: thick },
      { fontFamily: 'Oswald', fontWeight: 700, fontSize: Math.min(11, (thick / 0.3528) * 0.62), align: 'center' });
    layer.rotation = p.textRotation ?? 90;
    editor.addLayer(layer);
  };

  return (
    <div className="space-y-2 p-3">
      <p className="text-[11px] text-muted">{t('editor.textTarget', { panel: t(mainPanel(panels).labelKey, mainPanel(panels).labelVars ?? {}) })}</p>
      {TEXT_PRESETS.map((preset) => (
        <button key={preset.key} className="btn w-full justify-start" onClick={() => editor.addLayer(preset.make(mainPanel(panels), t))}>
          <Icon name={preset.icon} />{t(preset.key)}
        </button>
      ))}
      {panels.filter((p) => p.shape === 'disc').map((p) => (
        <button key={`arc-${p.id}`} className="btn w-full justify-start" data-testid="add-arc-text" onClick={() => {
          const size = Math.min(p.rect.w, p.rect.h);
          const layer = makeTextLayer(t('editor.sampleArc'), { x: p.rect.x + (p.rect.w - size) / 2, y: p.rect.y + (p.rect.h - size) / 2, w: size, h: size },
            { fontFamily: 'Oswald', fontWeight: 700, fontSize: 12, align: 'center', mode: 'arc', arcRadius: size / 2 - 8, arcSide: 'top' });
          editor.addLayer(layer);
        }}>
          <Icon name="disc" />{t('editor.addArc')}
        </button>
      ))}
      {spines.map((p) => (
        <button key={p.id} className="btn w-full justify-start" onClick={() => addSpine(p)}>
          <Icon name="rotate" />{t('editor.addSpine')} ({t(p.labelKey)})
        </button>
      ))}
      <div className="pt-2"><AddQr /></div>
    </div>
  );
}

const SWATCHES = ['#ffffff', '#f4efe6', '#e9e4da', '#c9c3b6', '#111111', '#1d1b3a', '#203a63', '#2f5bd3', '#1f7a6d', '#2f855a', '#c9a227', '#d97706', '#c53030', '#9d174d', '#6b21a8'];

function BackgroundsTab() {
  const t = useT();
  const piece = useEditor(activePiece);
  const side = useEditor((s) => s.selection.side);
  const project = useEditor((s) => s.project);
  const [fill, setFill] = useState<FillValue>({ color: '#1d1b3a', gradient: null });
  const [above, setAbove] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);
  useEffect(() => { if (project) void dominantColors(project.assetIds).then(setPalette); }, [project?.assetIds]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!piece) return null;
  const d = faceDieline(piece, side);
  const panels = facePanels(d, side).filter((p) => p.labelKey !== 'panel.hidden');
  const solid = !fill.gradient;
  const pick = (c: string) => setFill(solid ? { color: c, gradient: null } : { color: c, gradient: { ...fill.gradient!, from: c } });

  /** New fill layer on the whole piece or on one panel, under (or over) the other layers. */
  const addFill = (where: 'piece' | string) => {
    const p = where === 'piece' ? null : panels.find((x) => x.id === where)!;
    // A panel's background is the panel plus bleed on its cut edges: it stops at the folds.
    const layer = makeFillLayer(fill.color, p ? panelBleedRect(p, project?.print.bleed ?? 0) : { x: 0, y: 0, w: d.w, h: d.h }, t('editor.background'));
    layer.gradient = fill.gradient;
    editor.addLayer(layer);
    if (!above) editor.arrange([layer.id], 'back');
  };

  const swatch = (c: string) => (
    <button key={c} className={`h-7 rounded border ${c === (fill.gradient?.from ?? fill.color) ? 'ring-2 ring-accent' : 'border-line'}`} style={{ background: c }} title={c} aria-label={c} onClick={() => pick(c)} />
  );

  return (
    <div className="space-y-4 p-3" data-testid="backgrounds-tab">
      <div className="space-y-2">
        <div className="label">{t('editor.colorFill')}</div>
        <FillEditor value={fill} onChange={setFill} />
        {solid ? (
          <div className="grid grid-cols-5 gap-1.5">{SWATCHES.map(swatch)}</div>
        ) : (
          <>
            <div className="text-[11px] text-muted">{t('fill.presets')}</div>
            <div className="grid grid-cols-5 gap-1.5" data-testid="gradient-presets">
              {GRADIENT_PRESETS.map((g, i) => (
                <button key={i} className="h-7 rounded border border-line" title={`${g.from} - ${g.to}`} aria-label={`${g.from} - ${g.to}`}
                  style={{ background: `${fillCss({ color: g.from, gradient: g })}, repeating-conic-gradient(var(--color-checker) 0 25%, var(--color-panel) 0 50%) 0 0 / 8px 8px` }}
                  onClick={() => setFill({ color: g.from, gradient: { ...g } })} />
              ))}
            </div>
          </>
        )}
        {palette.length > 0 && (
          <>
            <div className="text-[11px] text-muted">{t(solid ? 'editor.pickFromImage' : 'fill.fromImage')}</div>
            <div className="grid grid-cols-5 gap-1.5">{palette.map(swatch)}</div>
          </>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="label">{t('fill.applyTo')}</div>
          <Segmented<'below' | 'above'> value={above ? 'above' : 'below'} onChange={(v) => setAbove(v === 'above')} ariaLabel={t('fill.position')}
            options={[{ value: 'below', label: t('fill.below'), title: t('fill.belowHint') }, { value: 'above', label: t('fill.above'), title: t('fill.aboveHint') }]} />
        </div>
        {/* One button per panel: the target is always explicit. */}
        <div className="grid grid-cols-2 gap-1.5" data-testid="fill-targets">
          <button className="btn btn-sm col-span-2 justify-start" onClick={() => addFill('piece')} data-testid="fill-piece"><Icon name="fill" size={14} />{t('fill.wholePiece')}</button>
          {panels.map((p) => (
            <button key={p.id} className="btn btn-sm justify-start text-left" onClick={() => addFill(p.id)} data-testid={`fill-panel-${p.id}`}>
              <Icon name="square" size={14} className="shrink-0" /><span className="min-w-0">{t(p.labelKey, p.labelVars ?? {})}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-muted">{t(above ? 'fill.aboveHint' : 'fill.belowHint')}</p>
      </div>
      <div>
        <div className="label mb-2">{t('editor.shapes')}</div>
        <div className="grid grid-cols-2 gap-2">
          {(['rect', 'ellipse'] as const).map((shape) => (
            <button key={shape} className="btn" onClick={() => {
              const p = mainPanel(panels);
              const l = makeShapeLayer(shape, { x: p.rect.x + p.rect.w / 2 - 20, y: p.rect.y + p.rect.h / 2 - 15, w: 40, h: 30 });
              l.name = t(`editor.${shape}`);
              l.fill = fill.color;
              l.gradient = fill.gradient;
              editor.addLayer(l);
            }}>
              <Icon name={shape === 'rect' ? 'square' : 'circle'} />{t(`editor.${shape}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('images');
  const [album, setAlbum] = useState(false);
  const tabs: { id: Tab; icon: IconName; label: string }[] = [
    { id: 'images', icon: 'image', label: t('editor.images') },
    { id: 'text', icon: 'text', label: t('editor.text') },
    { id: 'backgrounds', icon: 'fill', label: t('editor.backgrounds') },
  ];
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex border-b border-line" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} data-testid={`tab-${x.id}`}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${tab === x.id ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-ink'}`}>
            <Icon name={x.icon} />{x.label}
          </button>
        ))}
      </div>
      {/* Top: what you can add. Bottom: what is on this face (layers), always in view. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab !== 'backgrounds' && (
          <div className="px-3 pt-3">
            <button className="btn w-full justify-start" onClick={() => setAlbum(true)} title={t('album.buttonHint')} data-testid="open-album">
              <Icon name="search" />{t('album.button')}
            </button>
          </div>
        )}
        {tab === 'images' && <ImagesTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'backgrounds' && <BackgroundsTab />}
      </div>
      {/* As tall as its layers, up to 45% of the column; it scrolls beyond. */}
      <div className="flex max-h-[45%] min-h-[96px] shrink-0 flex-col"><LayersPanel /></div>
      {album && <AlbumImport onClose={() => setAlbum(false)} />}
    </aside>
  );
}
