import { holderOf, holderPanel, pocketFits, pocketFor, pocketSize, POCKET_ID, projectPocket, type Holder } from '../../core/discHolder';
import type { Piece } from '../../core/model';
import { HOLDER_POCKET, HOLDER_TRAY } from '../../core/templates/catalog';
import { Section, Segmented } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';
import { fmtNum } from '../numberInput';
import { TrayPanel } from './TrayPanel';

const mm = (v: number) => fmtNum(v);

/** The paper pocket: it is a piece of its own, glued on the same inside panel. */
function PocketPanel({ piece }: { piece: Piece }) {
  const t = useT();
  const pocket = useEditor((s) => (s.project ? projectPocket(s.project) : null));
  const panel = holderPanel(piece);
  if (!panel) return null;
  const best = pocketFor(panel);
  const room = { pw: mm(panel.rect.w), ph: mm(panel.rect.h) };
  const size = pocket ? pocketSize(pocket) : null;
  return (
    <div className="space-y-2" data-testid="pocket-panel">
      <p className="text-xs leading-relaxed text-muted">{t('holder.pocketIntro')}</p>
      {!pocket && best && (
        <button className="btn btn-sm w-full" data-testid="pocket-add"
          onClick={() => editor.addPiece(POCKET_ID, { pw: best.w, h: best.h }, false)}>
          {t('holder.pocketAdd', { w: mm(best.w), h: mm(best.h) })}
        </button>
      )}
      {!pocket && !best && <p className="rounded-md bg-warn-soft p-2 text-xs text-warn">{t('holder.pocketNoRoom', room)}</p>}
      {pocket && size && (pocketFits(size, panel)
        ? <p className="rounded-md bg-ok-soft p-2 text-xs text-ok" data-testid="pocket-ok">{t('holder.pocketOk', { w: mm(size.w), h: mm(size.h), ...room })}</p>
        : (
          <div className="space-y-1.5 rounded-md bg-warn-soft p-2 text-xs text-warn" data-testid="pocket-big">
            <p>{t(best ? 'holder.pocketBig' : 'holder.pocketNoRoom', { w: mm(size.w), h: mm(size.h), ...room })}</p>
            {best && (
              <button className="btn btn-sm w-full" data-testid="pocket-fit" onClick={() => editor.setPieceParams(pocket.id, { pw: best.w, h: best.h })}>
                {t('holder.pocketFit', { w: mm(best.w), h: mm(best.h) })}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

/** What holds the disc in a digipak or wallet: a tray (STL to print) or a paper pocket. */
export function DiscHolderSection({ piece, projectName }: { piece: Piece; projectName: string }) {
  const t = useT();
  const holder = holderOf(piece);
  if (!holder) return null;
  return (
    <Section title={t('holder.title')}>
      <div data-testid="disc-holder">
        <Segmented<Holder> value={holder} ariaLabel={t('holder.title')}
          onChange={(h) => editor.setPieceParams(piece.id, { holder: h === 'pocket' ? HOLDER_POCKET : HOLDER_TRAY })}
          options={[{ value: 'tray', label: t('holder.tray'), title: t('holder.trayHint') }, { value: 'pocket', label: t('holder.pocket'), title: t('holder.pocketHint') }]} />
      </div>
      {holder === 'tray' ? <TrayPanel piece={piece} projectName={projectName} /> : <PocketPanel piece={piece} />}
    </Section>
  );
}
