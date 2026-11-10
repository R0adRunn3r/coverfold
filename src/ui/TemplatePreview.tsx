// Visual explanations of the templates, since names alone rarely tell what you make:
// the assembled product with the printed piece highlighted, and the flat layout
// drawn from the real dieline.
import { useId, type ReactNode } from 'react';
import type { Path } from '../core/geometry';
import { splitFor } from '../core/expand';
import { estimateSheets } from '../core/kits';
import { DEFAULT_PRINT } from '../core/model';
import { wantedMargin } from '../core/printPlan';
import { buildDieline, getTemplate } from '../core/templates/catalog';
import type { Family } from '../core/templates/types';
import type { StepHighlight } from '../core/assembly';
import { useT } from './hooks';
import { fmtNum } from './numberInput';

// Drawings use the 160 x 120 viewBox of ProductArt.
type Tone = 'base' | 'hl' | 'hole' | 'open';
const TONE: Record<Tone, { fill: string; stroke: string }> = {
  base: { fill: 'var(--color-panel)', stroke: 'var(--color-muted)' },
  hl: { fill: 'var(--color-accent-soft)', stroke: 'var(--color-accent)' },
  hole: { fill: 'var(--color-canvas)', stroke: 'var(--color-muted)' },
  open: { fill: 'var(--color-subtle)', stroke: 'var(--color-muted)' },
};
type Pt = [number, number];

const Poly = ({ pts, tone = 'base', dash }: { pts: Pt[]; tone?: Tone; dash?: boolean }) => (
  <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={TONE[tone].fill} stroke={TONE[tone].stroke} strokeWidth={1.3} strokeLinejoin="round" strokeDasharray={dash ? '3 2.5' : undefined} />
);
const Rect = ({ x, y, w, h, tone = 'base', r = 1 }: { x: number; y: number; w: number; h: number; tone?: Tone; r?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={r} fill={TONE[tone].fill} stroke={TONE[tone].stroke} strokeWidth={1.3} />
);
/** Text-like strokes on a cover, so a surface reads as "printed". */
const Lines = ({ x, y, w, n = 2, tone = 'hl' }: { x: number; y: number; w: number; n?: number; tone?: Tone }) => (
  <g stroke={TONE[tone].stroke} strokeWidth={1.6} strokeLinecap="round" opacity={0.7}>
    {Array.from({ length: n }, (_, i) => <line key={i} x1={x} y1={y + i * 5} x2={x + w * (i === 0 ? 1 : 0.6)} y2={y + i * 5} />)}
  </g>
);

/** A box in oblique view: front, top and left (or right) side, each with its own tone. */
function Slab({ x, y, w, h, d, dir = 'left', front = 'base', top = 'base', side = 'base', children }: {
  x: number; y: number; w: number; h: number; d: number; dir?: 'left' | 'right';
  front?: Tone; top?: Tone; side?: Tone; children?: ReactNode;
}) {
  const dx = (dir === 'left' ? -1 : 1) * d * 0.6, dy = -d * 0.45;
  const sx = dir === 'left' ? x : x + w;
  return (
    <g>
      <Poly tone={top} pts={[[x, y], [x + w, y], [x + w + dx, y + dy], [x + dx, y + dy]]} />
      <Poly tone={side} pts={[[sx, y], [sx + dx, y + dy], [sx + dx, y + h + dy], [sx, y + h]]} />
      <Rect x={x} y={y} w={w} h={h} tone={front} r={0.5} />
      {children}
    </g>
  );
}

function Disc({ cx, cy, r, tone = 'base' }: { cx: number; cy: number; r: number; tone?: Tone }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={TONE[tone].fill} stroke={TONE[tone].stroke} strokeWidth={1.3} />
      <circle cx={cx} cy={cy} r={r * 0.36} fill="none" stroke={TONE[tone].stroke} strokeWidth={0.8} opacity={0.6} />
      <circle cx={cx} cy={cy} r={r * 0.13} fill={TONE.hole.fill} stroke={TONE[tone].stroke} strokeWidth={1} />
      <path d={`M ${cx - r * 0.7} ${cy - r * 0.35} A ${r * 0.78} ${r * 0.78} 0 0 1 ${cx - r * 0.25} ${cy - r * 0.74}`} fill="none" stroke={TONE[tone].stroke} strokeWidth={1} opacity={0.5} />
    </g>
  );
}

