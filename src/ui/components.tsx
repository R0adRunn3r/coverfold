import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatColor, parseColor } from '../core/color';
import { useT } from './hooks';
import { parseTyped, settle, stepDecimals, unitOf } from './numberInput';

const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 000 11H13',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4 M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6 M9.9 9.9a3 3 0 004.2 4.2',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 018 0v4',
  unlock: 'M6 11h12v10H6z M8 11V7a4 4 0 017.5-2',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15 9.5a1.5 1.5 0 100-.01',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  square: 'M5 5h14v14H5z',
  circle: 'M12 4a8 8 0 100 16 8 8 0 000-16z',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  printer: 'M7 9V3h10v6 M7 17H4v-7h16v7h-3 M7 14h10v7H7z',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  top: 'M6 11l6-6 6 6 M6 19l6-6 6 6',
  bottom: 'M6 5l6 6 6-6 M6 13l6 6 6-6',
  flipH: 'M12 3v18 M8 7l-5 5 5 5z M16 7l5 5-5 5z',
  flipV: 'M3 12h18 M7 8l5-5 5 5z M7 16l5 5 5-5z',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4',
  grid: 'M4 4h16v16H4z M4 12h16 M12 4v16',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17v.5',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  rotate: 'M20 12a8 8 0 11-2.3-5.6 M20 4v5h-5',
  fill: 'M4 4h16v16H4z M4 4l16 16',
  disc: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 10a2 2 0 100 4 2 2 0 000-4z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  info: 'M12 4a8 8 0 100 16 8 8 0 000-16z M12 11v5 M12 8v.5',
  fold: 'M3 6h8v12H3z M11 6l10-2v12l-10 2',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M16 16l4.5 4.5 M8 11h6 M11 8v6',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  cube: 'M12 2l9 5v10l-9 5-9-5V7z M12 12l9-5 M12 12v10 M12 12L3 7',
  play: 'M7 4l13 8-13 8z',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2.5v2.5H14z M17.5 17.5H20V20h-2.5z M14 20h2 M20 14v2',
  alignLeft: 'M4 3v18 M8 7h12v4H8z M8 13h7v4H8z',
  textLeft: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10',
  coffee: 'M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5z M16 10h1.5a2.5 2.5 0 010 5H16 M8 3v3 M12 3v3',
  textCenter: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10',
  textRight: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10',
  alignHCenter: 'M12 3v18 M5 7h14v4H5z M8 13h8v4H8z',
  alignRight: 'M20 3v18 M4 7h12v4H4z M9 13h7v4H9z',
  alignTop: 'M3 4h18 M7 8h4v12H7z M13 8h4v7h-4z',
  alignVCenter: 'M3 12h18 M7 5h4v14H7z M13 8h4v8h-4z',
  alignBottom: 'M3 20h18 M7 4h4v12H7z M13 9h4v7h-4z',
  eyedropper: 'M18.4 3.6a2 2 0 012.9 2.9L17.8 10l1 1-1.4 1.4-5.8-5.8L13 5.2l1 1z M12.6 8.4L5 16v3h3l7.6-7.6',
  effects: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The GitHub mark (Octicons, MIT). */
export function GitHubMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

