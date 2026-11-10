import { useState } from 'react';
import type { Layer } from '../../core/model';
import { activeLayers } from '../../core/store';
import { Icon, type IconName } from '../components';
import { editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';

const TYPE_ICON: Record<Layer['type'], IconName> = { image: 'image', text: 'text', fill: 'fill', shape: 'square', qr: 'qr' };

/** Layer list, top-most first. Drag rows to change the stacking order. */
export function LayersPanel() {
  const t = useT();
  const layers = useEditor(activeLayers);
  const selected = useEditor((s) => s.selection.layerIds);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const rows = [...layers].reverse();

  return (
    <section className="flex min-h-0 flex-col border-t border-line" data-testid="layers-panel">
      <h3 className="label flex items-center gap-1 px-3 pb-1 pt-3"><Icon name="layers" size={14} />{t('inspector.layers')}</h3>
      {rows.length === 0 && <p className="px-3 pb-3 text-xs text-muted">{t('inspector.noLayers')}</p>}
      {rows.length > 1 && <p className="px-3 pb-1 text-[11px] text-muted">{t('inspector.layersHint')}</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows.map((l, row) => {
          const isSel = selected.includes(l.id);
          return (
            <li key={l.id}
              draggable
              onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); }}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverIndex(row); } }}
              onDragEnd={() => { setDragId(null); setOverIndex(null); }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) editor.reorder(dragId, layers.length - 1 - row);
                setDragId(null);
                setOverIndex(null);
              }}
              onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? editor.toggleSelect(l.id) : editor.select([l.id]))}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${isSel ? 'bg-accent-soft text-accent' : 'hover:bg-hover'} ${overIndex === row && dragId !== l.id ? 'ring-2 ring-accent/50' : ''}`}
            >
              <Icon name={TYPE_ICON[l.type]} size={14} className={`shrink-0 text-muted ${l.visible ? '' : 'opacity-50'}`} />
              <span className={`min-w-0 flex-1 truncate ${l.visible ? '' : 'opacity-50'}`}>{l.name}</span>
              {/* Actions show on hover and on the selected row; a set state (locked, hidden) always shows. */}
              <button className={`rounded p-0.5 text-muted hover:text-ink ${l.locked || isSel ? '' : 'invisible group-hover:visible'}`} title={t(l.locked ? 'inspector.unlock' : 'inspector.lock')} aria-label={t(l.locked ? 'inspector.unlock' : 'inspector.lock')}
                onClick={(e) => { e.stopPropagation(); editor.updateLayer(l.id, { locked: !l.locked }); }}>
                <Icon name={l.locked ? 'lock' : 'unlock'} size={14} />
              </button>
              <button className={`rounded p-0.5 text-muted hover:text-ink ${!l.visible || isSel ? '' : 'invisible group-hover:visible'}`} title={t(l.visible ? 'inspector.hide' : 'inspector.show')} aria-label={t(l.visible ? 'inspector.hide' : 'inspector.show')}
                onClick={(e) => { e.stopPropagation(); editor.updateLayer(l.id, { visible: !l.visible }); }}>
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} />
              </button>
              <button className={`rounded p-0.5 text-muted hover:text-danger ${isSel ? '' : 'invisible group-hover:visible'}`} title={t('inspector.deleteLayer')} aria-label={t('inspector.deleteLayer')} data-testid="layer-delete"
                onClick={(e) => { e.stopPropagation(); editor.removeLayers([l.id]); }}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