/** Jewel case seen from the front (hinge on the left). */
const JewelCase = ({ cover = 'base', side = 'base', top = 'base', x = 46, y = 30 }: { cover?: Tone; side?: Tone; top?: Tone; x?: number; y?: number }) => (
  <Slab x={x} y={y} w={74} h={66} d={14} front="base" side={side} top={top}>
    <Rect x={x + 6} y={y + 3} w={65} h={60} tone={cover} r={0.5} />
    <line x1={x + 4} y1={y} x2={x + 4} y2={y + 66} stroke="var(--color-muted)" strokeWidth={0.8} />
    {cover === 'hl' && <Lines x={x + 14} y={y + 14} w={34} />}
  </Slab>
);

const OpenBook = ({ stack = 0, staples = false }: { stack?: number; staples?: boolean }) => (
  <g>
    {Array.from({ length: stack }, (_, i) => (
      <g key={i} transform={`translate(0 ${(stack - i) * 2.2})`}>
        <Poly pts={[[22, 42], [80, 34], [80, 96], [22, 102]]} tone="hl" />
        <Poly pts={[[80, 34], [138, 42], [138, 102], [80, 96]]} tone="hl" />
      </g>
    ))}
    <Poly pts={[[22, 42], [80, 34], [80, 96], [22, 102]]} tone="hl" />
    <Poly pts={[[80, 34], [138, 42], [138, 102], [80, 96]]} tone="hl" />
    <Lines x={32} y={52} w={36} n={3} />
    <Lines x={92} y={52} w={36} n={3} />
    {staples && (
      <g fill="var(--color-ink)">
        <rect x={79} y={48} width={2} height={9} rx={0.8} />
        <rect x={79} y={73} width={2} height={9} rx={0.8} />
      </g>
    )}
  </g>
);

/** Keep case (DVD / Blu-ray) with the printed wrap under its clear sleeve. */
const KeepCase = ({ h, band = false, x = 52, y = 14 }: { h: number; band?: boolean; x?: number; y?: number }) => (
  <Slab x={x} y={y} w={64} h={h} d={16} side="hl">
    <Rect x={x + 3} y={y + (band ? 9 : 3)} w={58} h={h - (band ? 12 : 6)} tone="hl" r={0.5} />
    {band && <rect x={x + 3} y={y + 2.5} width={58} height={5} rx={0.5} fill="var(--color-muted)" opacity={0.45} />}
    <Lines x={x + 12} y={y + (band ? 22 : 18)} w={34} />
  </Slab>
);

