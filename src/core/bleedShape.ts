import { flattenPath, pointInPath, rectPath, type Path, type Point } from './geometry';
import type { Dieline, PanelEdges } from './templates/types';

const signedArea = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x * poly[i].y) - (poly[i].x * poly[j].y);
  return a / 2;
};

/** Drops consecutive duplicate points and the closing one. */
function clean(poly: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
  return out;
}

/**
 * Miter offset of a simple polygon: d > 0 grows it, d < 0 shrinks it.
 * Good enough for dielines (short offsets compared with edge lengths).
 */
export function offsetPolygon(poly: Point[], d: number): Point[] {
  const pts = clean(poly);
  const n = pts.length;
  if (n < 3 || d === 0) return pts;
  // In y-down coordinates a positive signed area means clockwise on screen.
  const orient = signedArea(pts) > 0 ? 1 : -1;
  const normal = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    // Outward normal for a clockwise (screen) polygon is (dy, -dx)/l.
    return { x: (orient * dy) / l, y: (orient * -dx) / l };
  };
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const n1 = normal(prev, cur), n2 = normal(cur, next);
    const bis = { x: n1.x + n2.x, y: n1.y + n2.y };
    const bl = Math.hypot(bis.x, bis.y);
    if (bl < 1e-9) {
      out.push({ x: cur.x + n1.x * d, y: cur.y + n1.y * d });
      continue;
    }
    const cos = (n1.x * bis.x + n1.y * bis.y) / bl;
    // Limit spikes on very sharp corners (like a miter limit of 4).
    const len = d / Math.max(cos, 0.25);
    out.push({ x: cur.x + (bis.x / bl) * len, y: cur.y + (bis.y / bl) * len });
  }
  return out;
}

const EPS = 1e-6;

/** Kind of each outer side of the piece: a fold if a panel folds there, else a cut. */
export function outerEdges(d: Dieline): PanelEdges {
  const out: PanelEdges = { top: 'cut', right: 'cut', bottom: 'cut', left: 'cut' };
  for (const p of d.panels) {
    if (Math.abs(p.rect.x) < EPS && p.edges.left === 'fold') out.left = 'fold';
    if (Math.abs(p.rect.x + p.rect.w - d.w) < EPS && p.edges.right === 'fold') out.right = 'fold';
    if (Math.abs(p.rect.y) < EPS && p.edges.top === 'fold') out.top = 'fold';
    if (Math.abs(p.rect.y + p.rect.h - d.h) < EPS && p.edges.bottom === 'fold') out.bottom = 'fold';
  }
  return out;
}

/**
 * Region the artwork may cover: the cut outline grown by the bleed, with
 * holes (disc hub) shrunk by the bleed. Fill it with the even-odd rule.
 */
export function bleedShapePath(d: Dieline, bleed: number): Path {
  if (d.rectangular) {
    // Rectangular pieces only bleed on cut sides (a booklet page has a fold on one side).
    const e = outerEdges(d);
    const l = e.left === 'fold' ? 0 : bleed, r = e.right === 'fold' ? 0 : bleed;
    const t = e.top === 'fold' ? 0 : bleed, b = e.bottom === 'fold' ? 0 : bleed;
    return rectPath({ x: -l, y: -t, w: d.w + l + r, h: d.h + t + b });
  }
  const polys = flattenPath(d.cut, 24).map(clean);
  const path: Path = [];
  polys.forEach((poly, i) => {
    const others = polys.filter((_, j) => j !== i);
    const isHole = others.length > 0 && pointInPath(poly[0], others);
    const grown = offsetPolygon(poly, isHole ? -bleed : bleed);
    grown.forEach((p, k) => path.push({ t: k === 0 ? 'M' : 'L', x: p.x, y: p.y }));
    path.push({ t: 'Z' });
  });
  return path;
}
