// QR logos: the code's structure (checked against the real encoder by reading
// the data back), which modules a logo takes, and how much that costs.
import { describe, expect, it } from 'vitest';
import { layerAssetIds, makeImageLayer, makePiece, makeProject, makeQrLayer, type QrLogo } from './model';
import { qrMatrix, type QrMatrix } from './qr';
import { QR_LOGO_MIN_MODULE, denserForLogo, fitLogoSize, layerQrMatrix, maxLogoSize, qrEcc, qrModule, qrProblem } from './qrLayer';
import { QR_LOGO_DEFAULT_SIZE, QR_LOGO_MAX_DAMAGE, logoFits, packFootprint, qrLogoPlan, solidFootprint, unpackFootprint } from './qrLogo';
import { alignmentPositions, qrLayout, rawDataModules } from './qrSpec';
import { activeLayers, createEditor } from './store';
import { preflight } from './preflight';

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Decodes a level-H byte-mode code with our layout: the text comes back only if the layout is right. */
function readBack(m: QrMatrix): string {
  const n = m.size;
  const dark = (r: number, c: number) => m.dark[r * n + c] === 1;
  // Format bits around the top-left finder (bits 0-7 down column 8, 8-14 along row 8).
  let format = 0;
  const pos: [number, number][] = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  pos.forEach(([r, c], i) => { if (dark(r, c)) format |= 1 << i; });
  format ^= 0x5412;
  expect(format >> 13).toBe(2); // level H
  const mask = MASKS[(format >> 10) & 7];
  const layout = qrLayout(m.version);
  const words = new Uint8Array(layout.block.length);
  layout.order.forEach((k, i) => {
    const r = Math.floor(k / n), c = k % n;
    if (dark(r, c) !== mask(r, c)) words[i >> 3] |= 0x80 >> (i & 7);
  });
  // De-interleave: each block's data codewords come first, in order.
  const perBlock: number[][] = Array.from({ length: layout.blocks }, () => []);
  words.forEach((w, i) => perBlock[layout.block[i]].push(w));
  const total = words.length;
  const shortLen = Math.floor(total / layout.blocks), shortBlocks = layout.blocks - (total % layout.blocks);
  const data = perBlock.flatMap((b, j) => b.slice(0, shortLen - layout.ecc + (j >= shortBlocks ? 1 : 0)));
  // Byte mode: 4-bit mode, 8- or 16-bit length, then the bytes.
  let bit = 0;
  const read = (count: number) => {
    let v = 0;
    for (let i = 0; i < count; i++, bit++) v = (v << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
    return v;
  };
  expect(read(4)).toBe(0b0100);
  const len = read(m.version < 10 ? 8 : 16);
  const bytes = Uint8Array.from({ length: len }, () => read(8));
  return new TextDecoder().decode(bytes);
}

describe('QR structure', () => {
  it('places alignment patterns as in the standard', () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(36)).toEqual([6, 24, 50, 76, 102, 128, 154]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it('leaves exactly the data modules of the standard free, in every version', () => {
    for (let v = 1; v <= 40; v++) {
      const l = qrLayout(v);
      const free = l.fixed.reduce((s, f) => s + (f ? 0 : 1), 0);
      expect(free).toBe(rawDataModules(v));
      expect(l.order.length).toBe(Math.floor(rawDataModules(v) / 8) * 8);
      // Every vital module is fixed; only inner alignment patterns are fixed but not vital.
      expect(l.vital.every((x, k) => !x || l.fixed[k])).toBe(true);
    }
  });

  it('reads back what the encoder wrote, in one block or many', () => {
    const texts = ['https://example.com', 'città', 'x'.repeat(40), 'https://coverfold.example/album?id=' + 'a'.repeat(28), 'y'.repeat(200)];
    const versions = new Set<number>();
    for (const text of texts) {
      const m = qrMatrix(text, 'H')!;
      versions.add(m.version);
      expect(readBack(m)).toBe(text);
    }
    // Single block, two blocks, short+long blocks, version information (7+), 16-bit lengths (10+).
    expect([...versions].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 15]);
  });
});

const URL_TEXT = 'https://coverfold.example/album';
const logoOf = (size: number, footprint = solidFootprint(100, 100), w = 100, h = 100): QrLogo =>
  ({ assetId: 'logo', name: 'logo.png', naturalW: w, naturalH: h, size, footprint });

/** A round logo: a disc inside its square (transparent corners). */
function discFootprint(cells = 64) {
  const bits = new Uint8Array(cells * cells);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const dx = x + 0.5 - cells / 2, dy = y + 0.5 - cells / 2;
    bits[y * cells + x] = dx * dx + dy * dy <= (cells / 2) ** 2 ? 1 : 0;
  }
  return packFootprint(cells, cells, bits);
}