const ART: Record<string, () => ReactNode> = {
  'jewel.booklet1': () => <JewelCase cover="hl" />,
  'jewel.booklet4': () => <OpenBook />,
  'jewel.bookletN': () => <OpenBook stack={3} staples />,
  'jewel.tray': () => (
    <g>
      <JewelCase cover="hl" side="hl" />
      {/* Seen from the back: the tray card shows through the clear tray. */}
      <circle cx={89} cy={63} r={22} fill="none" stroke="var(--color-accent)" strokeWidth={0.9} strokeDasharray="2.5 2" opacity={0.7} />
      <g transform="translate(16 4)">
        <path d="M 128 22 A 12 12 0 1 1 116 12" fill="none" stroke="var(--color-muted)" strokeWidth={1.3} />
        <path d="M 113 9 L 117 12 L 113 16" fill="none" stroke="var(--color-muted)" strokeWidth={1.3} strokeLinejoin="round" />
      </g>
    </g>
  ),
  'jewel.obi': () => (
    <g>
      <JewelCase />
      <Poly tone="hl" pts={[[46, 30], [60, 30], [51.6, 23.7], [37.6, 23.7]]} />
      <Poly tone="hl" pts={[[46, 30], [37.6, 23.7], [37.6, 89.7], [46, 96]]} />
      <Rect x={46} y={30} w={14} h={66} tone="hl" r={0} />
      <Lines x={49} y={40} w={7} n={4} />
    </g>
  ),
  'jewel.ocard': () => (
    <g>
      <Slab x={44} y={30} w={78} h={68} d={16} front="hl" top="hl" side="open">
        <Lines x={56} y={46} w={40} />
      </Slab>
      {/* The case shows through the open side. */}
      <Poly tone="base" pts={[[44, 33], [36, 27], [36, 89], [44, 95]]} />
    </g>
  ),
  'disc.label': () => <Disc cx={80} cy={60} r={44} tone="hl" />,
  'dvd.wrap': () => <KeepCase h={92} />,
  'bluray.wrap': () => <KeepCase h={76} band y={24} />,
  'sleeve.card': () => (
    <g>
      <Disc cx={104} cy={62} r={34} />
      <Rect x={28} y={24} w={76} h={76} tone="hl" r={0.5} />
      <Lines x={40} y={40} w={40} />
    </g>
  ),
  'sleeve.flap': () => (
    <g>
      {/* The flap open on the right: its rounded tab goes in a slit in the back. */}
      <Rect x={22} y={24} w={76} h={76} tone="hl" r={0.5} />
      <Lines x={34} y={40} w={40} />
      <path d="M 98 24 L 118 29 V 50 H 127 A 4 4 0 0 1 131 54 V 70 A 4 4 0 0 1 127 74 H 118 V 95 L 98 100 Z" fill={TONE.hl.fill} stroke={TONE.hl.stroke} strokeWidth={1.3} strokeLinejoin="round" />
      <line x1={98} y1={24} x2={98} y2={100} stroke={TONE.hl.stroke} strokeWidth={1} strokeDasharray="3 2.5" />
    </g>
  ),
  'sleeve.inner': () => (
    <g>
      <Disc cx={80} cy={40} r={32} />
      <path d="M 42 48 H 70 A 10 10 0 0 0 90 48 H 118 V 110 H 42 Z" fill={TONE.hl.fill} stroke={TONE.hl.stroke} strokeWidth={1.3} strokeLinejoin="round" />
    </g>
  ),
  'sleeve.slipcase': () => (
    <g>
      <Slab x={26} y={32} w={72} h={68} d={14} dir="right" front="hl" top="hl" side="open">
        <Lines x={36} y={48} w={34} />
      </Slab>
      {/* The cardboard sleeve slides out of the open side. */}
      <Rect x={102} y={30} w={42} h={62} tone="base" r={0.5} />
      <Poly tone="open" pts={[[98, 32], [106.4, 25.7], [106.4, 30], [102, 30], [102, 92], [98, 100]]} />
    </g>
  ),
  'digipak.4p': () => (
    <g>
      <Rect x={14} y={30} w={64} h={62} tone="hl" r={0.5} />
      <Rect x={78} y={30} w={5} h={62} tone="hl" r={0} />
      <Rect x={83} y={30} w={64} h={62} tone="hl" r={0.5} />
      <Lines x={24} y={46} w={40} n={3} />
      <Rect x={89} y={35} w={52} h={52} tone="open" r={2} />
      <Disc cx={115} cy={61} r={22} />
    </g>
  ),
};

/** Keep case in a slipcover: a tube open at the top, the case visible inside. */
const Slipcover = ({ h, y }: { h: number; y: number }) => (
  <g>
    <Slab x={52} y={y} w={64} h={h} d={16} front="hl" side="hl" top="open">
      <Lines x={62} y={y + 18} w={34} />
    </Slab>
    <Poly tone="base" pts={[[55, y - 1], [110, y - 1], [104.2, y - 5.6], [49.2, y - 5.6]]} />
  </g>
);

ART['wallet.six'] = () => (
  <g>
    <Rect x={6} y={32} w={47} h={58} tone="hl" r={0.5} />
    <Rect x={53} y={32} w={4} h={58} tone="hl" r={0} />
    <Rect x={57} y={32} w={47} h={58} tone="hl" r={0.5} />
    <Rect x={104} y={33} w={46} h={56} tone="hl" r={0.5} />
    <Lines x={14} y={46} w={30} n={3} />
    <Lines x={112} y={46} w={30} n={3} />
    <Disc cx={80} cy={61} r={19} />
  </g>
);
ART['wallet.pocket'] = () => (
  <g>
    <Disc cx={60} cy={62} r={34} />
    <Poly tone="open" pts={[[50, 28], [58, 20], [114, 20], [122, 28]]} />
    <Poly tone="open" pts={[[122, 28], [130, 36], [130, 88], [122, 96]]} />
    <Poly tone="open" pts={[[50, 96], [58, 104], [114, 104], [122, 96]]} />
    <Rect x={50} y={28} w={72} h={68} tone="hl" r={0} />
  </g>
);
ART['dvd.digipak'] = () => (
  <g>
    <Rect x={18} y={14} w={60} h={92} tone="hl" r={0.5} />
    <Rect x={78} y={14} w={7} h={92} tone="hl" r={0} />
    <Rect x={85} y={14} w={60} h={92} tone="hl" r={0.5} />
    <Lines x={28} y={32} w={38} n={3} />
    <Rect x={90} y={28} w={50} h={64} tone="open" r={2} />
    <Disc cx={115} cy={60} r={22} />
  </g>
);
ART['dvd.slipcover'] = () => <Slipcover h={88} y={20} />;
ART['bluray.slipcover'] = () => <Slipcover h={72} y={30} />;

