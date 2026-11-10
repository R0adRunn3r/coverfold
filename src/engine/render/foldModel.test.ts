import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pocketFor } from '../../core/discHolder';
import { buildDieline, CLOSE_SLIT, CLOSE_TUCK, defaultParams, TEMPLATES } from '../../core/templates/catalog';
import type { Dieline, TemplateDef } from '../../core/templates/types';
import { buildFoldModel, GLUE_LIFT, POCKET_LIFT, poseFold, v3, type FoldModel } from './foldModel';

/** A face of the folded model in scene space. */
interface Sheet { id: string; pts: THREE.Vector3[]; n: THREE.Vector3; through?: string }

function sheet(id: string, pts: THREE.Vector3[], through?: string): Sheet {
  // Newell's normal: robust for any planar polygon.
  const n = new THREE.Vector3();
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    n.x += (p.y - q.y) * (p.z + q.z);
    n.y += (p.z - q.z) * (p.x + q.x);
    n.z += (p.x - q.x) * (p.y + q.y);
  });
  return { id, pts, n: n.normalize(), through };
}

/** Every face at fold `t`, plus the largest pocket that fits on `pocketOn`. */
function sheetsAt(m: FoldModel, t: number, d?: Dieline, pocketOn?: string): Sheet[] {
  poseFold(m.hinges, t);
  m.root.updateMatrixWorld(true);
  const out = m.faces.map((f) => sheet(f.id, f.poly.map((p) => v3(p).applyMatrix4(m.anchors.get(f.id)!.matrixWorld)), f.through));
  const panel = d?.panels.find((p) => p.id === pocketOn);
  const size = panel && pocketFor(panel);
  if (panel && size) {
    const g = m.groups.get(panel.id)!;
    const cx = panel.rect.x + panel.rect.w / 2, cy = panel.rect.y + panel.rect.h / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
      new THREE.Vector3(cx + (sx * size.w) / 2, -(cy + (sy * size.h) / 2), -POCKET_LIFT).applyMatrix4(g.matrixWorld));
    out.push(sheet('pocket', corners));
  }
  return out;
}

/** 2D coordinates on the plane of `s`. */
function planar(s: Sheet) {
  const u = s.pts[1].clone().sub(s.pts[0]).normalize();
  const w = s.n.clone().cross(u);
  return (p: THREE.Vector3) => ({ x: p.clone().sub(s.pts[0]).dot(u), y: p.clone().sub(s.pts[0]).dot(w) });
}

type P2 = { x: number; y: number };
const area2 = (poly: P2[]) => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
const ccw = (poly: P2[]) => (poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0) >= 0 ? poly : [...poly].reverse());

/** Sutherland-Hodgman: the part of `subject` inside the convex `clip`. */
function clip(subject: P2[], clipPoly: P2[]): P2[] {
  let out = ccw(subject);
  const c = ccw(clipPoly);
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const side = (p: P2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = out;
    out = [];
    input.forEach((p, j) => {
      const q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const k = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      }
    });
  }
  return out;
}

/** Faces lying on the same plane over some area: they flicker, each drawn over the other in turn. */
function sharedPlanes(sheets: Sheet[], within = 0.1): string[] {
  const out: string[] = [];
  for (let i = 0; i < sheets.length; i++) {
    for (let j = i + 1; j < sheets.length; j++) {
      const a = sheets[i], b = sheets[j];
      if (Math.abs(a.n.dot(b.n)) < 0.9999) continue;
      if (b.pts.some((p) => Math.abs(p.clone().sub(a.pts[0]).dot(a.n)) > within)) continue;
      const to2 = planar(a);
      const overlap = area2(clip(b.pts.map(to2), a.pts.map(to2)));
      if (overlap > 0.5) out.push(`${a.id} ~ ${b.id} (${overlap.toFixed(0)} mm²)`);
    }
  }
  return out;
}

