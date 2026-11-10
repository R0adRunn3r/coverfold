export interface StorageInfo {
  /** Bytes used by this site (projects and images), null when the browser does not tell. */
  usage: number | null;
  /** True when the browser promised not to clear the data under storage pressure. */
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const s = navigator.storage;
  if (!s) return { usage: null, persisted: null };
  const [est, persisted] = await Promise.all([
    s.estimate ? s.estimate().catch(() => null) : null,
    s.persisted ? s.persisted().catch(() => null) : null,
  ]);
  return { usage: est?.usage ?? null, persisted };
}

/**
 * Asks the browser to keep the data even when disk space runs low. Chrome
 * decides silently, Firefox may ask the user once: call after a user action.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