/** An outline logo: a thin ring, mostly transparent. */
function ringFootprint(cells = 64) {
  const bits = new Uint8Array(cells * cells);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const d = Math.hypot(x + 0.5 - cells / 2, y + 0.5 - cells / 2);
    bits[y * cells + x] = d <= cells / 2 && d >= cells / 2 - 3 ? 1 : 0;
  }
  return packFootprint(cells, cells, bits);
}

const count = (a: Uint8Array) => a.reduce((s, x) => s + x, 0);

describe('QR logos', () => {
  it('packs footprints without losing cells', () => {
    const cells = Uint8Array.from({ length: 37 * 5 }, (_, i) => (i * 7) % 3 === 0 ? 1 : 0);
    expect([...unpackFootprint(packFootprint(37, 5, cells))]).toEqual([...cells]);
    const wide = solidFootprint(400, 100);
    expect([wide.w, wide.h]).toEqual([64, 16]);
  });

  it('always uses the strongest correction and lists the logo picture', () => {
    const q = { ...makeQrLayer(URL_TEXT, { x: 0, y: 0, w: 25, h: 25 }), logo: logoOf(0.2) };
    expect(qrEcc(q)).toBe('H');
    expect(qrEcc({ ...q, logo: null })).toBe('M');
    expect(layerQrMatrix(q)!.size).toBeGreaterThan(qrMatrix(URL_TEXT, 'M')!.size);
    expect(qrModule(q)!).toBeLessThan(qrModule({ ...q, logo: null })!);
    expect(layerAssetIds(q)).toEqual(['logo']);
  });

  it('clears a centred block for an opaque logo, with a gap around it', () => {
    const m = qrMatrix(URL_TEXT, 'H')!;
    const plan = qrLogoPlan(m, logoOf(0.2));
    const n = m.size;
    const rows = new Set<number>(), cols = new Set<number>();
    plan.cleared.forEach((x, k) => { if (x) { rows.add(Math.floor(k / n)); cols.add(k % n); } });
    // Symmetric around the middle module, a little wider than the picture.
    expect(Math.min(...rows) + Math.max(...rows)).toBe(n - 1);
    expect(Math.min(...cols) + Math.max(...cols)).toBe(n - 1);
    expect(cols.size).toBeGreaterThan(plan.rect.w);
    expect(cols.size).toBeLessThanOrEqual(Math.ceil(plan.rect.w + 1) + 1);
    expect(plan.hitsPattern).toBe(false);
    expect(plan.damage).toBeGreaterThan(0);
  });

  it('keeps the modules a transparent logo does not cover', () => {
    const m = qrMatrix(URL_TEXT, 'H')!;
    const square = qrLogoPlan(m, logoOf(0.3));
    const disc = qrLogoPlan(m, logoOf(0.3, discFootprint()));
    const ring = qrLogoPlan(m, logoOf(0.3, ringFootprint()));
    expect(count(disc.cleared)).toBeLessThan(count(square.cleared));
    expect(count(ring.cleared)).toBeLessThan(count(disc.cleared));
    expect(disc.damage).toBeLessThanOrEqual(square.damage);
    // A ring leaves its middle: the centre module stays.
    const mid = Math.floor(m.size / 2) * (m.size + 1);
    expect(ring.cleared[mid]).toBe(0);
    expect(square.cleared[mid]).toBe(1);
  });

  it('fits a wide logo by its longer side', () => {
    const m = qrMatrix(URL_TEXT, 'H')!;
    const plan = qrLogoPlan(m, logoOf(0.3, solidFootprint(300, 100), 300, 100));
    expect(plan.rect.w).toBeCloseTo(0.3 * m.size, 6);
    expect(plan.rect.h).toBeCloseTo(0.1 * m.size, 6);
  });

  const solid = { assetId: 'logo', name: 'logo.png', naturalW: 100, naturalH: 100, footprint: solidFootprint(100, 100) };

  it('starts new logos at a safe size and never offers an unreadable one', () => {
    const q = makeQrLayer(URL_TEXT, { x: 0, y: 0, w: 30, h: 30 });
    const size = fitLogoSize(q, solid);
    expect(size).toBeLessThanOrEqual(QR_LOGO_DEFAULT_SIZE);
    expect(qrProblem({ ...q, logo: { ...solid, size } })).toBeNull();
    // The largest size offered reads; one step more does not.
    const max = maxLogoSize(q, solid)!;
    expect(qrProblem({ ...q, logo: { ...solid, size: max } })).toBeNull();
    expect(qrProblem({ ...q, logo: { ...solid, size: max + 0.01 } })).toBe('logoBig');
    // An opaque logo at 40% cannot be read by any code: warned, also in the print checks.
    const big = { ...q, logo: { ...solid, size: 0.4 } };
    expect(max).toBeLessThan(0.4);
    expect(qrLogoPlan(layerQrMatrix(big)!, big.logo).damage).toBeGreaterThan(QR_LOGO_MAX_DAMAGE);
    expect(qrProblem(big)).toBe('logoBig');
    const piece = makePiece('jewel.tray');
    piece.layers.outside.push(big);
    expect(preflight(makeProject('t', 'jewel', [piece])).map((i) => i.kind)).toContain('qrLogoBig');
    // A logo with transparent corners can be bigger.
    expect(maxLogoSize(q, { ...solid, footprint: discFootprint() })!).toBeGreaterThanOrEqual(max);
  });

  it('makes a short code denser to fit a bigger logo, keeping modules printable', () => {
    // A short text alone makes a 25x25 code: little room in the middle.
    const q = makeQrLayer('example.it/x', { x: 0, y: 0, w: 24, h: 24 });
    const small = qrMatrix(q.text, 'H')!;
    expect(small.version).toBe(2);
    let alone = 0;
    for (let p = 10; p <= 40; p++) if (logoFits(qrLogoPlan(small, { ...solid, size: p / 100 }))) alone = p / 100;
    const max = maxLogoSize(q, solid)!;
    expect(max).toBeGreaterThan(alone + 0.05);
    const withLogo = { ...q, logo: { ...solid, size: max } };
    expect(layerQrMatrix(withLogo)!.version).toBeGreaterThan(2);
    expect(denserForLogo(withLogo)).toBe(true);
    expect(qrModule(withLogo)!).toBeGreaterThanOrEqual(QR_LOGO_MIN_MODULE);
    expect(qrProblem(withLogo)).toBeNull();
    // A small logo keeps the code as it is.
    const tiny = { ...q, logo: { ...solid, size: 0.12 } };
    expect(layerQrMatrix(tiny)!.version).toBe(2);
    expect(denserForLogo(tiny)).toBe(false);
    // A small box cannot go denser without modules too small to print.
    expect(maxLogoSize({ ...q, w: 16, h: 16 }, solid)).toBe(alone);
  });

  it('flags a logo over the patterns readers need', () => {
    // Version 3: the alignment pattern readers look for sits 6 modules from the middle.
    const m = qrMatrix('https://example.com', 'H')!;
    expect(m.version).toBe(3);
    expect(qrLogoPlan(m, logoOf(0.4)).hitsPattern).toBe(true);
    expect(qrLogoPlan(m, logoOf(0.25)).hitsPattern).toBe(false);
    // Version 1 has no room at all: format information runs next to the middle.
    expect(qrLogoPlan(qrMatrix('hi', 'H')!, logoOf(0.1)).hitsPattern).toBe(true);
  });

  it('drops the logo when its picture is deleted from the project', () => {
    const ed = createEditor();
    ed.load(makeProject('t', 'jewel', [makePiece('jewel.tray')]));
    ed.addAssets(['logo', 'photo']);
    const q = { ...makeQrLayer(URL_TEXT, { x: 0, y: 0, w: 25, h: 25 }), logo: logoOf(0.2) };
    ed.addLayer(q);
    ed.addLayer(makeImageLayer('photo', 'p', 100, 100, { x: 0, y: 0, w: 10, h: 10 }));
    ed.removeAsset('logo');
    const layers = activeLayers(ed.store.getState());
    expect(layers).toHaveLength(2);
    expect(layers.find((l) => l.type === 'qr')).toMatchObject({ logo: null });
  });
});