/** Faces passing through each other: an edge of one goes across the inside of the other. */
function crossings(sheets: Sheet[], eps = 0.02): string[] {
  const out: string[] = [];
  const pierces = (a: Sheet, b: Sheet) => {
    const to2 = planar(b);
    const poly = ccw(b.pts.map(to2));
    return a.pts.some((p, i) => {
      const q = a.pts[(i + 1) % a.pts.length];
      const dp = p.clone().sub(b.pts[0]).dot(b.n), dq = q.clone().sub(b.pts[0]).dot(b.n);
      if (!(dp > eps && dq < -eps) && !(dp < -eps && dq > eps)) return false;
      const x = to2(p.clone().lerp(q, dp / (dp - dq)));
      // Strictly inside: clear of every edge of b by more than eps.
      return poly.every((e, k) => {
        const f = poly[(k + 1) % poly.length];
        const len = Math.hypot(f.x - e.x, f.y - e.y) || 1;
        return ((f.x - e.x) * (x.y - e.y) - (f.y - e.y) * (x.x - e.x)) / len > eps;
      });
    });
  };
  for (let i = 0; i < sheets.length; i++) {
    for (let j = i + 1; j < sheets.length; j++) {
      const a = sheets[i], b = sheets[j];
      // A tucked tab goes through the slit of its panel on purpose.
      if (a.through === b.id || b.through === a.id) continue;
      if (pierces(a, b) || pierces(b, a)) out.push(`${a.id} × ${b.id}`);
    }
  }
  return out;
}

/** Defaults, presets, every choice and both ends of each range. */
function variants(t: TemplateDef): Record<string, number>[] {
  const base = defaultParams(t);
  const out = [base, ...t.presets.map((p) => ({ ...base, ...p.values }))];
  for (const p of t.params) for (const c of p.choices ?? []) out.push({ ...base, [p.key]: c.value });
  out.push(Object.fromEntries(t.params.map((p) => [p.key, p.choices ? p.default : p.min])));
  out.push(Object.fromEntries(t.params.map((p) => [p.key, p.choices ? p.default : p.max])));
  return out;
}

const foldable = TEMPLATES.filter((t) => t.id !== 'disc.label');

describe('3D fold model', () => {
  it('folds every piece without two faces sharing a plane', () => {
    const found: string[] = [];
    for (const t of foldable) {
      for (const params of variants(t)) {
        const d = buildDieline(t.id, params);
        const m = buildFoldModel(d);
        for (const s of sharedPlanes(sheetsAt(m, 1, d, t.discHolder?.panelId))) found.push(`${t.id} ${JSON.stringify(params)}: ${s}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('never folds a face through another, all the way through the animation', () => {
    const found = new Set<string>();
    for (const t of foldable) {
      for (const params of variants(t)) {
        const d = buildDieline(t.id, params);
        const m = buildFoldModel(d);
        for (let k = 0; k <= 40; k++) for (const s of crossings(sheetsAt(m, k / 40, d, t.discHolder?.panelId))) found.add(`${t.id}: ${s} at ${k / 40}`);
      }
    }
    expect([...found]).toEqual([]);
  });

  it('lifts glue flaps off the panel they are glued to, inside the piece', () => {
    // Slipcase: the wall tabs lie on the inside of the back, which closes over them.
    const t = TEMPLATES.find((x) => x.id === 'sleeve.slipcase')!;
    const m = buildFoldModel(buildDieline(t.id, defaultParams(t)));
    const sheets = sheetsAt(m, 1);
    const z = (id: string) => sheets.find((s) => s.id === id)!.pts[0].z;
    expect(z('back')).toBeLessThan(0);
    expect(z('glue0') - z('back')).toBeCloseTo(GLUE_LIFT, 5);
    expect(z('glue1') - z('back')).toBeCloseTo(GLUE_LIFT, 5);
  });

  it('closes the sleeve flap over the back, its tab in the slit; a tucked flap goes inside', () => {
    const zOf = (lock: number) => {
      const m = buildFoldModel(buildDieline('sleeve.flap', { lock }));
      const sheets = sheetsAt(m, 1);
      return (id: string) => {
        const s = sheets.find((x) => x.id === id)!;
        return s.pts.reduce((a, p) => a + p.z, 0) / s.pts.length;
      };
    };
    const slit = zOf(CLOSE_SLIT);
    // Front at 0, back behind it; the flap lies on the outside of the back
    expect(slit('back')).toBeLessThan(-0.5);
    expect(slit('closure')).toBeLessThan(slit('back'));
    // and its tab under the back, between it and the disc.
    expect(slit('closure~tab')).toBeGreaterThan(slit('back'));
    expect(slit('closure~tab')).toBeLessThan(0);
    const tuck = zOf(CLOSE_TUCK);
    expect(tuck('closure')).toBeGreaterThan(tuck('back'));
    expect(tuck('closure')).toBeLessThan(0);
  });
});
