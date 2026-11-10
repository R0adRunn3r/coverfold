// Grid of the project's pictures to choose from (replacing a picture, a QR
// code's logo), optionally with a tile to load a new one from disk.
import { useEffect, useRef, useState } from 'react';
import { ACCEPTED_TYPES, getAssetInfos, type AssetInfo } from '../../engine/assets';
import { db } from '../../engine/db';
import { Icon } from '../components';
import { EMPTY, useEditor } from '../editorInstance';
import { useT } from '../hooks';
import { importFiles } from './actions';

const TILE = 'flex aspect-square items-center justify-center overflow-hidden rounded border border-line hover:border-accent';
const CHECKER = 'bg-[repeating-conic-gradient(var(--color-checker)_0_25%,var(--color-panel)_0_50%)] bg-[length:10px_10px]';

export function AssetPicker({ onPick, exclude, upload = false, testId }: {
  onPick: (asset: AssetInfo) => void;
  /** Picture not to offer (the one already in use). */
  exclude?: string;
  /** Also offer a tile to load a new picture from disk. */
  upload?: boolean;
  testId?: string;
}) {
  const t = useT();
  const assetIds = useEditor((s) => s.project?.assetIds ?? EMPTY);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void getAssetInfos(assetIds).then(async (list) => {
      const map: Record<string, string> = {};
      for (const a of list) {
        const row = await db.assets.get(a.id);
        if (row) { map[a.id] = URL.createObjectURL(row.preview); made.push(map[a.id]); }
      }
      if (alive) { setAssets(list); setUrls(map); }
    });
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [assetIds]);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const [first] = await importFiles(files.slice(0, 1));
      if (first) onPick(first);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-4 gap-1" data-testid={testId}>
      {assets.filter((a) => a.id !== exclude).map((a) => (
        <button key={a.id} type="button" title={`${a.name}\n${a.width} × ${a.height} px`} className={`${TILE} ${CHECKER}`} onClick={() => onPick(a)}>
          {urls[a.id] && <img src={urls[a.id]} alt={a.name} className="max-h-full max-w-full object-contain" />}
        </button>
      ))}
      {upload && (
        <>
          <button type="button" className={`${TILE} flex-col gap-0.5 border-dashed px-0.5 text-center text-[10px] leading-tight text-muted hover:text-ink`}
            onClick={() => input.current?.click()} disabled={busy} title={t('editor.browse')} data-testid="asset-picker-upload">
            <Icon name="upload" size={16} />{busy ? '...' : t('editor.browse')}
          </button>
          <input ref={input} type="file" accept={ACCEPTED_TYPES.join(',')} hidden
            onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void onFiles(files); }} />
        </>
      )}
    </div>
  );
}
