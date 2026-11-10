// Small geometry helpers for drawing die shapes: rounded corners and arcs,
// sampled as polylines (cut outlines are flattened anyway).
import type { Path, Point } from '../geometry';

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Point) => Math.hypot(v.x, v.y);

/**
 * A closed polygon with its corners rounded: `radii[i]` for corner i (0 =
 * sharp). Works for convex and concave corners; a radius is shrunk when the
 * neighbouring edges are too short for it.
 */
export function roundedPolygon(pts: Point[], radii: number[], step = 1): Point[] {
  const out: Point[] = [];
  pts.forEach((p, i) => {
    const r = radii[i] ?? 0;
    const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length];
    const u = sub(a, p), v = sub(c, p);
    const lu = len(u), lv = len(v);
    const cos = (u.x * v.x + u.y * v.y) / (lu * lv);
    const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
    if (r <= 0 || half < 1e-3 || Math.PI / 2 - half < 1e-3) {
      out.push(p);
      return;
    }
    // Tangent points at distance t from the corner, at most half of each edge.
    const t = Math.min(r / Math.tan(half), lu / 2, lv / 2);
    const rr = t * Math.tan(half);
    const ux = u.x / lu, uy = u.y / lu, vx = v.x / lv, vy = v.y / lv;
    const t1 = { x: p.x + ux * t, y: p.y + uy * t };
    const t2 = { x: p.x + vx * t, y: p.y + vy * t };
    const bx = ux + vx, by = uy + vy, bl = Math.hypot(bx, by);
    const centre = { x: p.x + (bx / bl) * (rr / Math.sin(half)), y: p.y + (by / bl) * (rr / Math.sin(half)) };
    const a1 = Math.atan2(t1.y - centre.y, t1.x - centre.x);
    let a2 = Math.atan2(t2.y - centre.y, t2.x - centre.x);
    // The short way round, from the first tangent point to the second.
    while (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
    while (a2 - a1 < -Math.PI) a2 += 2 * Math.PI;
    const n = Math.max(2, Math.ceil((Math.abs(a2 - a1) * rr) / step));
    for (let k = 0; k <= n; k++) {
      const ang = a1 + ((a2 - a1) * k) / n;
      out.push({ x: centre.x + rr * Math.cos(ang), y: centre.y + rr * Math.sin(ang) });
    }
  });
  return out;
}

/**
 * An open arc through `a` and `b` that bulges by `sag` (mm) to the left of
 * the direction a to b (to the right with a negative sag).
 */
export function arcPath(a: Point, b: Point, sag: number, step = 1): Path {
  const chord = len(sub(b, a));
  if (Math.abs(sag) < 1e-6 || chord < 1e-6) return [{ t: 'M', x: a.x, y: a.y }, { t: 'L', x: b.x, y: b.y }];
  const s = Math.abs(sag);
  const r = (chord * chord) / (8 * s) + s / 2;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  // Left normal of a to b (y down: the left of the direction of travel).
  const nx = (b.y - a.y) / chord, ny = -(b.x - a.x) / chord;
  const dir = Math.sign(sag);
  const centre = { x: mx - nx * dir * (r - s), y: my - ny * dir * (r - s) };
  const a1 = Math.atan2(a.y - centre.y, a.x - centre.x);
  let a2 = Math.atan2(b.y - centre.y, b.x - centre.x);
  while (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
  while (a2 - a1 < -Math.PI) a2 += 2 * Math.PI;
  const n = Math.max(4, Math.ceil((Math.abs(a2 - a1) * r) / step));
  const path: Path = [];
  for (let k = 0; k <= n; k++) {
    const ang = a1 + ((a2 - a1) * k) / n;
    path.push({ t: k === 0 ? 'M' : 'L', x: centre.x + r * Math.cos(ang), y: centre.y + r * Math.sin(ang) });
  }
  return path;
}

/** Points of a half circle cut into an edge, from `from` to `to` (both on the edge), bulging by its radius towards `inward`. */
export function notchPoints(from: Point, to: Point, inward: Point, step = 1): Point[] {
  const c = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const r = len(sub(to, from)) / 2;
  const a1 = Math.atan2(from.y - c.y, from.x - c.x);
  const mid = Math.atan2(inward.y, inward.x);
  // Go round through the inward direction.
  let a2 = Math.atan2(to.y - c.y, to.x - c.x);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(mid - a1) < norm(a2 - a1);
  if (ccw) { while (a2 < a1) a2 += 2 * Math.PI; } else { while (a2 > a1) a2 -= 2 * Math.PI; }
  const n = Math.max(6, Math.ceil((Math.abs(a2 - a1) * r) / step));
  const out: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const ang = a1 + ((a2 - a1) * k) / n;
    out.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
  }
  return out;
}
