// Reader for ncnn models (.param text + .bin weights), the format of the
// bundled models. Pure, no I/O; the ONNX conversion is in onnxGraph.ts.

export type ParamValue = number | number[];

export interface NcnnLayer {
  type: string;
  name: string;
  bottoms: string[];
  tops: string[];
  params: Map<number, ParamValue>;
}

const MAGIC = 7767517;

export function parseParam(text: string): NcnnLayer[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (Number(lines[0]) !== MAGIC) throw new Error('ncnn: not a .param file (bad magic number)');
  const [layerCount] = lines[1].split(/\s+/).map(Number);
  const layers: NcnnLayer[] = [];
  for (const line of lines.slice(2)) {
    const tok = line.split(/\s+/);
    const [type, name] = tok;
    const nb = Number(tok[2]), nt = Number(tok[3]);
    const bottoms = tok.slice(4, 4 + nb);
    const tops = tok.slice(4 + nb, 4 + nb + nt);
    const params = new Map<number, ParamValue>();
    for (const kv of tok.slice(4 + nb + nt)) {
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const key = Number(kv.slice(0, eq));
      const raw = kv.slice(eq + 1);
      if (key <= -23300) {
        // Array parameter: "-233xx=n,v1,...,vn" is parameter xx.
        const [, ...vals] = raw.split(',').map(Number);
        params.set(-(key + 23300), vals);
      } else {
        params.set(key, Number(raw));
      }
    }
    layers.push({ type, name, bottoms, tops, params });
  }
  if (layers.length !== layerCount) throw new Error(`ncnn: expected ${layerCount} layers, read ${layers.length}`);
  return layers;
}

export function num(l: NcnnLayer, key: number, fallback: number): number {
  const v = l.params.get(key);
  return typeof v === 'number' ? v : fallback;
}

export function arr(l: NcnnLayer, key: number): number[] {
  const v = l.params.get(key);
  return Array.isArray(v) ? v : [];
}

/** Kept in the stored precision (usually half floats) so a float16 graph needs no conversion. */
export type Weights = { kind: 'f16'; data: Uint16Array } | { kind: 'f32'; data: Float32Array };

export interface LayerWeights { weight?: Weights; bias?: Float32Array; slope?: Float32Array }

const TAG_F16 = 0x01306b47;
const TAG_INT8 = 0x000d4b38;
const TAG_RAW = 0x0002c056;
const align4 = (n: number) => (n + 3) & ~3;

/** The .bin holds the weights back to back, in layer order. */
export function readWeights(layers: NcnnLayer[], bin: ArrayBuffer): Map<string, LayerWeights> {
  const view = new DataView(bin);
  let off = 0;
  const need = (n: number) => {
    if (off + n > bin.byteLength) throw new Error('ncnn: .bin file is shorter than its .param says (wrong pair of files?)');
  };
  const floats = (count: number): Float32Array => {
    need(count * 4);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(off + i * 4, true);
    off += count * 4;
    return out;
  };
  // A weight blob starts with a 4-byte tag that says how it is stored.
  const tagged = (count: number): Weights => {
    need(4);
    const tag = view.getUint32(off, true);
    const f = [0, 1, 2, 3].map((i) => view.getUint8(off + i));
    off += 4;
    if (tag === TAG_F16) {
      need(count * 2);
      const data = new Uint16Array(count);
      for (let i = 0; i < count; i++) data[i] = view.getUint16(off + i * 2, true);
      off += align4(count * 2);
      return { kind: 'f16', data };
    }
    if (tag === TAG_RAW || (f[0] === 0 && f[1] === 0 && f[2] === 0 && f[3] === 0)) return { kind: 'f32', data: floats(count) };
    if (tag === TAG_INT8) throw new Error('ncnn: int8 (quantised) models are not supported');
    throw new Error('ncnn: quantised weight tables are not supported');
  };

  const out = new Map<string, LayerWeights>();
  for (const l of layers) {
    if (l.type === 'Convolution') {
      const size = num(l, 6, 0);
      const w: LayerWeights = { weight: tagged(size) };
      if (num(l, 5, 0)) w.bias = floats(num(l, 0, 0));
      out.set(l.name, w);
    } else if (l.type === 'PReLU') {
      out.set(l.name, { slope: floats(num(l, 0, 1)) });
    }
  }
  if (off !== bin.byteLength) throw new Error(`ncnn: ${bin.byteLength - off} bytes of the .bin file left unread (wrong pair of files?)`);
  return out;
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Rounds to nearest even. */
export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = (x >>> 23) & 0xff;
  let m = x & 0x7fffff;
  if (e === 255) return sign | 0x7c00 | (m ? 0x200 : 0);
  let he = e - 127 + 15;
  if (he >= 31) return sign | 0x7c00;
  if (he <= 0) {
    if (he < -10) return sign;
    m |= 0x800000;
    const shift = 14 - he;
    let hm = m >> shift;
    const rem = m & ((1 << shift) - 1), half = 1 << (shift - 1);
    if (rem > half || (rem === half && hm & 1)) hm++;
    return sign | hm;
  }
  let hm = m >> 13;
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && hm & 1)) {
    hm++;
    if (hm === 0x400) { hm = 0; he++; if (he >= 31) return sign | 0x7c00; }
  }
  return sign | (he << 10) | hm;
}

let halfTable: Float32Array | null = null;

export function toFloat32(w: Weights): Float32Array {
  if (w.kind === 'f32') return w.data;
  // A half float has only 65536 values: a lookup table is fast for millions of weights.
  if (!halfTable) {
    halfTable = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) halfTable[i] = halfToFloat(i);
  }
  const t = halfTable;
  const out = new Float32Array(w.data.length);
  for (let i = 0; i < out.length; i++) out[i] = t[w.data[i]];
  return out;
}

export function toFloat16(w: Weights | Float32Array): Uint16Array {
  if (!(w instanceof Float32Array) && w.kind === 'f16') return w.data;
  const src = w instanceof Float32Array ? w : w.data;
  const out = new Uint16Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = floatToHalf(src[i]);
  return out;
}