export function IconButton({ icon, label, onClick, active = false, disabled = false, className = '' }: {
  icon: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <button type="button" className={`btn btn-ghost btn-icon ${active ? 'bg-accent-soft text-accent' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel, disabled = false, 'data-testid': testId }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; ariaLabel?: string; disabled?: boolean; 'data-testid'?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel} data-testid={testId}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Numeric field that commits on blur/Enter and supports arrow keys (Shift = x10). */
export function NumberField({ value, onChange, step = 0.5, min, max, suffix, width = 'w-full', ariaLabel, decimals = 1 }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; width?: string; ariaLabel?: string; decimals?: number;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** decimals) / 10 ** decimals) : '');
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = parseTyped(raw);
    if (v !== null) onChange(clamp(v));
    else setText(fmt(value));
  };
  return (
    <label className={`relative flex items-center ${width}`}>
      <input
        className="field pr-7 tabular-nums"
        value={text}
        aria-label={ariaLabel}
        inputMode="decimal"
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = clamp(Math.round((value + delta) * 1000) / 1000);
            setText(fmt(next));
            onChange(next);
          }
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 text-[11px] text-muted">{suffix}</span>}
    </label>
  );
}

interface SliderProps {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; ariaLabel?: string; format?: (v: number) => string;
}

/**
 * The value beside a slider; a click turns it into a field for an exact value.
 * Enter or blur applies, Esc cancels, arrows move one step (ten with Shift).
 */
function SliderValue({ value, min, max, step = 1, onChange, ariaLabel, format }: SliderProps) {
  const t = useT();
  const shown = format ? format(value) : String(value);
  const unit = unitOf(shown);
  const k = 10 ** stepDecimals(step);
  const plain = (v: number) => String(Math.round(v * k) / k);
  const [text, setText] = useState<string | null>(null);
  const done = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    // After Enter or Esc, keyboard users stay on the value.
    if (text === null && refocus.current) { refocus.current = false; button.current?.focus(); }
  }, [text]);
  const finish = (apply: boolean, keyboard: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = apply && text !== null ? parseTyped(text) : null;
    if (v !== null) {
      const next = settle(v, min, max, step);
      if (next !== value) onChange(next);
    }
    refocus.current = keyboard;
    setText(null);
  };
  if (text === null) {
    return (
      <button ref={button} type="button" className="slider-value" data-testid="slider-value"
        title={t('common.typeValue')} aria-label={t('common.typeValueAria', { what: ariaLabel ?? '', value: shown })}
        onClick={() => { done.current = false; setText(plain(value)); }}>{shown}</button>
    );
  }
  return (
    <span className="flex w-full items-center gap-0.5">
      <input className="field h-6 min-w-0 flex-1 px-1 py-0 text-right text-xs tabular-nums" value={text} inputMode="decimal" autoFocus
        aria-label={ariaLabel} title={t('common.typeRange', { min: plain(min), max: plain(max) })} data-testid="slider-input"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true, false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = settle((parseTyped(text) ?? value) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max, step);
            setText(plain(next));
            onChange(next);
          }
        }} />
      {unit && <span className="shrink-0 text-[11px] text-muted">{unit}</span>}
    </span>
  );
}

export function Slider(props: SliderProps) {
  const { value, min, max, step = 1, onChange, ariaLabel } = props;
  return (
    <div className="flex items-center gap-2">
      <input type="range" className="min-w-0 flex-1" min={min} max={max} step={step} value={value} aria-label={ariaLabel} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="flex w-14 shrink-0 justify-end"><SliderValue {...props} /></span>
    </div>
  );
}

export { parseColor, formatColor } from '../core/color';

const CHECKER = 'repeating-conic-gradient(var(--color-checker) 0 25%, var(--color-panel) 0 50%) 0 0 / 8px 8px';

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
/** Screen colour picker (Chrome, Edge); undefined where the browser lacks it. */
const EyeDropperApi = typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;

/**
 * Colour picker + text field. `withAlpha` adds an opacity slider so fades need
 * no rgba() typing. Where supported, a pipette picks from the screen and keeps the opacity.
 */
export function ColorField({ value, onChange, ariaLabel, withAlpha = false }: { value: string; onChange: (v: string) => void; ariaLabel?: string; withAlpha?: boolean }) {
  const t = useT();
  const parsed = parseColor(value) ?? { hex: '#000000', a: 1 };
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  const pick = async () => {
    if (!EyeDropperApi) return;
    try {
      const { sRGBHex } = await new EyeDropperApi().open();
      const c = parseColor(sRGBHex);
      if (c) onChange(formatColor(c.hex, parsed.a));
    } catch {
      /* Esc or cancelled: keep the colour */
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className="relative h-8 w-10 shrink-0 cursor-pointer overflow-hidden rounded border border-line" style={{ background: CHECKER }} title={ariaLabel}>
          <span className="absolute inset-0" style={{ background: value }} />
          <input type="color" value={parsed.hex} aria-label={ariaLabel} onChange={(e) => onChange(formatColor(e.target.value, parsed.a))} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <input className="field min-w-0 font-mono text-xs" value={text} aria-label={ariaLabel} onChange={(e) => setText(e.target.value)} onBlur={() => (parseColor(text) ? onChange(text) : setText(value))}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {EyeDropperApi && (
          <button type="button" className="btn btn-ghost btn-icon shrink-0" title={t('color.pick')} aria-label={t('color.pick')} data-testid="eyedropper" onClick={() => void pick()}>
            <Icon name="eyedropper" size={15} />
          </button>
        )}
      </div>
      {withAlpha && (
        <Slider value={Math.round(parsed.a * 100)} min={0} max={100} step={5} onChange={(v) => onChange(formatColor(parsed.hex, v / 100))} format={(v) => `${v}%`} ariaLabel={ariaLabel} />
      )}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center justify-between"><h3 className="label">{title}</h3>{right}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Modal({ children, onClose, labelledBy, wide = false }: { children: ReactNode; onClose: () => void; labelledBy?: string; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`card flex max-h-full w-full flex-col overflow-hidden shadow-xl ${wide ? 'max-w-6xl' : 'max-w-lg'}`}>{children}</div>
    </div>
  );
}

/** Busy indicator; the text beside it says what is happening. */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:[animation-duration:2.5s] ${className}`} style={{ width: size, height: size }} />;
}

/** Progress bar: a share from 0 to 1, or null when the total is unknown (a sweeping bar). */
export function ProgressBar({ value, label }: { value: number | null; label?: string }) {
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      {value === null
        ? <div className="progress-sweep absolute inset-y-0 w-1/3 rounded-full bg-accent" />
        : <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

export const formatBytes = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
