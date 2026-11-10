// Minimal ONNX writer: only the protobuf messages a convolutional upscaler
// needs. Messages are lists of byte chunks joined once at the end, so tens
// of megabytes of weights are copied only once.
//
// Field numbers from onnx.proto (proto2): ModelProto, GraphProto, NodeProto,
// AttributeProto, TensorProto, ValueInfoProto, TypeProto, TensorShapeProto.

export const DT_FLOAT = 1;
export const DT_INT64 = 7;
export const DT_FLOAT16 = 10;

const enc = new TextEncoder();

class Msg {
  parts: Uint8Array[] = [];
  len = 0;

  private push(b: Uint8Array) { this.parts.push(b); this.len += b.length; }

  private varint(v: number | bigint) {
    let x = BigInt.asUintN(64, BigInt(v));
    const bytes: number[] = [];
    do {
      let b = Number(x & 0x7fn);
      x >>= 7n;
      if (x) b |= 0x80;
      bytes.push(b);
    } while (x);
    this.push(Uint8Array.from(bytes));
  }

  private key(field: number, wire: number) { this.varint((field << 3) | wire); }

  int(field: number, v: number) { this.key(field, 0); this.varint(v); return this; }

  float(field: number, v: number) {
    this.key(field, 5);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.push(b);
    return this;
  }

  bytes(field: number, b: Uint8Array) { this.key(field, 2); this.varint(b.length); this.push(b); return this; }

  str(field: number, s: string) { return this.bytes(field, enc.encode(s)); }

  msg(field: number, m: Msg) {
    this.key(field, 2);
    this.varint(m.len);
    for (const p of m.parts) this.push(p);
    return this;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

export type Attr =
  | { name: string; f: number }
  | { name: string; i: number }
  | { name: string; s: string }
  | { name: string; ints: number[] };

export interface NodeDef { op: string; inputs: string[]; outputs: string[]; name?: string; attrs?: Attr[] }

export interface TensorDef { name: string; dims: number[]; type: number; raw: Uint8Array }

/** A string is a symbolic dimension (e.g. 'h'). */
export type Dim = number | string;

export interface ValueDef { name: string; type: number; shape: Dim[] }

export interface GraphDef {
  name: string;
  nodes: NodeDef[];
  initializers: TensorDef[];
  inputs: ValueDef[];
  outputs: ValueDef[];
  opset: number;
}

function attribute(a: Attr): Msg {
  const m = new Msg().str(1, a.name);
  // AttributeType: FLOAT 1, INT 2, STRING 3, INTS 7.
  if ('f' in a) return m.float(2, a.f).int(20, 1);
  if ('i' in a) return m.int(3, a.i).int(20, 2);
  if ('s' in a) return m.bytes(4, enc.encode(a.s)).int(20, 3);
  for (const v of a.ints) m.int(8, v);
  return m.int(20, 7);
}

function node(n: NodeDef): Msg {
  const m = new Msg();
  for (const i of n.inputs) m.str(1, i);
  for (const o of n.outputs) m.str(2, o);
  if (n.name) m.str(3, n.name);
  m.str(4, n.op);
  for (const a of n.attrs ?? []) m.msg(5, attribute(a));
  return m;
}

function tensor(t: TensorDef): Msg {
  const m = new Msg();
  for (const d of t.dims) m.int(1, d);
  m.int(2, t.type).str(8, t.name).bytes(9, t.raw);
  return m;
}

function valueInfo(v: ValueDef): Msg {
  const shape = new Msg();
  for (const d of v.shape) shape.msg(1, typeof d === 'number' ? new Msg().int(1, d) : new Msg().str(2, d));
  const tensorType = new Msg().int(1, v.type).msg(2, shape);
  return new Msg().str(1, v.name).msg(2, new Msg().msg(1, tensorType));
}

/** Writes IR version 8. */
export function writeModel(g: GraphDef): Uint8Array {
  const graph = new Msg();
  for (const n of g.nodes) graph.msg(1, node(n));
  graph.str(2, g.name);
  for (const t of g.initializers) graph.msg(5, tensor(t));
  for (const v of g.inputs) graph.msg(11, valueInfo(v));
  for (const v of g.outputs) graph.msg(12, valueInfo(v));
  return new Msg()
    .int(1, 8)
    .str(2, 'coverfold')
    .msg(7, graph)
    .msg(8, new Msg().str(1, '').int(2, g.opset))
    .finish();
}

/** ONNX raw data is little-endian, like every platform we run on. */
export const rawBytes = (a: Float32Array | Uint16Array | BigInt64Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
