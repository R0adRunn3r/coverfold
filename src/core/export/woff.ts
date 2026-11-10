import { unzlibSync } from 'fflate';

/**
 * WOFF 1.0 to plain sfnt (TrueType/OpenType), which the PDF font embedder needs.
 * WOFF only zlib-compresses each table, so this inflates them and rewrites the directory.
 */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (v.getUint32(0) !== 0x774f4646) return woff; // not 'wOFF': assume it is already sfnt
  const flavor = v.getUint32(4);
  const numTables = v.getUint16(12);

  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = v.getUint32(e);
    const offset = v.getUint32(e + 4);
    const compLength = v.getUint32(e + 8);
    const origLength = v.getUint32(e + 12);
    const checksum = v.getUint32(e + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? unzlibSync(raw) : raw;
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => a.tag - b.tag);

  const headerSize = 12 + 16 * numTables;
  const pad4 = (n: number) => (n + 3) & ~3;
  const total = headerSize + tables.reduce((n, t) => n + pad4(t.data.length), 0);
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  o.setUint32(0, flavor);
  o.setUint16(4, numTables);
  o.setUint16(6, searchRange);
  o.setUint16(8, entrySelector);
  o.setUint16(10, numTables * 16 - searchRange);

  let offset = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    o.setUint32(rec, t.tag);
    o.setUint32(rec + 4, t.checksum);
    o.setUint32(rec + 8, offset);
    o.setUint32(rec + 12, t.data.length);
    out.set(t.data, offset);
    offset += pad4(t.data.length);
  });
  return out;
}
