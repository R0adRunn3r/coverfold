import { useSyncExternalStore } from 'react';
import type { Piece } from '../../core/model';
import { getTemplate } from '../../core/templates/catalog';
import { trayFor, trayHeight, trayTestPiece, type HubFit } from '../../core/tray';
import { downloadBytes, safeFileName } from '../../engine/render/exportClient';
import { Icon, Row, Segmented } from '../components';
import { editor } from '../editorInstance';
import { useT } from '../hooks';
import { fmtNum } from '../numberInput';

// How tight the hub holds the disc depends on the printer: one setting for all projects.
const KEY = 'coverfold.trayFit';
const listeners = new Set<() => void>();
const readFit = (): HubFit => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'tight' || v === 'loose' ? v : 'normal';
  } catch {
    return 'normal';
  }
};
export const useTrayFit = (): HubFit => useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, readFit);
function setTrayFit(fit: HubFit) {
  try { localStorage.setItem(KEY, fit); } catch { /* storage blocked: default fit */ }
  listeners.forEach((f) => f());
}

/** STL of the tray sized for this piece, or of the small test piece (three.js loads only now). */
export async function downloadTraySTL(piece: Piece, fit: HubFit, name: string, test = false): Promise<void> {
  const tray = test ? trayTestPiece(fit) : trayFor(piece, fit);
  if (!tray) return;
  const { trayGeometry, toSTL } = await import('../../engine/tray3d');
  const g = trayGeometry(tray);
  const bytes = toSTL(g, `Coverfold tray ${tray.w}x${tray.h}`);
  g.dispose();
  downloadBytes(bytes, `${safeFileName(name)}.stl`, 'model/stl');
}

/** 3D-printed disc tray for digipaks and gatefolds: size, fit, height check, STL. */
export function TrayPanel({ piece, projectName }: { piece: Piece; projectName: string }) {
  const t = useT();
  const fit = useTrayFit();
  const tray = trayFor(piece, fit);
  if (!tray) return null;
  const height = trayHeight(tray);
  const params = { ...Object.fromEntries(getTemplate(piece.templateId).params.map((p) => [p.key, p.default])), ...piece.params };
  const room = (params.spine ?? 0) + (params.thick ?? 0);
  const need = Math.ceil((height + 0.3) * 2) / 2;
  const mm = (v: number) => fmtNum(v);
  return (
    <div className="space-y-2" data-testid="tray-panel">
      <p className="text-xs leading-relaxed text-muted">{t('tray.intro', { w: mm(tray.w), h: mm(tray.h), height: mm(height) })}</p>
      <Row label={t('tray.fit')}>
        <Segmented<HubFit> value={fit} onChange={setTrayFit} ariaLabel={t('tray.fit')}
          options={(['loose', 'normal', 'tight'] as HubFit[]).map((f) => ({ value: f, label: t(`tray.fit_${f}`) }))} />
      </Row>
      <p className="text-[11px] leading-relaxed text-muted">{t('tray.fitShort')}</p>
      {room < height + 0.3 && (
        <div className="rounded-md bg-warn-soft p-2 text-xs text-warn">
          {t('tray.spineTooThin', { need: mm(need) })}{' '}
          <button className="underline" onClick={() => editor.setPieceParams(piece.id, { spine: need - (params.thick ?? 0) })}>{t('tray.setSpine')}</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn btn-sm" data-testid="tray-test-stl" title={t('tray.testHint')} onClick={() => void downloadTraySTL(piece, fit, `${t('tray.testName')} - ${t(`tray.fit_${fit}`)}`, true)}>
          <Icon name="download" size={14} />{t('tray.downloadTest')}
        </button>
        <button className="btn btn-sm btn-primary" data-testid="tray-stl" onClick={() => void downloadTraySTL(piece, fit, `${projectName} - ${t('tray.fileName')}`)}>
          <Icon name="download" size={14} />{t('tray.download')}
        </button>
      </div>

      <details className="text-[11px] text-muted" data-testid="tray-howto">
        <summary className="cursor-pointer">{t('tray.howTo')}</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4 leading-relaxed">
          <li>{t('tray.testHint')}</li>
          <li>{t('tray.printTips')}</li>
          <li>{t('tray.usage')}</li>
          <li>{t('tray.fitHint')}</li>
        </ul>
      </details>
    </div>
  );
}
