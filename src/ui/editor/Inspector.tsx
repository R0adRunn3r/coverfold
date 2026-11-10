import { facePanels, panelBleedRect, type FitMode } from '../../core/layout';
import type { BleedFill, FillLayer, ImageLayer, Layer, ShapeLayer, TextLayer, TextMode } from '../../core/model';
import { LOW_DPI, VERY_LOW_DPI, layerDpi } from '../../core/preflight';
import { activePiece, selectedLayers } from '../../core/store';
import { faceDieline, isMultiPage, pageCount } from '../../core/faces';
import { assemblyKeysOf, buildPageDieline, choicePatch, defaultParams, getTemplate } from '../../core/templates/catalog';
import type { PanelDef, PaperKind, Side } from '../../core/templates/types';
import { layerBounds, layerPanel } from '../../core/align';
import { filledMode } from '../../core/placement';
import { FONT_FAMILIES } from '../../engine/fonts';
import { ColorField, Icon, IconButton, NumberField, Row, Section, Segmented, Slider } from '../components';
import { editor, useEditor, useEditorShallow } from '../editorInstance';
import { AssetPicker } from './AssetPicker';
import { downloadAsset } from '../../engine/assetFiles';
import { useState } from 'react';
import { useT } from '../hooks';
import { stepHighlight } from '../../core/assembly';
import { FillEditor } from './FillEditor';
import { deleteFormat, saveFormat } from '../../engine/formats';
import { useSavedFormats } from '../useFormats';
import { FlatLayout, ProductArt } from '../TemplatePreview';
import { AlignBar } from './AlignBar';
import { EffectsSection } from './EffectsSection';
import { ImageFraming } from './ImageFraming';
import { QrSection } from './QrSection';
import { DiscHolderSection } from './DiscHolderSection';
import { openEnhance } from './enhance';
import { ENHANCE_BELOW_DPI } from '../../core/upscalePlan';

function DpiBadge({ layer }: { layer: ImageLayer }) {
  const t = useT();
  const dpi = Math.round(layerDpi(layer) ?? 0);
  const [cls, key] = dpi < VERY_LOW_DPI ? ['bg-danger-soft text-danger', 'editor.dpiLow'] : dpi < LOW_DPI ? ['bg-warn-soft text-warn', 'editor.dpiOk'] : ['bg-ok-soft text-ok', 'editor.dpiGood'];
  return <span className={`chip ${cls}`} data-testid="dpi-badge">{t(key, { dpi })}</span>;
}

function GeometrySection({ layer }: { layer: Layer }) {
  const t = useT();
  const set = (patch: Partial<Layer>) => editor.updateLayer(layer.id, patch);
  const ratio = layer.w / layer.h;
  const keep = layer.type === 'image' || layer.type === 'qr';
  return (
    <Section title={t('inspector.position')}>
      <AlignBar layers={[layer]} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField value={layer.x} onChange={(x) => set({ x })} suffix="X" ariaLabel="X mm" />
        <NumberField value={layer.y} onChange={(y) => set({ y })} suffix="Y" ariaLabel="Y mm" />
        <NumberField value={layer.w} min={1} onChange={(w) => set(keep ? { w, h: w / ratio, x: layer.x + (layer.w - w) / 2, y: layer.y + (layer.h - w / ratio) / 2 } : { w })} suffix={t('inspector.wShort')} ariaLabel="W mm" />
        <NumberField value={layer.h} min={1} onChange={(h) => set(keep ? { h, w: h * ratio, x: layer.x + (layer.w - h * ratio) / 2, y: layer.y + (layer.h - h) / 2 } : { h })} suffix={t('inspector.hShort')} ariaLabel="H mm" />
      </div>
      <Row label={t('inspector.rotation')}>
        <div className="flex items-center gap-1">
          <NumberField value={layer.rotation} step={1} decimals={0} onChange={(r) => set({ rotation: ((r % 360) + 360) % 360 })} suffix="°" ariaLabel={t('inspector.rotation')} />
          <IconButton icon="rotate" label={t('inspector.rotateText')} onClick={() => set({ rotation: (layer.rotation + 90) % 360 })} />
        </div>
      </Row>
      <Row label={t('inspector.opacity')}>
        <Slider value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(v) => editor.updateLayer(layer.id, { opacity: v / 100 }, `opacity:${layer.id}`)} format={(v) => `${v}%`} ariaLabel={t('inspector.opacity')} />
      </Row>
    </Section>
  );
}

