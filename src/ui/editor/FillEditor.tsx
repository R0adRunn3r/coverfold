import type { Gradient } from '../../core/model';
import { ColorField, Icon, Row, Segmented, Slider } from '../components';
import { useT } from '../hooks';

export interface FillValue { color: string; gradient: Gradient | null }
type Mode = 'solid' | 'linear' | 'radial';

/** CSS for a small preview of the same fill (canvas angle 0 = left to right, CSS 90deg = to right). */
export function fillCss(v: FillValue): string {
  const g = v.gradient;
  if (!g) return v.color;
  return g.kind === 'radial' ? `radial-gradient(circle, ${g.from}, ${g.to})` : `linear-gradient(${g.angle + 90}deg, ${g.from}, ${g.to})`;
}

/** Ready-made gradients: pleasant pairs, plus a transparent shade to make text readable over a photo. */
export const GRADIENT_PRESETS: Gradient[] = [
  { kind: 'linear', from: '#1d1b3a', to: '#6b21a8', angle: 90 },
  { kind: 'linear', from: '#203a63', to: '#2f5bd3', angle: 90 },
  { kind: 'linear', from: '#0f766e', to: '#84cc16', angle: 45 },
  { kind: 'linear', from: '#c53030', to: '#f59e0b', angle: 45 },
  { kind: 'linear', from: '#9d174d', to: '#f9a8d4', angle: 135 },
  { kind: 'linear', from: '#111111', to: '#4b5563', angle: 90 },
  { kind: 'linear', from: '#f4efe6', to: '#c9c3b6', angle: 90 },
  { kind: 'radial', from: '#2f5bd3', to: '#0b1020', angle: 0 },
  { kind: 'radial', from: 'rgba(0,0,0,0)', to: 'rgba(0,0,0,0.7)', angle: 0 },
  { kind: 'linear', from: 'rgba(0,0,0,0)', to: 'rgba(0,0,0,0.75)', angle: 90 },
];

/** Plain colour or two-colour gradient (linear with an angle, or radial). */
export function FillEditor({ value, onChange }: { value: FillValue; onChange: (v: FillValue) => void }) {
  const t = useT();
  const g = value.gradient;
  const mode: Mode = g ? g.kind : 'solid';
  const setMode = (m: Mode) => {
    if (m === 'solid') onChange({ color: g?.from ?? value.color, gradient: null });
    else onChange({ color: value.color, gradient: { kind: m, from: g?.from ?? value.color, to: g?.to ?? '#ffffff', angle: g?.angle ?? 90 } });
  };
  const setG = (patch: Partial<Gradient>) => g && onChange({ color: patch.from ?? value.color, gradient: { ...g, ...patch } });
  return (
    <div className="space-y-2" data-testid="fill-editor">
      <Segmented<Mode> value={mode} onChange={setMode} ariaLabel={t('fill.kind')}
        options={[{ value: 'solid', label: t('fill.solid') }, { value: 'linear', label: t('fill.linear') }, { value: 'radial', label: t('fill.radial') }]} />
      {!g && <ColorField value={value.color} onChange={(color) => onChange({ color, gradient: null })} ariaLabel={t('fill.solid')} />}
      {g && (
        <>
          <div className="h-6 rounded border border-line" style={{ background: `${fillCss(value)}, repeating-conic-gradient(var(--color-checker) 0 25%, var(--color-panel) 0 50%) 0 0 / 10px 10px` }} aria-hidden="true" />
          <Row label={t('fill.from')}><ColorField value={g.from} onChange={(from) => setG({ from })} ariaLabel={t('fill.from')} withAlpha /></Row>
          <Row label={t('fill.to')}><ColorField value={g.to} onChange={(to) => setG({ to })} ariaLabel={t('fill.to')} withAlpha /></Row>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => setG({ from: g.to, to: g.from })}><Icon name="rotate" size={14} />{t('fill.swap')}</button>
            {g.kind === 'linear' && (
              <div className="min-w-0 flex-1">
                <Slider value={g.angle} min={0} max={345} step={15} onChange={(angle) => setG({ angle })} format={(v) => `${v}°`} ariaLabel={t('fill.angle')} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
