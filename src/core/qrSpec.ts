// QR code structure from ISO/IEC 18004: fixed patterns, and the codeword and
// error-correction block each other module carries, so the damage a logo does
// can be counted exactly. Only level H is described: a code with a logo uses it.

/** Error-correction codewords per block, level H, by version (index 0 unused). */
const ECC_PER_BLOCK_H = [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
/** Error-correction blocks, level H, by version. */
const BLOCKS_H = [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81];

/** Rows/columns of the alignment pattern centres (empty for version 1). */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** Modules that carry codewords (data and error correction), remainder bits included. */
export function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const a = Math.floor(version / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

export interface QrLayout {
  size: number;
  /** 1 = fixed pattern (finders, timing, alignment, format and version info). */
  fixed: Uint8Array;
  /**
   * 1 = a pattern readers rely on to find and straighten the code: all fixed
   * modules except the inner alignment patterns (from version 7 one sits in
   * the middle; readers estimate it, and every centred logo covers it).
   */
  vital: Uint8Array;
  /** Codeword carried by each module (-1: fixed pattern or remainder bit). */
  codeword: Int16Array;
  /** Modules carrying codeword bits, in order (most significant bit of each codeword first). */
  order: Int32Array;
  /** Error-correction block of each codeword. */
  block: Uint8Array;
  blocks: number;
  /** Error-correction codewords per block. */
  ecc: number;
  /** Codewords each block can repair. */
  capacity: number;
}

const layouts = new Map<number, QrLayout>();

/** Layout of a level-H code of this version (cached). */
export function qrLayout(version: number): QrLayout {
  const hit = layouts.get(version);
  if (hit) return hit;
  const n = version * 4 + 17;
  const fixed = new Uint8Array(n * n);
  const vital = new Uint8Array(n * n);
  const mark = (r0: number, c0: number, h: number, w: number, isVital = true) => {
    for (let r = Math.max(0, r0); r < Math.min(n, r0 + h); r++) {
      for (let c = Math.max(0, c0); c < Math.min(n, c0 + w); c++) {
        fixed[r * n + c] = 1;
        if (isVital) vital[r * n + c] = 1;
      }
    }
  };
  // Timing patterns.
  mark(6, 0, 1, n);
  mark(0, 6, n, 1);
  // Finder patterns with their separators.
  mark(0, 0, 8, 8);
  mark(0, n - 8, 8, 8);
  mark(n - 8, 0, 8, 8);
  // Format information (and the dark module next to the bottom-left finder).
  mark(8, 0, 1, 9);
  mark(0, 8, 9, 1);
  mark(8, n - 8, 1, 8);
  mark(n - 8, 8, 8, 1);
  // Version information.
  if (version >= 7) {
    mark(0, n - 11, 6, 3);
    mark(n - 11, 0, 3, 6);
  }
  // Alignment patterns: the bottom-right one is the one readers look for.
  const pos = alignmentPositions(version);
  const last = pos.length - 1;
  pos.forEach((r, i) => pos.forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // finders
    mark(r - 2, c - 2, 5, 5, i === last && j === last);
  }));

  // Codewords run in two-module columns, zigzagging up and down from the bottom-right.
  const codewords = Math.floor(rawDataModules(version) / 8);
  const codeword = new Int16Array(n * n).fill(-1);
  const order = new Int32Array(codewords * 8);
  let bit = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing pattern
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < n; v++) {
      const r = upward ? n - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const k = r * n + right - j;
        if (fixed[k] || bit >= codewords * 8) continue;
        codeword[k] = bit >> 3;
        order[bit++] = k;
      }
    }
  }

  // Codewords are interleaved across blocks; short blocks lack the last data codeword.
  const blocks = BLOCKS_H[version], ecc = ECC_PER_BLOCK_H[version];
  const shortLen = Math.floor(codewords / blocks);
  const shortBlocks = blocks - (codewords % blocks);
  const block = new Uint8Array(codewords);
  let k = 0;
  for (let i = 0; i <= shortLen; i++) {
    for (let j = 0; j < blocks; j++) if (i !== shortLen - ecc || j >= shortBlocks) block[k++] = j;
  }
  const out: QrLayout = { size: n, fixed, vital, codeword, order, block, blocks, ecc, capacity: Math.floor(ecc / 2) };
  layouts.set(version, out);
  return out;
}