/**
 * Which panel a layer is on, and moving it to another one. A picture that
 * fills its panel fills the new one; anything else keeps its place in it.
 */
function PanelSection({ layer, side }: { layer: Layer; side: Side }) {
  const t = useT();
  const piece = useEditor(activePiece)!;
  const bleed = useEditor((s) => s.project?.print.bleed ?? 0);
  const d = faceDieline(piece, side);
  const current = layerPanel(layer, d, side);
  const panels = facePanels(d, side).filter((p) => p.labelKey !== 'panel.hidden' || p.id === current?.id);
  const label = (p: PanelDef) => t(p.labelKey, p.labelVars ?? {});
  const fits = layer.type !== 'text' && layer.type !== 'qr';
  const target = current ?? panels.find((p) => p.id === 'front' || p.id === 'disc') ?? panels[0];
  const fit = (mode: FitMode) => target && editor.fitLayer(layer.id, target.id, mode);
  // An older layer clipped to a panel it does not fill, and that sticks out of it: say where it stops showing.
  const box = layerBounds(layer), shown = current && panelBleedRect(current, bleed);
  const sticksOut = !!shown && (box.x < shown.x - 0.01 || box.y < shown.y - 0.01 || box.x + box.w > shown.x + shown.w + 0.01 || box.y + box.h > shown.y + shown.h + 0.01);
  const clipped = layer.clip && current && sticksOut && !filledMode(layer, current, bleed) ? current : null;
  return (
    <Section title={t('inspector.panelTitle')}>
      <Row label={t('inspector.panelOn')}>
        <select className="field" value={current?.id ?? ''} onChange={(e) => editor.moveToPanel(layer.id, e.target.value)} data-testid="layer-panel">
          {!current && <option value="" disabled>{t('inspector.panelNone')}</option>}
          {panels.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      </Row>
      {fits && (
        <div className="grid grid-cols-3 gap-1">
          <button className="btn btn-sm" onClick={() => fit('cover-bleed')} data-testid="fit-cover-bleed">{t('inspector.fitCoverBleed')}</button>
          <button className="btn btn-sm" onClick={() => fit('cover-trim')}>{t('inspector.fitCoverTrim')}</button>
          <button className="btn btn-sm" onClick={() => fit('contain-safe')}>{t('inspector.fitContain')}</button>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted">{t(fits ? 'inspector.panelHint' : 'inspector.panelHintText')}</p>
      {clipped && (
        <div className="flex items-start gap-2 rounded-md bg-subtle p-2 text-[11px] leading-relaxed" data-testid="layer-clipped">
          <span className="min-w-0 flex-1">{t('inspector.clippedTo', { panel: label(clipped) })}</span>
          <button className="btn btn-sm shrink-0" onClick={() => editor.updateLayer(layer.id, { clip: null })}>{t('inspector.unclip')}</button>
        </div>
      )}
    </Section>
  );
}

function ReplacePicker({ layer }: { layer: ImageLayer }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="grid grid-cols-2 gap-1">
        <button className="btn btn-sm" onClick={() => setOpen(!open)} data-testid="replace-image"><Icon name="image" size={14} />{t('editor.replace')}</button>
        {/* To edit it elsewhere: save the original, edit it, bring it back with Replace. */}
        <button className="btn btn-sm" onClick={() => void downloadAsset(layer.assetId)} data-testid="download-original"
          title={t('inspector.downloadHint', { w: layer.naturalW, h: layer.naturalH })}><Icon name="download" size={14} />{t('inspector.downloadOriginal')}</button>
      </div>
      <button className={`btn btn-sm mt-1 w-full ${(layerDpi(layer) ?? Infinity) < ENHANCE_BELOW_DPI ? 'border-warn/50 bg-warn-soft text-warn' : ''}`}
        onClick={() => openEnhance(layer.assetId)} data-testid="inspector-enhance">
        <Icon name="sparkle" size={14} />{t('ai.open')}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] text-muted">{t('editor.replaceHint')}</p>
          <AssetPicker exclude={layer.assetId} onPick={(a) => { editor.replaceImage(layer.id, a); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

function ImageSection({ layer }: { layer: ImageLayer }) {
  const t = useT();
  const set = (patch: Partial<ImageLayer>, key?: string) => editor.updateLayer(layer.id, patch, key);
  const adj = (k: keyof ImageLayer['adjust'], v: number | boolean) => set({ adjust: { ...layer.adjust, [k]: v } }, `adjust:${layer.id}:${k}`);
  return (
    <>
      <Section title={t('inspector.layer')} right={<DpiBadge layer={layer} />}>
        <ReplacePicker layer={layer} />
        <div className="flex gap-1">
          <IconButton icon="flipH" label={t('inspector.flipH')} active={layer.flipX} onClick={() => set({ flipX: !layer.flipX })} />
          <IconButton icon="flipV" label={t('inspector.flipV')} active={layer.flipY} onClick={() => set({ flipY: !layer.flipY })} />
        </div>
        {/* A shaped picture stops at its own outline: there is no bleed to generate. */}
        {layer.mask ? <p className="text-[11px] leading-relaxed text-muted">{t('framing.noBleed')}</p> : (
          <Row label={t('inspector.bleedFill')}>
            <select className="field" value={layer.bleedFill} onChange={(e) => set({ bleedFill: e.target.value as BleedFill })}>
              <option value="auto">{t('inspector.bleedAuto')}</option>
              <option value="stretch">{t('inspector.bleedStretch')}</option>
              <option value="none">{t('inspector.bleedNone')}</option>
            </select>
          </Row>
        )}
      </Section>
      <Section title={t('inspector.adjust')}>
        <Row label={t('inspector.brightness')}><Slider value={layer.adjust.brightness} min={-100} max={100} onChange={(v) => adj('brightness', v)} ariaLabel={t('inspector.brightness')} /></Row>
        <Row label={t('inspector.contrast')}><Slider value={layer.adjust.contrast} min={-100} max={100} onChange={(v) => adj('contrast', v)} ariaLabel={t('inspector.contrast')} /></Row>
        <Row label={t('inspector.saturation')}><Slider value={layer.adjust.saturation} min={-100} max={100} onChange={(v) => adj('saturation', v)} ariaLabel={t('inspector.saturation')} /></Row>
        <Row label={t('inspector.blur')}>
          <Slider value={layer.adjust.blur ?? 0} min={0} max={10} step={0.1} onChange={(v) => adj('blur', v)} format={(v) => `${v.toFixed(1)} mm`} ariaLabel={t('inspector.blur')} />
        </Row>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={layer.adjust.grayscale} onChange={(e) => adj('grayscale', e.target.checked)} />{t('inspector.grayscale')}</label>
      </Section>
      <ImageFraming layer={layer} />
    </>
  );
}

function TextSection({ layer }: { layer: TextLayer }) {
  const t = useT();
  const set = (patch: Partial<TextLayer>, key?: string) => editor.updateLayer(layer.id, patch, key);
  return (
    <Section title={t('inspector.text')}>
      <textarea className="field min-h-20 font-[inherit]" value={layer.text} data-testid="text-content"
        onChange={(e) => set({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 24) || layer.name }, `text:${layer.id}`)} />
      <Row label={t('inspector.textMode')}>
        <Segmented<TextMode> value={layer.mode ?? 'plain'} ariaLabel={t('inspector.textMode')}
          onChange={(mode) => set(mode === 'arc'
            ? { mode, arcRadius: layer.arcRadius ?? Math.max(10, Math.min(layer.w, layer.h) / 2 - 6), arcSide: layer.arcSide ?? 'top', w: Math.max(layer.w, layer.h), h: Math.max(layer.w, layer.h) }
            : { mode })}
          options={[{ value: 'plain', label: t('inspector.modePlain') }, { value: 'tracklist', label: t('inspector.modeTracklist'), title: t('inspector.tracklistHint') }, { value: 'arc', label: t('inspector.modeArc') }]} />
      </Row>
      {layer.mode === 'tracklist' && <p className="text-[11px] text-muted">{t('inspector.tracklistHint')}</p>}
      {layer.mode === 'arc' && (
        <>
          <Row label={t('inspector.arcRadius')}>
            <Slider value={Math.round((layer.arcRadius ?? 40) * 2) / 2} min={5} max={70} step={0.5} onChange={(arcRadius) => set({ arcRadius }, `arc:${layer.id}`)} format={(v) => `${v} mm`} ariaLabel={t('inspector.arcRadius')} />
          </Row>
          <Row label={t('inspector.arcSide')}>
            <Segmented<'top' | 'bottom'> value={layer.arcSide ?? 'top'} onChange={(arcSide) => set({ arcSide })} ariaLabel={t('inspector.arcSide')}
              options={[{ value: 'top', label: t('inspector.arcTop') }, { value: 'bottom', label: t('inspector.arcBottom') }]} />
          </Row>
        </>
      )}
      <Row label={t('inspector.font')}>
        <select className="field" value={layer.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} style={{ fontFamily: layer.fontFamily }}>
          {FONT_FAMILIES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
      </Row>
      <Row label={t('inspector.fontSize')}>
        <div className="flex items-center gap-1">
          <NumberField value={layer.fontSize} step={0.5} min={2} max={300} onChange={(fontSize) => set({ fontSize })} suffix="pt" ariaLabel={t('inspector.fontSize')} />
          <button className={`btn btn-icon font-bold ${layer.fontWeight === 700 ? 'bg-accent-soft text-accent' : ''}`} title={t('inspector.bold')} aria-pressed={layer.fontWeight === 700} onClick={() => set({ fontWeight: layer.fontWeight === 700 ? 400 : 700 })}>B</button>
          <button className={`btn btn-icon italic ${layer.italic ? 'bg-accent-soft text-accent' : ''}`} title={t('inspector.italic')} aria-pressed={layer.italic} onClick={() => set({ italic: !layer.italic })}>I</button>
        </div>
      </Row>
      <Row label={t('inspector.color')}><ColorField value={layer.color} onChange={(color) => set({ color })} /></Row>
      <Row label={t('inspector.align')}>
        <Segmented value={layer.align} onChange={(align) => set({ align })} options={[
          { value: 'left', label: <Icon name="textLeft" size={14} />, title: t('align.left') },
          { value: 'center', label: <Icon name="textCenter" size={14} />, title: t('align.hcenter') },
          { value: 'right', label: <Icon name="textRight" size={14} />, title: t('align.right') },
        ]} ariaLabel={t('inspector.align')} />
      </Row>
      <Row label={t('inspector.lineHeight')}><Slider value={layer.lineHeight} min={0.8} max={2.5} step={0.05} onChange={(lineHeight) => set({ lineHeight }, `lh:${layer.id}`)} format={(v) => v.toFixed(2)} /></Row>
      <Row label={t('inspector.letterSpacing')}><Slider value={layer.letterSpacing} min={-0.1} max={0.5} step={0.01} onChange={(letterSpacing) => set({ letterSpacing }, `ls:${layer.id}`)} format={(v) => v.toFixed(2)} /></Row>
    </Section>
  );
}

function FillSection({ layer }: { layer: FillLayer }) {
  const t = useT();
  return (
    <Section title={t('inspector.fill')}>
      <FillEditor value={{ color: layer.color, gradient: layer.gradient ?? null }} onChange={(v) => editor.updateLayer(layer.id, { color: v.color, gradient: v.gradient })} />
    </Section>
  );
}

function ShapeSection({ layer }: { layer: ShapeLayer }) {
  const t = useT();
  const set = (patch: Partial<ShapeLayer>) => editor.updateLayer(layer.id, patch);
  return (
    <Section title={t('inspector.fill')}>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={!!layer.fill} onChange={(e) => set({ fill: e.target.checked ? '#cccccc' : null, gradient: null })} />{t('inspector.fill')}
      </label>
      {layer.fill && <FillEditor value={{ color: layer.fill, gradient: layer.gradient ?? null }} onChange={(v) => set({ fill: v.color, gradient: v.gradient })} />}
      <Row label={t('inspector.stroke')}>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={!!layer.stroke} onChange={(e) => set({ stroke: e.target.checked ? '#111111' : null })} aria-label={t('inspector.stroke')} />
          {layer.stroke && <ColorField value={layer.stroke} onChange={(stroke) => set({ stroke })} />}
        </div>
      </Row>
      {layer.stroke && <Row label={t('inspector.strokeWidth')}><NumberField value={layer.strokeWidth} step={0.1} min={0.1} onChange={(strokeWidth) => set({ strokeWidth })} suffix="mm" /></Row>}
      {layer.shape === 'rect' && <Row label={t('inspector.cornerRadius')}><NumberField value={layer.cornerRadius} step={0.5} min={0} onChange={(cornerRadius) => set({ cornerRadius })} suffix="mm" /></Row>}
    </Section>
  );
}

function ActionsSection({ ids }: { ids: string[] }) {
  const t = useT();
  const s = useEditor((st) => st);
  const piece = activePiece(s);
  const layers = selectedLayers(s);
  if (!piece) return null;
  const tpl = getTemplate(piece.templateId);
  const other: Side = s.selection.side === 'outside' ? 'inside' : 'outside';
  const locked = layers.every((l) => l.locked);
  return (
    <Section title={t('inspector.arrange')}>
      <div className="flex flex-wrap gap-1">
        <IconButton icon="top" label={t('inspector.toFront')} onClick={() => editor.arrange(ids, 'front')} />
        <IconButton icon="up" label={t('inspector.forward')} onClick={() => editor.arrange(ids, 'forward')} />
        <IconButton icon="down" label={t('inspector.backward')} onClick={() => editor.arrange(ids, 'backward')} />
        <IconButton icon="bottom" label={t('inspector.toBack')} onClick={() => editor.arrange(ids, 'back')} />
        <span className="mx-1 w-px bg-line" />
        <IconButton icon={locked ? 'unlock' : 'lock'} label={t(locked ? 'inspector.unlock' : 'inspector.lock')} onClick={() => editor.updateLayers(ids.map((id) => ({ id, patch: { locked: !locked } })))} />
        <IconButton icon="copy" label={t('common.duplicate')} onClick={() => editor.duplicateLayers(ids)} />
        <IconButton icon="trash" label={t('common.delete')} className="hover:text-danger" onClick={() => editor.removeLayers(ids)} />
      </div>
      <div className="flex flex-wrap gap-1">
        {!isMultiPage(piece) && tpl.sides.includes(other) && (
          <button className="btn btn-sm" onClick={() => editor.copyLayersTo(ids, piece.id, other)}>{t('inspector.copyToOtherSide')}</button>
        )}
        {s.project && s.project.pieces.length > 1 && (
          <select className="field w-auto py-0.5 text-xs" value="" aria-label={t('inspector.copyToPiece')}
            onChange={(e) => { if (e.target.value) editor.copyLayersTo(ids, e.target.value, 'outside'); }}>
            <option value="">{t('inspector.copyToPiece')}...</option>
            {s.project.pieces.filter((p) => p.id !== piece.id).map((p) => <option key={p.id} value={p.id}>{t(getTemplate(p.templateId).nameKey)}</option>)}
          </select>
        )}
      </div>
    </Section>
  );
}

function PieceInspector() {
  const t = useT();
  const piece = useEditor(activePiece);
  const bleed = useEditor((s) => s.project?.print.bleed ?? 3);
  const formats = useSavedFormats();
  const projectName = useEditor((s) => s.project?.name ?? 'coverfold');
  if (!piece) return <div className="p-4 text-sm text-muted">{t('editor.noPieceSelected')}</div>;
  const tpl = getTemplate(piece.templateId);
  const params = { ...defaultParams(tpl), ...piece.params };
  const mine = formats.filter((f) => f.templateId === piece.templateId);
  const d = isMultiPage(piece) ? buildPageDieline(piece.templateId, piece.params, 1) : faceDieline(piece, 'outside');
  return (
    <>
      <Section title={t('inspector.piece')}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t(tpl.nameKey)}</div>
            <div className="text-xs text-muted">
              {t(isMultiPage(piece) ? 'inspector.pageSize' : 'inspector.pieceSize', { w: Math.round(d.w * 10) / 10, h: Math.round(d.h * 10) / 10, n: pageCount(piece) })}<br />{t('print.bleed')}: {bleed} mm
            </div>
          </div>
          {/* What this piece becomes: the names alone rarely say it. */}
          <ProductArt id={piece.templateId} className="h-12 w-16 shrink-0" />
        </div>
        <p className="text-xs leading-relaxed text-muted">{t(`preview.where.${piece.templateId}`)}</p>
        {isMultiPage(piece) && <p className="text-xs text-muted">{t('inspector.bookletHint', { sheets: pageCount(piece) / 4 })}</p>}
      </Section>
      {tpl.presets.length > 0 && (
        <Section title={t('preset.title')}>
          <div className="flex flex-wrap gap-1">
            {tpl.presets.map((p) => {
              const on = Object.entries(p.values).every(([k, v]) => params[k] === v);
              return <button key={p.labelKey} className={`btn btn-sm ${on ? 'border-accent bg-accent-soft text-accent' : ''}`} onClick={() => editor.setPieceParams(piece.id, p.values)}>{t(p.labelKey)}</button>;
            })}
          </div>
        </Section>
      )}
      <Section title={t('inspector.params')}>
        {/* Measurements; the disc holder (tray or pocket) has its own section below. */}
        {tpl.params.filter((p) => !p.choices).map((p) => (
          <Row key={p.key} label={t(p.labelKey)}>
            <NumberField value={params[p.key]} step={p.step} min={p.min} max={p.max} suffix="mm" decimals={p.step < 0.1 ? 2 : 1} onChange={(v) => editor.setPieceParams(piece.id, { [p.key]: v })} ariaLabel={t(p.labelKey)} />
          </Row>
        ))}
        {tpl.params.filter((p) => p.choices && p.key !== 'holder').map((p) => {
          const current = p.choices!.find((c) => c.value === params[p.key]);
          return (
            <div key={p.key} className="space-y-1.5" data-testid={`param-${p.key}`}>
              <div className="label">{t(p.labelKey)}</div>
              <Segmented<number> value={params[p.key]} ariaLabel={t(p.labelKey)} onChange={(v) => editor.setPieceParams(piece.id, choicePatch(tpl, params, p.key, v))}
                options={p.choices!.map((c) => ({ value: c.value, label: t(c.labelKey) }))} />
              {current?.hintKey && <p className="text-[11px] leading-relaxed text-muted">{t(current.hintKey)}</p>}
            </div>
          );
        })}
        {tpl.params.some((p) => p.key === 'thick') && <p className="text-[11px] leading-relaxed text-muted">{t('param.thickHint')}</p>}
        <p className="text-[11px] leading-relaxed text-muted">{t('formats.measureHint')}</p>
        {mine.length > 0 && (
          <div className="space-y-1">
            <div className="label">{t('formats.mine')}</div>
            <div className="flex flex-wrap gap-1">
              {mine.map((f) => {
                const on = Object.entries(f.params).every(([k, v]) => params[k] === v);
                return (
                  <span key={f.id} className={`inline-flex items-center rounded-md border ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line'}`}>
                    <button className="px-2 py-1 text-xs" onClick={() => editor.setPieceParams(piece.id, f.params)} title={t('formats.apply')}>{f.name}</button>
                    <button className="px-1 text-muted hover:text-danger" aria-label={t('formats.delete', { name: f.name })} title={t('formats.delete', { name: f.name })}
                      onClick={() => { if (confirm(t('formats.confirmDelete', { name: f.name }))) void deleteFormat(f.id); }}><Icon name="x" size={12} /></button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <button className="btn btn-sm w-full" data-testid="save-format" onClick={() => {
          const name = prompt(t('formats.namePrompt'), `${t(tpl.nameKey)} ${Math.round(d.w * 10) / 10}×${Math.round(d.h * 10) / 10}`);
          if (name?.trim()) void saveFormat(name.trim(), piece.templateId, Object.fromEntries(tpl.params.map((p) => [p.key, params[p.key]])));
        }}><Icon name="download" size={14} />{t('formats.save')}</button>
      </Section>
      <DiscHolderSection piece={piece} projectName={projectName} />
      <Section title={t('inspector.paper')}>
        <select className="field" value={piece.paper ?? ''} onChange={(e) => editor.setPiecePaper(piece.id, (e.target.value || null) as PaperKind | null)}>
          <option value="">{t('paper.auto')} ({t(`paper.${tpl.paper}`)})</option>
          {(['paper', 'cardstock', 'sticker'] as const).map((k) => <option key={k} value={k}>{t(`paper.${k}`)}</option>)}
        </select>
        <Row label={t('inspector.copies')}>
          <NumberField value={piece.copies} step={1} min={1} max={20} decimals={0} onChange={(v) => editor.setPieceCopies(piece.id, v)} ariaLabel={t('inspector.copies')} />
        </Row>
      </Section>
      <Section title={t('inspector.assembly')}>
        <ol className="space-y-2 text-xs text-muted">
          {assemblyKeysOf(piece.templateId, piece.params).map((k, i) => {
            const h = stepHighlight(k);
            return (
              <li key={k} className="flex items-start gap-2">
                <span className="w-3 shrink-0 text-right font-medium text-ink">{i + 1}.</span>
                <span className="min-w-0 flex-1 leading-relaxed">{t(k)}</span>
                {h !== 'none' && <span className="shrink-0 rounded bg-canvas p-1"><FlatLayout templateId={piece.templateId} params={piece.params} maxW={56} maxH={36} highlight={h} labels={false} /></span>}
              </li>
            );
          })}
        </ol>
      </Section>
    </>
  );
}

export function Inspector() {
  const t = useT();
  const layers = useEditorShallow(selectedLayers);
  const side = useEditor((s) => s.selection.side);
  if (layers.length === 0) return <PieceInspector />;
  if (layers.length > 1) {
    return (
      <div data-testid="multi-inspector">
        <p className="border-b border-line px-3 py-2 text-xs font-medium">{t('inspector.selectedCount', { count: layers.length })}</p>
        <Section title={t('align.title')}><AlignBar layers={layers} /></Section>
        <ActionsSection ids={layers.map((l) => l.id)} />
      </div>
    );
  }
  const layer = layers[0];
  return (
    <div data-testid="layer-inspector">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <input className="field font-medium" value={layer.name} aria-label={t('common.rename')} onChange={(e) => editor.updateLayer(layer.id, { name: e.target.value }, `name:${layer.id}`)} />
        <IconButton icon="x" label={t('common.close')} onClick={() => editor.select([])} />
      </div>
      {/* Pictures and backgrounds show their panel first; other layers further down. */}
      {(layer.type === 'image' || layer.type === 'fill') && <PanelSection layer={layer} side={side} />}
      {layer.type === 'text' && <TextSection layer={layer} />}
      {layer.type === 'image' && <ImageSection layer={layer} />}
      {layer.type === 'fill' && <FillSection layer={layer} />}
      {layer.type === 'shape' && <ShapeSection layer={layer} />}
      {layer.type === 'qr' && <QrSection layer={layer} />}
      <EffectsSection layer={layer} />
      {layer.type !== 'image' && layer.type !== 'fill' && <PanelSection layer={layer} side={side} />}
      <GeometrySection layer={layer} />
      <ActionsSection ids={[layer.id]} />
      <p className="px-3 py-2 text-[11px] text-muted"><Icon name="info" size={12} className="mr-1 inline" />{t('inspector.shortcuts')}</p>
    </div>
  );
}
