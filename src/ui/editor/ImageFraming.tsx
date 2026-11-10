import { aspectPatch, circlePatch, cropControls, cropFor, MAX_ZOOM } from '../../core/crop';
import type { ImageLayer } from '../../core/model';
import { Row, Section, Segmented, Slider } from '../components';
import { editor } from '../editorInstance';
import { useT } from '../hooks';

type ShapeChoice = 'full' | 'circle' | 'rounded';

/** Proportions offered for the crop (width / height). */
const RATIOS: { id: string; value: number }[] = [
  { id: '1:1', value: 1 }, { id: '4:3', value: 4 / 3 }, { id: '3:4', value: 3 / 4 }, { id: '3:2', value: 3 / 2 },
  { id: '2:3', value: 2 / 3 }, { id: '16:9', value: 16 / 9 }, { id: '9:16', value: 9 / 16 },
];

/** Which proportions the box has now: the whole picture, a preset, or free (cropped by hand). */
function currentRatio(layer: ImageLayer): string {
  const c = layer.crop;
  if (!c || (c.w > 0.999 && c.h > 0.999)) return 'original';
  const r = layer.w / layer.h;
  return RATIOS.find((x) => Math.abs(x.value / r - 1) < 0.01)?.id ?? 'free';
}

/**
 * Shape of a picture and its framing: zoom and pan choose which part of the photo
 * shows in the box, so a landscape photo can become a circle without being squashed.
 */
export function ImageFraming({ layer }: { layer: ImageLayer }) {
  const t = useT();
  const set = (patch: Partial<ImageLayer>, key?: string) => editor.updateLayer(layer.id, patch, key && `${key}:${layer.id}`);
  const shape: ShapeChoice = !layer.mask ? 'full' : layer.mask.shape === 'ellipse' ? 'circle' : 'rounded';
  const c = cropControls(layer);
  // Pan follows what you see: a mirrored picture moves the other way in its own pixels.
  const fx = layer.flipX ? -1 : 1, fy = layer.flipY ? -1 : 1;
  const reframe = (zoom: number, panX: number, panY: number, key: string) =>
    set({ crop: cropFor(layer.w / layer.h, layer.naturalW / layer.naturalH, zoom, panX, panY) }, key);
  const maxRadius = Math.max(0.5, Math.floor(Math.min(layer.w, layer.h) / 2 * 2) / 2);
  const framed = !!layer.crop && (Math.abs(c.zoom - 1) > 1e-3 || Math.abs(c.panX) > 1e-3 || Math.abs(c.panY) > 1e-3);

  const ratio = currentRatio(layer);
  const pickRatio = (id: string) => {
    if (id === 'free') return;
    set(aspectPatch(layer, id === 'original' ? null : RATIOS.find((x) => x.id === id)!.value));
  };

  const pickShape = (s: ShapeChoice) => {
    if (s === 'full') set({ mask: null });
    else if (s === 'circle') set(circlePatch(layer));
    else set({ mask: { shape: 'rounded', radius: Math.max(1, Math.round(Math.min(layer.w, layer.h) * 0.12)) } });
  };

  return (
    <Section title={t('framing.title')}>
      <Row label={t('framing.shape')}>
        <Segmented<ShapeChoice> value={shape} onChange={pickShape} ariaLabel={t('framing.shape')}
          options={[
            { value: 'full', label: t('framing.full') },
            { value: 'circle', label: t('framing.circle'), title: t('framing.circleHint') },
            { value: 'rounded', label: t('framing.rounded') },
          ]} />
      </Row>
      {shape === 'circle' && <p className="text-[11px] leading-relaxed text-muted">{t('framing.circleHint')}</p>}
      {shape !== 'circle' && (
        <Row label={t('framing.ratio')}>
          <select className="field" value={ratio} onChange={(e) => pickRatio(e.target.value)} aria-label={t('framing.ratio')} data-testid="crop-ratio">
            {ratio === 'free' && <option value="free">{t('framing.ratioFree')}</option>}
            <option value="original">{t('framing.ratioOriginal')}</option>
            {RATIOS.map((x) => <option key={x.id} value={x.id}>{t(`framing.ratio_${x.id.replace(':', 'x')}`)}</option>)}
          </select>
        </Row>
      )}
      {layer.mask?.shape === 'rounded' && (
        <Row label={t('inspector.cornerRadius')}>
          <Slider value={Math.min(layer.mask.radius, maxRadius)} min={0.5} max={maxRadius} step={0.5} ariaLabel={t('inspector.cornerRadius')}
            onChange={(radius) => set({ mask: { shape: 'rounded', radius } }, 'mask-r')} format={(v) => `${v} mm`} />
        </Row>
      )}
      <Row label={t('framing.zoom')}>
        <Slider value={Math.round(c.zoom * 100)} min={100} max={MAX_ZOOM * 100} step={5} ariaLabel={t('framing.zoom')}
          onChange={(v) => reframe(v / 100, c.panX, c.panY, 'zoom')} format={(v) => `${v}%`} />
      </Row>
      <Row label={t('framing.panX')}>
        <fieldset disabled={!c.canPanX} className={c.canPanX ? '' : 'opacity-50'} title={c.canPanX ? undefined : t('framing.noRoom')}>
          <Slider value={Math.round(fx * c.panX * 100)} min={-100} max={100} step={1} ariaLabel={t('framing.panX')}
            onChange={(v) => reframe(c.zoom, (fx * v) / 100, c.panY, 'pan-x')} format={(v) => `${v > 0 ? '+' : ''}${v}`} />
        </fieldset>
      </Row>
      <Row label={t('framing.panY')}>
        <fieldset disabled={!c.canPanY} className={c.canPanY ? '' : 'opacity-50'} title={c.canPanY ? undefined : t('framing.noRoom')}>
          <Slider value={Math.round(fy * c.panY * 100)} min={-100} max={100} step={1} ariaLabel={t('framing.panY')}
            onChange={(v) => reframe(c.zoom, c.panX, (fy * v) / 100, 'pan-y')} format={(v) => `${v > 0 ? '+' : ''}${v}`} />
        </fieldset>
      </Row>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-muted">{t('framing.hint')}</p>
        {framed && <button className="btn btn-sm shrink-0" onClick={() => reframe(1, 0, 0, 'reset')} data-testid="framing-reset">{t('common.reset')}</button>}
      </div>
    </Section>
  );
}
