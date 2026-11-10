import { useEffect, useState } from 'react';
import { listFormats, onFormatsChange, type SavedFormat } from '../engine/formats';

/** The user's saved formats, kept up to date. */
export function useSavedFormats(): SavedFormat[] {
  const [formats, setFormats] = useState<SavedFormat[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void listFormats().then((f) => { if (alive) setFormats(f); });
    load();
    const off = onFormatsChange(load);
    return () => { alive = false; off(); };
  }, []);
  return formats;
}