const KIT_ART: Record<Family, () => ReactNode> = {
  jewel: () => (
    <g>
      <Disc cx={118} cy={56} r={30} tone="hl" />
      <JewelCase cover="hl" x={30} y={32} />
    </g>
  ),
  dvd: () => (
    <g>
      <Disc cx={116} cy={66} r={28} tone="hl" />
      <KeepCase h={92} x={36} />
    </g>
  ),
  bluray: () => (
    <g>
      <Disc cx={116} cy={70} r={28} tone="hl" />
      <KeepCase h={76} band x={36} y={24} />
    </g>
  ),
  sleeve: () => ART['sleeve.card'](),
  digipak: () => (
    <g>
      <Rect x={14} y={30} w={64} h={62} tone="hl" r={0.5} />
      <Rect x={78} y={30} w={5} h={62} tone="hl" r={0} />
      <Rect x={83} y={30} w={64} h={62} tone="hl" r={0.5} />
      <Lines x={24} y={46} w={40} n={3} />
      <Rect x={89} y={35} w={52} h={52} tone="open" r={2} />
      <Disc cx={115} cy={61} r={22} tone="hl" />
    </g>
  ),
  disc: () => ART['disc.label'](),
};

/** Drawing of the assembled product, the printed piece highlighted. `id`: template id or `kit:<family>`. */
export function ProductArt({ id, className = '' }: { id: string; className?: string }) {
  const art = id.startsWith('kit:') ? KIT_ART[id.slice(4) as Family] : ART[id];
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true" data-art={id}>
      {art?.()}
    </svg>
  );
}

const pathD = (p: Path) => p.map((s) => (s.t === 'Z' ? 'Z' : s.t === 'C' ? `C${s.x1} ${s.y1} ${s.x2} ${s.y2} ${s.x} ${s.y}` : `${s.t}${s.x} ${s.y}`)).join(' ');
const mm = (v: number) => fmtNum(v);

