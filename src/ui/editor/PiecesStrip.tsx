import { useEffect, useRef, useState } from 'react';
import type { Piece } from '../../core/model';
import { faceIds, isMultiPage, pageCount } from '../../core/faces';
import { getTemplate, TEMPLATES } from '../../core/templates/catalog';
import type { Family, Side } from '../../core/templates/types';
import { drawPieceThumb, preloadPreviews } from '../../engine/render/preview';
import { Icon } from '../components';
import { ProductArt, TemplateDetails } from '../TemplatePreview';
import { useSavedFormats } from '../useFormats';
import { EMPTY, editor, useEditor } from '../editorInstance';
import { useT } from '../hooks';

function FaceThumb({ piece, side, active, onClick }: { piece: Piece; side: Side; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    drawPieceThumb(c, piece, side);
    let alive = true;
    void preloadPreviews([piece]).then(() => { if (alive && ref.current) drawPieceThumb(ref.current, piece, side); });
    return () => { alive = false; };
  }, [piece, side]);
  return (
    <button onClick={onClick} className={`rounded-md border bg-canvas p-1 ${active ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-accent/60'}`}>
      <canvas ref={ref} width={120} height={70} className="block h-[70px] w-[120px]" />
    </button>
  );
}

const FAMILIES: Family[] = ['jewel', 'dvd', 'bluray', 'sleeve', 'digipak', 'disc'];

export function PiecesStrip() {
  const t = useT();
  const pieces = useEditor((s) => s.project?.pieces ?? EMPTY);
  const sel = useEditor((s) => s.selection);
  const [adding, setAdding] = useState<{ left: number; bottom: number } | null>(null);
  const [hover, setHover] = useState(TEMPLATES[0].id);
  const formats = useSavedFormats();

  return (
    <footer className="flex shrink-0 items-end gap-3 border-t border-line bg-panel px-3 py-2" data-testid="pieces-strip">
      {/* Always visible, even with many pieces. */}
      <div className="relative shrink-0 self-center">
        <button className="btn h-[78px] w-[78px] flex-col whitespace-normal px-1 text-center text-xs leading-tight" data-testid="add-piece"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAdding(adding ? null : { left: Math.max(8, r.left), bottom: window.innerHeight - r.top + 8 });
          }}>
          <Icon name="plus" size={18} />{t('editor.addPiece')}
        </button>
        {adding && <div className="fixed inset-0 z-30" onClick={() => setAdding(null)} aria-hidden="true" />}
        {adding && (
          <div className="fixed z-40 flex max-h-[min(78vh,640px)] overflow-hidden rounded-lg border border-line bg-panel shadow-lg" style={adding} data-testid="add-piece-menu">
            <div className="w-72 shrink-0 overflow-y-auto p-1">
              {formats.length > 0 && (
                <div className="py-1" data-testid="my-formats">
                  <div className="label px-3 py-1">{t('formats.mine')}</div>
                  {formats.map((f) => (
                    <button key={f.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover"
                      onMouseEnter={() => setHover(f.templateId)} onFocus={() => setHover(f.templateId)}
                      onClick={() => { editor.addPiece(f.templateId, f.params); setAdding(null); }}>
                      <ProductArt id={f.templateId} className="h-9 w-12 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{f.name}</span>
                        <span className="block truncate text-xs text-muted">{t(getTemplate(f.templateId).nameKey)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {FAMILIES.map((fam) => (
                <div key={fam} className="py-1">
                  <div className="label px-3 py-1">{t(`family.${fam}`)}</div>
                  {TEMPLATES.filter((tp) => tp.family === fam).map((tp) => (
                    <button key={tp.id} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${hover === tp.id ? 'bg-hover' : 'hover:bg-hover'}`}
                      onMouseEnter={() => setHover(tp.id)} onFocus={() => setHover(tp.id)}
                      onClick={() => { editor.addPiece(tp.id); setAdding(null); }} data-testid={`add-${tp.id}`}>
                      <ProductArt id={tp.id} className="h-9 w-12 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm">{t(tp.nameKey)}</span>
                        <span className="block truncate text-xs text-muted">{t(tp.descKey)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="w-[340px] shrink-0 overflow-y-auto border-l border-line p-4">
              <TemplateDetails templateId={hover} compact />
              <p className="mt-3 text-[11px] text-muted">{t('preview.clickToAdd')}</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-end gap-3 overflow-x-auto pb-1">
        {pieces.map((p) => {
          const tpl = getTemplate(p.templateId);
          const isActive = p.id === sel.pieceId;
          // One thumbnail per piece (outside / cover); the inside is chosen above the canvas.
          const face = isActive && !isMultiPage(p) ? sel.side : faceIds(p)[0];
          return (
            <div key={p.id} className="group flex shrink-0 flex-col gap-1">
              <FaceThumb piece={p} side={face} active={isActive} onClick={() => editor.selectPiece(p.id)} />
              <div className="flex max-w-[128px] items-center justify-between gap-2 px-0.5">
                <span className={`truncate text-xs ${isActive ? 'font-medium text-accent' : 'text-muted'}`} title={t(tpl.nameKey)}>
                  {t(tpl.nameKey)}{isMultiPage(p) ? `, ${t('editor.pagesCount', { n: pageCount(p) })}` : ''}{p.copies > 1 ? ` ×${p.copies}` : ''}
                </span>
                <button className="invisible text-muted hover:text-danger group-hover:visible" title={t('editor.removePiece')} aria-label={t('editor.removePiece')}
                  onClick={() => { if (confirm(t('editor.confirmRemovePiece'))) editor.removePiece(p.id); }}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </footer>
  );
}
