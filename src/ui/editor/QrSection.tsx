import { useEffect, useState } from 'react';
import { faceDieline } from '../../core/faces';
import { facePanels } from '../../core/layout';
import { makeQrLayer, type QrEcc, type QrLayer } from '../../core/model';
import { QR_MIN_MODULE, QR_MIN_SIZE } from '../../core/qr';
import { denserForLogo, layerQrMatrix, maxLogoSize, qrEcc, qrModule, qrProblem } from '../../core/qrLayer';
import { QR_LOGO_MAX_DAMAGE, QR_LOGO_MAX_SIZE, QR_LOGO_MIN_SIZE, QR_LOGO_TEST_SIZE, footprintCoverage, logoFits, qrLogoPlan } from '../../core/qrLogo';
import { activePiece } from '../../core/store';
import type { PanelDef } from '../../core/templates/types';
import { db } from '../../engine/db';
import { ColorField, Icon, IconButton, Row, Section, Segmented, Slider } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';
import { fmtNum } from '../numberInput';
import { mainPanel, setQrLogo } from './actions';
import { AssetPicker } from './AssetPicker';

const ECCS: QrEcc[] = ['L', 'M', 'Q', 'H'];
const mm = (v: number) => fmtNum(v, 2);

/** Where a new code goes: the back if this face has one (that is where codes usually sit), else the main panel. */
function qrPanel(panels: PanelDef[]): PanelDef {
  return panels.find((p) => p.id === 'back') ?? mainPanel(panels);
}

/** Box for a new code: bottom-right of the panel's safe area, or below the hole on a disc. */
function qrBox(p: PanelDef) {
  if (p.shape === 'disc') {
    const size = 20, cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2;
    return { x: cx - size / 2, y: cy + 22, w: size, h: size };
  }
  const size = Math.max(QR_MIN_SIZE, Math.min(24, (p.rect.w - 2 * p.safe) * 0.4, (p.rect.h - 2 * p.safe) * 0.4));
  return { x: p.rect.x + p.rect.w - p.safe - size, y: p.rect.y + p.rect.h - p.safe - size, w: size, h: size };
}

/** "Text" tab: type an address, get a code on the back (or the main panel). */
export function AddQr() {
  const t = useT();
  const piece = useEditor(activePiece);
  const side = useEditor((s) => s.selection.side);
  const [text, setText] = useState('');
  if (!piece) return null;
  const add = () => {
    const panels = facePanels(faceDieline(piece, side), side);
    const p = qrPanel(panels);
    const layer = makeQrLayer(text.trim(), qrBox(p));
    layer.name = text.trim() ? `QR ${text.trim().replace(/^https?:\/\/(www\.)?/, '').slice(0, 18)}` : 'QR';
    editor.addLayer(layer);
    setText('');
  };
  return (
    <form className="space-y-1.5 rounded-md border border-line p-2" onSubmit={(e) => { e.preventDefault(); add(); }} data-testid="add-qr">
      <div className="flex items-center gap-1.5 text-xs font-medium"><Icon name="qr" size={14} />{t('qr.title')}</div>
      <input className="field text-xs" value={text} placeholder={t('qr.placeholder')} aria-label={t('qr.content')} onChange={(e) => setText(e.target.value)} data-testid="add-qr-text" />
      <button type="submit" className="btn btn-sm w-full" disabled={!text.trim()}>{t('qr.add')}</button>
    </form>
  );
}

/** Small preview of a picture over a checkerboard (transparent parts show). */
function Thumb({ assetId, name }: { assetId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    void db.assets.get(assetId).then((row) => {
      if (!row || !alive) return;
      u = URL.createObjectURL(row.preview);
      setUrl(u);
    });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [assetId]);
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-[repeating-conic-gradient(var(--color-checker)_0_25%,var(--color-panel)_0_50%)] bg-[length:8px_8px]">
      {url && <img src={url} alt={name} className="max-h-full max-w-full object-contain" />}
    </span>
  );
}