/** The piece opened flat as it is printed: cut outline, folds, glue, panel names. */
export function FlatLayout({ templateId, params = {}, maxW = 280, maxH = 170, highlight = 'none', labels = true }: {
  templateId: string; params?: Record<string, number>; maxW?: number; maxH?: number;
  /** Part of the piece an assembly step is about, drawn in colour. */
  highlight?: StepHighlight; labels?: boolean;
}) {
  const t = useT();
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const d = buildDieline(templateId, params);
  const pad = Math.max(d.w, d.h) * 0.03;
  const vw = d.w + 2 * pad, vh = d.h + 2 * pad;
  const k = Math.min(maxW / vw, maxH / vh);
  const px = 1 / k;
  const fs = 10 * px;
  return (
    <svg viewBox={`${-pad} ${-pad} ${vw} ${vh}`} width={vw * k} height={vh * k} className="block" role="img" aria-label={`${mm(d.w)} × ${mm(d.h)} mm`} data-testid="flat-layout">
      <defs>
        <pattern id={hatch} width={4 * px} height={4 * px} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={4 * px} stroke="#8a90a0" strokeWidth={1.2 * px} />
        </pattern>
      </defs>
      <path d={pathD(d.cut)} fill="#ffffff" fillRule="evenodd" />
      {d.panels.filter((p) => p.labelKey === 'panel.hidden').map((p) => <rect key={p.id} x={p.rect.x} y={p.rect.y} width={p.rect.w} height={p.rect.h} fill="#e8eaee" />)}
      {d.glue.map((g, i) => <path key={i} d={pathD(g)} fill={highlight === 'glue' ? '#fcd9a0' : `url(#${hatch})`} stroke={highlight === 'glue' ? '#e08a0b' : 'none'} strokeWidth={px} />)}
      {d.folds.map((f, i) => (
        <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke={highlight === 'folds' ? '#2f6fd3' : '#6b7180'} strokeWidth={(highlight === 'folds' ? 2.2 : 1) * px} strokeDasharray={`${4 * px} ${3 * px}`} />
      ))}
      <path d={pathD(d.cut)} fill="none" stroke={highlight === 'cut' ? '#d92d2d' : '#2a2d34'} strokeWidth={(highlight === 'cut' ? 2.4 : 1.3) * px} fillRule="evenodd" />
      {d.slits?.map((sl, i) => <path key={`slit${i}`} d={pathD(sl)} fill="none" stroke={highlight === 'cut' ? '#d92d2d' : '#2a2d34'} strokeWidth={(highlight === 'cut' ? 2.4 : 1.3) * px} strokeLinecap="round" />)}
      {labels && d.panels.map((p) => {
        if (p.labelKey === 'panel.hidden' || p.shape === 'disc') return null;
        const label = t(p.labelKey, p.labelVars ?? {});
        const need = label.length * fs * 0.56;
        const vertical = need > p.rect.w * 0.9 && p.rect.h > p.rect.w;
        const room = (vertical ? p.rect.h : p.rect.w) * 0.9;
        const size = Math.min(fs, (fs * room) / need);
        if (size < fs * 0.6 || (vertical ? p.rect.w : p.rect.h) < size * 1.2) return null;
        const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2;
        const rot = vertical ? 90 : p.orientation === 180 ? 180 : 0;
        return (
          <text key={p.id} x={cx} y={cy} fontSize={size} fill="#4a4f5c" textAnchor="middle" dominantBaseline="central" fontWeight={500} transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>{label}</text>
        );
      })}
      {labels && d.panels.some((p) => p.shape === 'disc') && <text x={d.w / 2} y={d.h * 0.2} fontSize={fs} fill="#4a4f5c" textAnchor="middle" fontWeight={500}>{t('panel.disc')}</text>}
    </svg>
  );
}

/** What a template makes, where it goes, size, paper and sheets: for choosing pieces. */
export function TemplateDetails({ templateId, compact = false }: { templateId: string; compact?: boolean }) {
  const t = useT();
  const tpl = getTemplate(templateId);
  const d = buildDieline(templateId, {});
  const sheets = estimateSheets([templateId]).sheets;
  const parts = splitFor(d, { printerMargin: DEFAULT_PRINT.printerMargin, margin: wantedMargin(DEFAULT_PRINT), minMargin: DEFAULT_PRINT.bleed })?.length ?? 1;
  const prints = tpl.pages ? t('preview.printsPages') : tpl.sides.includes('inside') ? t('preview.printsBoth') : t('preview.printsOutside');
  const size = tpl.pages ? `${mm(d.w / 2)} × ${mm(d.h)} mm` : `${mm(d.w)} × ${mm(d.h)} mm`;
  return (
    <div className="space-y-3" data-testid="template-details">
      <div>
        <div className="text-sm font-semibold">{t(tpl.nameKey)}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{t(`preview.where.${templateId}`)}</p>
      </div>
      <div className={`grid items-end gap-3 ${compact ? 'grid-cols-[110px_1fr]' : 'grid-cols-[140px_1fr]'}`}>
        <figure className="text-center">
          <ProductArt id={templateId} className="mx-auto w-full" />
          <figcaption className="mt-1 text-[11px] text-muted">{t('preview.assembled')}</figcaption>
        </figure>
        <figure className="flex flex-col items-center">
          <div className="flex min-h-[100px] items-center justify-center rounded-md bg-canvas p-2">
            <FlatLayout templateId={templateId} maxW={compact ? 170 : 220} maxH={compact ? 110 : 140} />
          </div>
          <figcaption className="mt-1 text-[11px] text-muted">{t('preview.flat')}</figcaption>
        </figure>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{t('preview.size')}</dt><dd>{size}{tpl.pages ? `, ${t('preview.pagesRange')}` : ''}</dd>
        <dt className="text-muted">{t('preview.paper')}</dt><dd>{t(`paper.${tpl.paper}`)}</dd>
        <dt className="text-muted">{t('preview.prints')}</dt><dd>{prints}</dd>
        <dt className="text-muted">{t('preview.sheets')}</dt><dd>{t('preview.sheetsValue', { count: sheets })}{parts > 1 ? `, ${t('preview.parts', { count: parts })}` : ''}</dd>
      </dl>
    </div>
  );
}
