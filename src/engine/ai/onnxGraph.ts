// Converts an ncnn upscaling network to an ONNX graph for onnxruntime-web,
// with the same maths as ncnn. Tensors are NCHW with batch 1, so ncnn's
// channel axis 0 is axis 1. The graph maps RGB in 0-1, [1, 3, h, w] to
// [1, 3, h*s, w*s]. 'f16' keeps the stored half-float weights, for GPUs with
// shader-f16 (half the memory, often faster). Unsupported layers fail by name.

import { arr, num, readWeights, toFloat16, toFloat32, type NcnnLayer } from './ncnn';
import { DT_FLOAT, DT_FLOAT16, rawBytes, writeModel, type Attr, type GraphDef, type NodeDef, type TensorDef } from './onnxProto';

export type Precision = 'f32' | 'f16';

export interface ConvertedModel {
  bytes: Uint8Array;
  input: string;
  output: string;
  /** Traced from the layers (4 for the bundled models). */
  scale: number;
}

const OPSET = 17;

export class UnsupportedModelError extends Error {
  constructor(what: string) {
    super(`This model uses something the upscaler does not support: ${what}`);
    this.name = 'UnsupportedModelError';
  }
}

export function ncnnToOnnx(layers: NcnnLayer[], bin: ArrayBuffer, precision: Precision = 'f32'): ConvertedModel {
  const weights = readWeights(layers, bin);
  const type = precision === 'f16' ? DT_FLOAT16 : DT_FLOAT;
  const nodes: NodeDef[] = [];
  const inits: TensorDef[] = [];
  // ncnn's Split only copies a blob: its tops are aliases of the same tensor.
  const alias = new Map<string, string>();
  const name = (blob: string) => alias.get(blob) ?? blob;
  const consumed = new Set<string>();
  let input = '';
  let scale = 1;
  const scaleOf = new Map<string, number>();
  let uid = 0;

  const tensorOf = (n: string, dims: number[], data: Float32Array): string => {
    inits.push({ name: n, dims, type, raw: rawBytes(precision === 'f16' ? toFloat16(data) : data) });
    return n;
  };
  const scalar = (v: number) => tensorOf(`const_${uid++}`, [], Float32Array.of(v));

  for (const l of layers) {
    const ins = l.bottoms.map(name);
    for (const b of ins) consumed.add(b);
    const out = l.tops[0];
    const s = ins.length ? Math.max(...ins.map((i) => scaleOf.get(i) ?? 1)) : 1;
    let outScale = s;
    const add = (op: string, inputs: string[], attrs?: Attr[], outputs = [out]) => nodes.push({ op, inputs, outputs, name: `${l.name}_${uid++}`, attrs });

    switch (l.type) {
      case 'Input':
        input = out;
        break;
      case 'Split':
        for (const t of l.tops) alias.set(t, ins[0]);
        break;
      case 'Convolution': {
        const w = weights.get(l.name);
        if (!w?.weight) throw new UnsupportedModelError(`${l.name} has no weights`);
        const outC = num(l, 0, 0);
        const kw = num(l, 1, 0), kh = num(l, 11, kw);
        const dw = num(l, 2, 1), dh = num(l, 12, dw);
        const sw = num(l, 3, 1), sh = num(l, 13, sw);
        const pl = num(l, 4, 0), pt = num(l, 14, pl), pr = num(l, 15, pl), pb = num(l, 16, pt);
        if ([pl, pt, pr, pb].some((p) => p < 0)) throw new UnsupportedModelError(`automatic padding in ${l.name}`);
        if (num(l, 8, 0)) throw new UnsupportedModelError(`int8 convolution ${l.name}`);
        const inC = w.weight.data.length / (outC * kh * kw);
        const wName = `${l.name}_w`;
        if (precision === 'f16') inits.push({ name: wName, dims: [outC, inC, kh, kw], type, raw: rawBytes(toFloat16(w.weight)) });
        else inits.push({ name: wName, dims: [outC, inC, kh, kw], type, raw: rawBytes(toFloat32(w.weight)) });
        const convIns = [ins[0], wName];
        if (w.bias) convIns.push(tensorOf(`${l.name}_b`, [outC], w.bias));
        const conv: Attr[] = [
          { name: 'kernel_shape', ints: [kh, kw] }, { name: 'pads', ints: [pt, pl, pb, pr] },
          { name: 'strides', ints: [sh, sw] }, { name: 'dilations', ints: [dh, dw] },
        ];
        if (sh !== 1 || sw !== 1) outScale = s / sh;
        const act = num(l, 9, 0);
        if (act === 0) add('Conv', convIns, conv);
        else {
          const mid = `${out}_pre`;
          add('Conv', convIns, conv, [mid]);
          activation(act, arr(l, 10), mid, out, add, l.name);
        }
        break;
      }
      case 'ReLU': {
        const slope = num(l, 0, 0);
        if (slope === 0) add('Relu', ins);
        else add('LeakyRelu', ins, [{ name: 'alpha', f: slope }]);
        break;
      }
      case 'PReLU': {
        const slope = weights.get(l.name)?.slope;
        if (!slope) throw new UnsupportedModelError(`${l.name} has no slopes`);
        add('PRelu', [ins[0], tensorOf(`${l.name}_slope`, slope.length === 1 ? [1] : [slope.length, 1, 1], slope)]);
        break;
      }
      case 'Concat': {
        const axis = num(l, 0, 0);
        if (axis !== 0) throw new UnsupportedModelError(`concatenation along axis ${axis} in ${l.name}`);
        add('Concat', ins, [{ name: 'axis', i: 1 }]);
        break;
      }
      case 'BinaryOp': {
        const op = num(l, 0, 0);
        const withScalar = num(l, 1, 0) === 1;
        const ops: Record<number, string> = { 0: 'Add', 1: 'Sub', 2: 'Mul', 3: 'Div' };
        const reversed: Record<number, string> = { 7: 'Sub', 8: 'Div' };
        if (withScalar) {
          const b = scalar(num(l, 2, 0));
          if (ops[op]) add(ops[op], [ins[0], b]);
          else if (reversed[op]) add(reversed[op], [b, ins[0]]);
          else throw new UnsupportedModelError(`binary operation ${op} in ${l.name}`);
        } else {
          if (ins.length !== 2) throw new UnsupportedModelError(`${l.name} with ${ins.length} inputs`);
          if (ops[op]) add(ops[op], ins);
          else if (reversed[op]) add(reversed[op], [ins[1], ins[0]]);
          else throw new UnsupportedModelError(`binary operation ${op} in ${l.name}`);
        }
        break;
      }
      case 'Eltwise': {
        const op = num(l, 0, 0);
        if (op !== 1) {
          const onx = op === 0 ? 'Mul' : op === 2 ? 'Max' : '';
          if (!onx) throw new UnsupportedModelError(`element-wise operation ${op} in ${l.name}`);
          chain(onx, ins, out, add, l.name);
          break;
        }
        // Sum, each input times its coefficient (default 1).
        const coeffs = arr(l, 1);
        const terms = ins.map((t, i) => {
          const c = coeffs[i] ?? 1;
          if (c === 1) return t;
          const scaled = `${out}_t${i}`;
          add('Mul', [t, scalar(c)], undefined, [scaled]);
          return scaled;
        });
        chain('Add', terms, out, add, l.name);
        break;
      }
      case 'Interp': {
        const mode = num(l, 0, 0);
        const hs = num(l, 1, 1), ws = num(l, 2, 1);
        if (num(l, 3, 0) || num(l, 4, 0)) throw new UnsupportedModelError(`resize to a fixed size in ${l.name}`);
        if (hs !== ws) throw new UnsupportedModelError(`uneven resize in ${l.name}`);
        if (mode !== 1) throw new UnsupportedModelError(`${mode === 2 ? 'bilinear' : 'bicubic'} resize in ${l.name}`);
        // Resize takes its scales as float32 whatever the graph precision.
        const scales = `${l.name}_scales`;
        inits.push({ name: scales, dims: [4], type: DT_FLOAT, raw: rawBytes(Float32Array.of(1, 1, hs, ws)) });
        // ncnn nearest: source pixel floor(x / scale), i.e. asymmetric + floor.
        add('Resize', [ins[0], '', scales], [
          { name: 'mode', s: 'nearest' },
          { name: 'coordinate_transformation_mode', s: 'asymmetric' },
          { name: 'nearest_mode', s: 'floor' },
        ]);
        outScale = s * hs;
        break;
      }
      case 'PixelShuffle': {
        const r = num(l, 0, 1);
        if (num(l, 1, 0) !== 0) throw new UnsupportedModelError(`pixel shuffle mode in ${l.name}`);
        // PyTorch's pixel_shuffle is DepthToSpace in CRD order.
        add('DepthToSpace', ins, [{ name: 'blocksize', i: r }, { name: 'mode', s: 'CRD' }]);
        outScale = s * r;
        break;
      }
      case 'Noop':
        alias.set(out, ins[0]);
        break;
      default:
        throw new UnsupportedModelError(`layer type ${l.type} (${l.name})`);
    }
    for (const t of l.tops) if (!alias.has(t)) scaleOf.set(t, outScale);
    scale = Math.max(scale, outScale);
  }

  if (!input) throw new UnsupportedModelError('no input layer');
  // The output is the one blob no layer reads.
  const produced = layers.filter((l) => l.type !== 'Split' && l.type !== 'Noop').flatMap((l) => l.tops);
  const outputs = produced.filter((t) => !consumed.has(t) && !alias.has(t) && t !== input);
  if (outputs.length !== 1) throw new UnsupportedModelError(`${outputs.length} outputs`);
  const output = outputs[0];
  const outScale = scaleOf.get(output) ?? scale;
  if (!Number.isInteger(outScale) || outScale < 1) throw new UnsupportedModelError(`scale ${outScale}`);

  const graph: GraphDef = {
    name: 'upscaler',
    nodes,
    initializers: inits,
    inputs: [{ name: input, type, shape: [1, 3, 'h', 'w'] }],
    outputs: [{ name: output, type, shape: [1, 3, 'H', 'W'] }],
    opset: OPSET,
  };
  return { bytes: writeModel(graph), input, output, scale: outScale };
}

type AddFn = (op: string, inputs: string[], attrs?: Attr[], outputs?: string[]) => void;

/** Fused activation of an ncnn Convolution (params 9 and 10). */
function activation(type: number, params: number[], x: string, out: string, add: AddFn, layer: string) {
  if (type === 1) add('Relu', [x], undefined, [out]);
  else if (type === 2) add('LeakyRelu', [x], [{ name: 'alpha', f: params[0] ?? 0 }], [out]);
  else if (type === 4) add('Sigmoid', [x], undefined, [out]);
  else throw new UnsupportedModelError(`activation ${type} in ${layer}`);
}

/** Folds a two-input op left to right over the inputs. */
function chain(op: string, inputs: string[], out: string, add: AddFn, layer: string) {
  if (inputs.length < 2) throw new UnsupportedModelError(`${layer} with ${inputs.length} input`);
  let acc = inputs[0];
  inputs.slice(1).forEach((t, i) => {
    const target = i === inputs.length - 2 ? out : `${out}_acc${i}`;
    add(op, [acc, t], undefined, [target]);
    acc = target;
  });
}
