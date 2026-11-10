import { Fragment, useState } from 'react';
import { ALIGN_HOWS, alignTarget, type AlignHow, type AlignTo } from '../../core/align';
import { faceDieline } from '../../core/faces';
import type { Layer } from '../../core/model';
import { activePiece } from '../../core/store';
import { Icon, type IconName } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';

const ICON: Record<AlignHow, IconName> = {
  left: 'alignLeft', hcenter: 'alignHCenter', right: 'alignRight', top: 'alignTop', vcenter: 'alignVCenter', bottom: 'alignBottom',
};

/**
 * Six align buttons and what they align to: the layer's panel (default for
 * one layer), the whole piece, or each other (default for several).
 */
export function AlignBar({ layers }: { layers: Layer[] }) {
  const t = useT();
  const piece = useEditor(activePiece);
  const side = useEditor((s) => s.selection.side);
  const [choice, setChoice] = useState<AlignTo | null>(null);
  if (!piece || !layers.length) return null;
  const multi = layers.length > 1;
  const d = faceDieline(piece, side);
  const wanted: AlignTo = choice && (choice !== 'selection' || multi) ? choice : multi ? 'selection' : 'panel';
  const target = alignTarget(layers, wanted, d, side);
  const panel = alignTarget(layers, 'panel', d, side).panel;
  const panelName = panel ? t(panel.labelKey, panel.labelVars ?? {}) : '';
  const options: { value: AlignTo; label: string }[] = [
    ...(multi ? [{ value: 'selection' as const, label: t('align.toSelection') }] : []),
    ...(panel ? [{ value: 'panel' as const, label: t('align.toPanel', { panel: panelName }) }] : []),
    { value: 'piece', label: t('align.toPiece') },
  ];
  const allLocked = layers.every((l) => l.locked);
  return (
    <div className="space-y-1.5" data-testid="align-bar">
      <div className="flex items-center" role="group" aria-label={t('align.title')}>
        {ALIGN_HOWS.map((how, i) => (
          <Fragment key={how}>
            {i === 3 && <span className="mx-1 h-5 w-px shrink-0 bg-line" />}
            <button type="button" className="btn btn-ghost btn-icon" title={t(`align.${how}`)} aria-label={t(`align.${how}`)} disabled={allLocked}
              data-testid={`align-${how}`} onClick={() => editor.alignLayers(layers.map((l) => l.id), how, target.to)}>
              <Icon name={ICON[how]} />
            </button>
          </Fragment>
        ))}
      </div>
      <label className="grid grid-cols-[84px_1fr] items-center gap-2">
        <span className="text-xs text-muted">{t('align.relativeTo')}</span>
        <select className="field min-w-0" value={target.to} data-testid="align-to" onChange={(e) => setChoice(e.target.value as AlignTo)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
}
