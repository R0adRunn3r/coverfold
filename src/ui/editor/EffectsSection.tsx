import type { ReactNode } from 'react';
import { luminance } from '../../core/color';
import { BLEND_MODES, DEFAULT_OUTLINE, DEFAULT_SHADOW, type BlendMode, type Layer, type Shadow } from '../../core/model';
import { ColorField, Row, Section, Slider } from '../components';
import { editor } from '../editorInstance';
import { useT } from '../hooks';

/** 3 x 3 direction pad: angle of each cell (y down: 90 = down), null = glow all round. */
const DIRECTIONS: { angle: number | null; arrow: string }[] = [
  { angle: 225, arrow: '↖' }, { angle: 270, arrow: '↑' }, { angle: 315, arrow: '↗' },
  { angle: 180, arrow: '←' }, { angle: null, arrow: '●' }, { angle: 0, arrow: '→' },
  { angle: 135, arrow: '↙' }, { angle: 90, arrow: '↓' }, { angle: 45, arrow: '↘' },
];

const angleGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (on: boolean) => void; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />{label}
    </label>
  );
}

/** Indented controls under an effect's checkbox. */
const Sub = ({ children }: { children: ReactNode }) => <div className="space-y-2 border-l-2 border-line pl-2.5">{children}</div>;

function ShadowControls({ shadow, onChange }: { shadow: Shadow; onChange: (s: Shadow, key?: string) => void }) {
  const t = useT();
  const glow = shadow.distance === 0;
  const current = glow ? null : DIRECTIONS.filter((d) => d.angle !== null).reduce((a, b) => (angleGap(a.angle!, shadow.angle) <= angleGap(b.angle!, shadow.angle) ? a : b)).angle;
  return (
    <Sub>
      <Row label={t('effects.direction')}>
        <div className="grid w-fit grid-cols-3 gap-0.5" role="group" aria-label={t('effects.direction')}>
          {DIRECTIONS.map((d) => {
            const on = d.angle === current;
            const label = d.angle === null ? t('effects.glow') : `${t('effects.direction')} ${d.arrow}`;
            return (
              <button key={d.arrow} type="button" title={label} aria-label={label} aria-pressed={on} data-testid={`shadow-dir-${d.angle ?? 'glow'}`}
                className={`grid h-6 w-6 place-items-center rounded border text-xs leading-none ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-hover'}`}
                onClick={() => onChange(d.angle === null
                  ? { ...shadow, distance: 0, blur: Math.max(shadow.blur, 1.2) }
                  : { ...shadow, angle: d.angle, distance: shadow.distance || DEFAULT_SHADOW.distance })}>
                {d.angle === null ? <span className="text-[8px]">●</span> : d.arrow}
              </button>
            );
          })}
        </div>
      </Row>
      {!glow && (
        <Row label={t('effects.distance')}>
          <Slider value={shadow.distance} min={0.1} max={5} step={0.1} onChange={(distance) => onChange({ ...shadow, distance }, 'distance')} format={(v) => `${v.toFixed(1)} mm`} ariaLabel={t('effects.distance')} />
        </Row>
      )}
      <Row label={t('effects.softness')}>
        <Slider value={shadow.blur} min={0} max={5} step={0.1} onChange={(blur) => onChange({ ...shadow, blur }, 'blur')} format={(v) => `${v.toFixed(1)} mm`} ariaLabel={t('effects.softness')} />
      </Row>
      <Row label={t('inspector.color')}>
        <ColorField value={shadow.color} withAlpha onChange={(color) => onChange({ ...shadow, color }, 'color')} ariaLabel={t('effects.shadowColor')} />
      </Row>
    </Sub>
  );
}

/** Outline (text), shadow or glow, and blend mode: the effects shared by every layer type. */
export function EffectsSection({ layer }: { layer: Layer }) {
  const t = useT();
  const set = (patch: Partial<Layer>, key?: string) => editor.updateLayer(layer.id, patch, key && `${key}:${layer.id}`);
  const outline = layer.type === 'text' ? layer.outline ?? null : null;
  const shadow = layer.shadow ?? null;
  const blend = layer.blend ?? 'normal';
  // A light outline around dark letters and the other way round.
  const outlineColor = layer.type === 'text' && (luminance(layer.color) ?? 0) > 0.5 ? '#111111' : DEFAULT_OUTLINE.color;
  return (
    <Section title={t('effects.title')}>
      {layer.type === 'text' && (
        <>
          <Toggle label={t('effects.outline')} checked={!!outline} testId="effect-outline"
            onChange={(on) => set({ outline: on ? { ...DEFAULT_OUTLINE, color: outlineColor } : null })} />
          {outline && (
            <Sub>
              <Row label={t('effects.width')}>
                <Slider value={outline.width} min={0.1} max={2} step={0.05} onChange={(width) => set({ outline: { ...outline, width } }, 'outline-w')} format={(v) => `${v.toFixed(2)} mm`} ariaLabel={t('effects.width')} />
              </Row>
              <Row label={t('inspector.color')}>
                <ColorField value={outline.color} onChange={(color) => set({ outline: { ...outline, color } }, 'outline-c')} ariaLabel={t('effects.outlineColor')} />
              </Row>
            </Sub>
          )}
        </>
      )}
      {/* A background fill covers the piece: its shadow would never show. */}
      {layer.type !== 'fill' && (
        <>
          <Toggle label={t('effects.shadow')} checked={!!shadow} testId="effect-shadow" onChange={(on) => set({ shadow: on ? { ...DEFAULT_SHADOW } : null })} />
          {shadow && <ShadowControls shadow={shadow} onChange={(s, key) => set({ shadow: s }, key && `shadow-${key}`)} />}
        </>
      )}
      <Row label={t('effects.blend')}>
        <select className="field" value={blend} data-testid="effect-blend" onChange={(e) => set({ blend: e.target.value as BlendMode })}>
          {BLEND_MODES.map((m) => <option key={m} value={m}>{t(`effects.blend_${m}`)}</option>)}
        </select>
      </Row>
      {blend !== 'normal' && <p className="text-[11px] leading-relaxed text-muted">{t('effects.blendHint')}</p>}
      {layer.type === 'text' && (outline || shadow || blend !== 'normal') && <p className="text-[11px] leading-relaxed text-muted">{t('effects.rasterNote')}</p>}
    </Section>
  );
}