/** "Add logo": a picture in the middle of the code, its size, and how much of the code's reserve it uses. */
function QrLogoControls({ layer }: { layer: QrLayer }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const logo = layer.logo;
  const m = layerQrMatrix(layer);
  const plan = logo && m ? qrLogoPlan(m, logo) : null;
  const pick = (a: Parameters<typeof setQrLogo>[1]) => { setPicking(false); void setQrLogo(layer.id, a); };
  const used = plan ? Math.round(plan.damage * 100) : 0;
  const fits = plan ? logoFits(plan) : true;
  // The slider stops at the largest logo a code for this text and size can carry.
  const max = logo ? maxLogoSize(layer, logo) : null;
  const maxPct = max !== null ? Math.round(max * 100) : Math.round(QR_LOGO_MAX_SIZE * 100);
  const pct = logo ? Math.round(logo.size * 100) : 0;
  const atMax = max !== null && max < QR_LOGO_MAX_SIZE && pct >= maxPct - 1;
  const opaque = logo ? footprintCoverage(logo.footprint) > 0.95 : false;
  return (
    <div className="space-y-2" data-testid="qr-logo">
      {logo ? (
        <>
          <Row label={t('qr.logo')}>
            <div className="flex items-center gap-1.5">
              <Thumb assetId={logo.assetId} name={logo.name} />
              <button type="button" className="btn btn-sm min-w-0 flex-1" onClick={() => setPicking(!picking)} aria-expanded={picking} data-testid="qr-logo-change">{t('qr.logoChange')}</button>
              <IconButton icon="trash" label={t('qr.logoRemove')} onClick={() => { setPicking(false); editor.updateLayer(layer.id, { logo: null }); }} />
            </div>
          </Row>
          <Row label={t('qr.logoSize')}>
            <Slider value={pct} min={QR_LOGO_MIN_SIZE * 100} max={Math.max(QR_LOGO_MIN_SIZE * 100, maxPct)} ariaLabel={t('qr.logoSize')} format={(v) => `${v}%`}
              onChange={(v) => editor.updateLayer(layer.id, { logo: { ...logo, size: v / 100 } }, `qr-logo-size:${layer.id}`)} />
          </Row>
          {plan && (
            <div className="space-y-1" data-testid="qr-logo-use">
              {/* Reserve used by the logo; the tick marks the most we allow. */}
              <div className="relative h-1.5 rounded-full bg-subtle" aria-hidden="true">
                <div className={`h-full rounded-full ${fits ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${Math.min(100, used)}%` }} />
                <div className="absolute -top-0.5 h-2.5 w-px bg-muted" style={{ left: `${QR_LOGO_MAX_DAMAGE * 100}%` }} />
              </div>
              {fits ? (
                <>
                  <p className="text-[11px] leading-relaxed text-muted">{t('qr.logoUse', { pct: used, max: Math.round(QR_LOGO_MAX_DAMAGE * 100) })}</p>
                  {atMax && <p className="text-[11px] leading-relaxed text-muted" data-testid="qr-logo-max">{t('qr.logoMax', { max: maxPct })}{opaque && ` ${t('qr.logoOpaqueTip')}`}</p>}
                </>
              ) : (
                // Too big (an older project, or the text or box changed since): one click back to the largest readable size.
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium leading-relaxed text-warn">{t('qr.problem_logoBig')}{opaque && ` ${t('qr.logoOpaqueTip')}`}</p>
                  {max !== null && (
                    <button type="button" className="btn btn-sm w-full" data-testid="qr-logo-shrink"
                      onClick={() => editor.updateLayer(layer.id, { logo: { ...logo, size: max } })}>{t('qr.logoShrink', { max: maxPct })}</button>
                  )}
                </div>
              )}
              {pct > QR_LOGO_TEST_SIZE * 100 && (
                <p className="flex gap-1.5 text-[11px] leading-relaxed text-ink" data-testid="qr-logo-test">
                  <Icon name="info" size={14} className="mt-px shrink-0 text-accent" />{t('qr.logoTest', { pct: Math.round(QR_LOGO_TEST_SIZE * 100) })}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <button type="button" className="btn btn-sm w-full" onClick={() => setPicking(!picking)} aria-expanded={picking} data-testid="qr-logo-add">
          <Icon name="image" size={14} />{t('qr.logoAdd')}
        </button>
      )}
      {picking && (
        <div className="space-y-1">
          <p className="text-[11px] leading-relaxed text-muted">{t('qr.logoHint')}</p>
          <AssetPicker exclude={logo?.assetId} onPick={pick} upload testId="qr-logo-picker" />
        </div>
      )}
    </div>
  );
}

/** Inspector for a QR layer: content, colours, logo, robustness, and whether phones will read it. */
export function QrSection({ layer }: { layer: QrLayer }) {
  const t = useT();
  const set = (patch: Partial<QrLayer>, key?: string) => editor.updateLayer(layer.id, patch, key && `${key}:${layer.id}`);
  const m = layerQrMatrix(layer);
  const mod = qrModule(layer);
  const problem = qrProblem(layer);
  return (
    <Section title={t('qr.title')}>
      <textarea className="field min-h-14 font-mono text-xs" value={layer.text} placeholder={t('qr.placeholder')} aria-label={t('qr.content')} data-testid="qr-text"
        onChange={(e) => set({ text: e.target.value }, 'qr-text')} />
      <Row label={t('qr.color')}><ColorField value={layer.color} onChange={(color) => set({ color })} ariaLabel={t('qr.color')} /></Row>
      <Row label={t('qr.background')}>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!layer.background} onChange={(e) => set({ background: e.target.checked ? '#ffffff' : null })} />{t('qr.backgroundOn')}
          </label>
          {layer.background && <ColorField value={layer.background} onChange={(background) => set({ background })} ariaLabel={t('qr.background')} />}
        </div>
      </Row>
      <QrLogoControls layer={layer} />
      <Row label={t('qr.ecc')}>
        <Segmented<QrEcc> value={qrEcc(layer)} onChange={(ecc) => set({ ecc })} ariaLabel={t('qr.ecc')} disabled={!!layer.logo}
          options={ECCS.map((e) => ({ value: e, label: t(`qr.ecc_${e}`), title: t(`qr.eccTitle_${e}`) }))} />
      </Row>
      <p className="text-[11px] leading-relaxed text-muted">{t(layer.logo ? 'qr.logoEcc' : 'qr.eccHint')}</p>
      {problem ? (
        <div className="rounded-md bg-warn-soft p-2 text-xs text-warn" data-testid="qr-problem">
          {t(`qr.problem_${problem}`, { min: QR_MIN_SIZE, mod: fmtNum(QR_MIN_MODULE, 2) })}
        </div>
      ) : m && mod !== null && (
        <div className="rounded-md bg-ok-soft p-2 text-xs text-ok" data-testid="qr-ok">{t(denserForLogo(layer) ? 'qr.okDenser' : 'qr.ok', { n: m.size, mod: mm(mod) })}</div>
      )}
      <p className="text-[11px] leading-relaxed text-muted">{t('qr.testHint')}</p>
    </Section>
  );
}
