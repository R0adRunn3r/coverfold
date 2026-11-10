import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { floatToHalf, halfToFloat, parseParam, readWeights } from './ncnn';
import { ncnnToOnnx, UnsupportedModelError } from './onnxGraph';

// A tiny network with every layer kind the bundled models use: the converted
// ONNX graph, run by onnxruntime (CPU), must match a plain reference.
const PARAM = `7767517
14 18
Input            in        0 1 data 0=6 1=5 2=3
Split            sp0       1 3 data d0 d1 d2
Convolution      c1        1 1 d0 x1 0=4 1=3 4=1 5=1 6=108 9=2 -23310=1,2.000000e-01
Split            sp1       1 2 x1 x1a x1b
Concat           cat       2 1 x1a d1 cat 0=0
Convolution      c2        1 1 cat x2 0=4 1=1 5=0 6=28
ReLU             r         1 1 x2 x3 0=1.000000e-01
Eltwise          e         2 1 x3 x1b x4 0=1 -23301=2,2.000000e-01,1.000000e+00
PReLU            pr        1 1 x4 x5 0=4
BinaryOp         half      1 1 x5 x6 0=2 1=1 2=5.000000e-01
Convolution      c3        1 1 x6 x7 0=12 1=3 4=1 5=1 6=432
PixelShuffle     ps        1 1 x7 x8 0=2
Interp           up        1 1 d2 x9 0=1 1=2.000000e+00 2=2.000000e+00
BinaryOp         add       2 1 x8 x9 output 0=0
`;

let seed = 3;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;

/** .bin in ncnn's layout: c1 half floats (tagged) + bias, c2 floats (zero tag), PReLU slopes, c3 half floats + bias. */
function makeBin() {
  const parts: ArrayBuffer[] = [];
  const f32 = (a: number[]) => parts.push(Float32Array.from(a).buffer);
  const tagged16 = (a: number[]) => {
    const tag = new Uint32Array([0x01306b47]);
    const h = Uint16Array.from(a.map(floatToHalf));
    const padded = new Uint16Array(h.length + (h.length % 2));
    padded.set(h);
    parts.push(tag.buffer, padded.buffer);
    return Array.from(h, halfToFloat);
  };
  const w1 = tagged16(Array.from({ length: 108 }, () => rnd() * 0.6));
  const b1 = Array.from({ length: 4 }, () => rnd() * 0.2); f32(b1);
  parts.push(new Uint32Array([0]).buffer);
  const w2 = Array.from({ length: 28 }, () => rnd() * 0.6); f32(w2);
  const slope = [0.25, -0.1, 0.05, 0.5]; f32(slope);
  const w3 = tagged16(Array.from({ length: 432 }, () => rnd() * 0.4));
  const b3 = Array.from({ length: 12 }, () => rnd() * 0.1); f32(b3);
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const bin = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { bin.set(new Uint8Array(p), o); o += p.byteLength; }
  return { bin: bin.buffer, w1, b1, w2, slope, w3, b3 };
}

type T = { c: number; h: number; w: number; d: Float64Array };
const tensor = (c: number, h: number, w: number): T => ({ c, h, w, d: new Float64Array(c * h * w) });
const at = (t: T, c: number, y: number, x: number) => (y < 0 || x < 0 || y >= t.h || x >= t.w ? 0 : t.d[(c * t.h + y) * t.w + x]);

function conv(x: T, w: number[], b: number[] | null, out: number, k: number, pad: number): T {
  const r = tensor(out, x.h, x.w);
  for (let o = 0; o < out; o++) for (let y = 0; y < x.h; y++) for (let xx = 0; xx < x.w; xx++) {
    let s = b ? b[o] : 0;
    for (let c = 0; c < x.c; c++) for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
      s += w[((o * x.c + c) * k + ky) * k + kx] * at(x, c, y + ky - pad, xx + kx - pad);
    }
    r.d[(o * x.h + y) * x.w + xx] = s;
  }
  return r;
}
const map = (x: T, f: (v: number, c: number) => number): T => {
  const r = tensor(x.c, x.h, x.w);
  for (let i = 0; i < x.d.length; i++) r.d[i] = f(x.d[i], Math.floor(i / (x.h * x.w)));
  return r;
};

