// Geometry in millimetres, y axis pointing down (same as canvas and SVG).
// Paths use only lines and cubic Béziers so the exact same data can drive
// Canvas2D, Konva and raw PDF operators.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export type Seg =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Z' };

export type Path = Seg[];

/** 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const translate = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];

/** Clockwise quarter turns around the origin (y down). */
export const rotateQuarter = (quarters: number): Matrix => {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return [1, 0, 0, 1, 0, 0];
  if (q === 1) return [0, 1, -1, 0, 0, 0];
  if (q === 2) return [-1, 0, 0, -1, 0, 0];
  return [0, -1, 1, 0, 0, 0];
};

/** m1 applied after m2. */
export const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

export const applyMatrix = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

export function transformPath(path: Path, m: Matrix): Path {
  return path.map((s) => {
    if (s.t === 'Z') return s;
    if (s.t === 'C') {
      const p1 = applyMatrix(m, { x: s.x1, y: s.y1 });
      const p2 = applyMatrix(m, { x: s.x2, y: s.y2 });
      const p = applyMatrix(m, s);
      return { t: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
    }
    const p = applyMatrix(m, s);
    return { t: s.t, x: p.x, y: p.y };
  });
}

export function rectPath(r: Rect): Path {
  return [
    { t: 'M', x: r.x, y: r.y },
    { t: 'L', x: r.x + r.w, y: r.y },
    { t: 'L', x: r.x + r.w, y: r.y + r.h },
    { t: 'L', x: r.x, y: r.y + r.h },
    { t: 'Z' },
  ];
}

export function polygonPath(points: Point[]): Path {
  if (points.length === 0) return [];
  const [first, ...rest] = points;
  return [{ t: 'M', x: first.x, y: first.y }, ...rest.map((p): Seg => ({ t: 'L', x: p.x, y: p.y })), { t: 'Z' }];
}

const KAPPA = 0.5522847498307936;

/** Full circle as four cubic Béziers (max radial error about 0.027%). */
export function circlePath(cx: number, cy: number, r: number): Path {
  const k = r * KAPPA;
  return [
    { t: 'M', x: cx + r, y: cy },
    { t: 'C', x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
    { t: 'C', x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
    { t: 'C', x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
    { t: 'C', x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
    { t: 'Z' },
  ];
}

/** Splits a path into polylines (one per subpath), flattening Béziers. */
export function flattenPath(path: Path, stepsPerCurve = 16): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  let start: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  for (const s of path) {
    if (s.t === 'M') {
      if (cur.length > 1) out.push(cur);
      start = { x: s.x, y: s.y };
      last = start;
      cur = [start];
    } else if (s.t === 'L') {
      last = { x: s.x, y: s.y };
      cur.push(last);
    } else if (s.t === 'C') {
      const p0 = last;
      for (let i = 1; i <= stepsPerCurve; i++) {
        const t = i / stepsPerCurve;
        const u = 1 - t;
        cur.push({
          x: u * u * u * p0.x + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
          y: u * u * u * p0.y + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y,
        });
      }
      last = { x: s.x, y: s.y };
    } else {
      if (last.x !== start.x || last.y !== start.y) cur.push(start);
      last = start;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export function pathBBox(path: Path): Rect {
  const pts = flattenPath(path).flat();
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const inflateRect = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const pointInRect = (p: Point, r: Rect): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Even-odd point-in-path test on the flattened path (holes are honoured). */
export function pointInPath(p: Point, polys: Point[][]): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToOutline(p: Point, polys: Point[][]): number {
  let d = Infinity;
  for (const poly of polys) for (let i = 1; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i - 1], poly[i]));
  return d;
}

export interface LineSeg { x1: number; y1: number; x2: number; y2: number }

export const transformLine = (l: LineSeg, m: Matrix): LineSeg => {
  const a = applyMatrix(m, { x: l.x1, y: l.y1 });
  const b = applyMatrix(m, { x: l.x2, y: l.y2 });
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
};

/** Splits a segment into the runs where `keep` holds, sampling every `step` mm. */
export function clipLine(l: LineSeg, keep: (p: Point) => boolean, step = 0.25): LineSeg[] {
  const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  const n = Math.max(1, Math.ceil(len / step));
  const out: LineSeg[] = [];
  let runStart: Point | null = null;
  let prev: Point | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { x: l.x1 + (l.x2 - l.x1) * t, y: l.y1 + (l.y2 - l.y1) * t };
    if (keep(p)) {
      if (!runStart) runStart = p;
      prev = p;
    } else if (runStart && prev) {
      if (Math.hypot(prev.x - runStart.x, prev.y - runStart.y) > step) out.push({ x1: runStart.x, y1: runStart.y, x2: prev.x, y2: prev.y });
      runStart = null;
    }
  }
  if (runStart && prev && Math.hypot(prev.x - runStart.x, prev.y - runStart.y) > step) {
    out.push({ x1: runStart.x, y1: runStart.y, x2: prev.x, y2: prev.y });
  }
  return out;
}

/**
 * Maps piece trim coordinates (mm) to the rotated bleed box scaled by (sx, sy),
 * which is what a face image covers, with its origin at the top-left.
 */
export function faceMatrix(w: number, h: number, bleed: number, quarter: number, sx: number, sy: number): Matrix {
  const rot = multiply(rotateQuarter(quarter), translate(bleed, bleed));
  const corners = [
    applyMatrix(rot, { x: -bleed, y: -bleed }), applyMatrix(rot, { x: w + bleed, y: -bleed }),
    applyMatrix(rot, { x: -bleed, y: h + bleed }), applyMatrix(rot, { x: w + bleed, y: h + bleed }),
  ];
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  return multiply([sx, 0, 0, sy, 0, 0], multiply(translate(-minX, -minY), rot));
}