function reference(input: T, p: ReturnType<typeof makeBin>): T {
  const x1 = map(conv(input, p.w1, p.b1, 4, 3, 1), (v) => (v > 0 ? v : 0.2 * v));
  const cat = tensor(7, input.h, input.w);
  cat.d.set(x1.d, 0);
  cat.d.set(input.d, x1.d.length);
  const x3 = map(conv(cat, p.w2, null, 4, 1, 0), (v) => (v > 0 ? v : 0.1 * v));
  const x4 = tensor(4, input.h, input.w);
  for (let i = 0; i < x4.d.length; i++) x4.d[i] = 0.2 * x3.d[i] + x1.d[i];
  const x6 = map(x4, (v, c) => (v > 0 ? v : p.slope[c] * v) * 0.5);
  const x7 = conv(x6, p.w3, p.b3, 12, 3, 1);
  // Pixel shuffle x2 (PyTorch order) plus the input enlarged by nearest neighbour.
  const out = tensor(3, input.h * 2, input.w * 2);
  for (let c = 0; c < 3; c++) for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const src = c * 4 + (y % 2) * 2 + (x % 2);
    out.d[(c * out.h + y) * out.w + x] = at(x7, src, y >> 1, x >> 1) + at(input, c, y >> 1, x >> 1);
  }
  return out;
}

describe('ncnn → ONNX', () => {
  it('reads the .param text, array parameters included', () => {
    const layers = parseParam(PARAM);
    expect(layers).toHaveLength(14);
    const c1 = layers.find((l) => l.name === 'c1')!;
    expect(c1.params.get(0)).toBe(4);
    expect(c1.params.get(10)).toEqual([0.2]);
    expect(layers.find((l) => l.name === 'e')!.params.get(1)).toEqual([0.2, 1]);
    expect(layers.find((l) => l.name === 'sp0')!.tops).toEqual(['d0', 'd1', 'd2']);
    expect(() => parseParam('123\n1 1\n')).toThrow(/magic/);
  });

  it('reads tagged half-float and plain float weights, biases and slopes', () => {
    const p = makeBin();
    const w = readWeights(parseParam(PARAM), p.bin);
    expect(w.get('c1')!.weight!.kind).toBe('f16');
    expect(w.get('c2')!.weight!.kind).toBe('f32');
    expect(Array.from(w.get('c1')!.bias!)).toEqual(Array.from(Float32Array.from(p.b1)));
    expect(Array.from(w.get('pr')!.slope!)).toEqual(Array.from(Float32Array.from(p.slope)));
    // A .bin that does not belong to the .param is caught.
    expect(() => readWeights(parseParam(PARAM), p.bin.slice(0, 100))).toThrow(/shorter/);
  });

  it('converts half floats both ways', () => {
    for (const v of [0, 1, -2, 0.5, 0.1, 65504, 1e-5, -3.14159]) {
      expect(halfToFloat(floatToHalf(v))).toBeCloseTo(v, Math.abs(v) < 1 ? 3 : 1);
    }
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(-2)).toBe(0xc000);
  });

  it('builds a graph that computes what ncnn computes', async () => {
    const p = makeBin();
    const conv = ncnnToOnnx(parseParam(PARAM), p.bin);
    expect(conv.scale).toBe(2);
    expect(conv.input).toBe('data');
    expect(conv.output).toBe('output');
    const input = tensor(3, 5, 6);
    for (let i = 0; i < input.d.length; i++) input.d[i] = rnd() + 0.5;
    const session = await ort.InferenceSession.create(conv.bytes, { executionProviders: ['wasm'] });
    const res = await session.run({ data: new ort.Tensor('float32', Float32Array.from(input.d), [1, 3, 5, 6]) });
    const y = res.output;
    expect(y.dims).toEqual([1, 3, 10, 12]);
    const ref = reference(input, p);
    const got = y.data as Float32Array;
    let max = 0;
    for (let i = 0; i < ref.d.length; i++) max = Math.max(max, Math.abs(got[i] - ref.d[i]));
    expect(max).toBeLessThan(1e-4);
    await session.release();
  });

  it('keeps half floats in a float16 graph (half the weight bytes)', () => {
    const p = makeBin();
    const f32 = ncnnToOnnx(parseParam(PARAM), p.bin, 'f32').bytes.length;
    const f16 = ncnnToOnnx(parseParam(PARAM), p.bin, 'f16').bytes.length;
    expect(f16).toBeLessThan(f32 * 0.8);
  });

  it('refuses layers it cannot run, by name', () => {
    const bad = PARAM.replace('PixelShuffle     ps        1 1 x7 x8 0=2', 'Deconvolution    ps        1 1 x7 x8 0=2');
    expect(() => ncnnToOnnx(parseParam(bad), makeBin().bin)).toThrow(UnsupportedModelError);
    expect(() => ncnnToOnnx(parseParam(bad), makeBin().bin)).toThrow(/Deconvolution/);
  });
});
