// The folding skeleton of a flat piece: every rigid face (a panel or a glue
// flap) hangs from its neighbour on a hinge. Plain three.js maths, no
// renderer: the 3D preview dresses it with meshes, the tests check it folded.
import * as THREE from 'three';
import { flattenPath, pointInPath, type Point, type Rect } from '../../core/geometry';
import type { Dieline, FoldDef, TuckDef } from '../../core/templates/types';

/**
 * A flat region of the piece that stays rigid: a panel, a glue flap, or the
 * tab of a panel that tucks into a slit (`through`: the panel it goes under).
 */
export interface Face { id: string; poly: Point[]; center: Point; glue: boolean; through?: string }

/**
 * A face folded flat (180 deg) would lie exactly on its neighbour, so its hinge
 * axis sits this far (mm) behind the sheet and it lands two of these behind,
 * like the board's thickness. Later steps land further back (a sleeve's back
 * over its glue flaps).
 */
export const FLAT_GAP = 0.2;

/**
 * A glue flap sits this far (mm) off the panel it is glued to, on its
 * unprinted side, so the two never share a plane and flicker.
 */
export const GLUE_LIFT = 0.2;

/** The pocket glued inside a panel sits this far off it (mm), on the inside. */
export const POCKET_LIFT = 0.15;

/**
 * A tucked tab: a short neck bends it in, then it lies flat this far (mm)
 * inside its flap. The flap lies two FLAT_GAPs out from the slit panel, so
 * the tab ends up under that panel, between it and the disc.
 */
export const TUCK_DEPTH = 0.7;
const TUCK_NECK = 1.6;
const TUCK_ANGLE = (Math.asin(TUCK_DEPTH / TUCK_NECK) * 180) / Math.PI;

export interface Hinge { pivot: THREE.Group; axis: THREE.Vector3; angle: number; step: number }

export interface FoldModel {
  /** Centred on the root face (the front when there is one). */
  root: THREE.Group;
  faces: Face[];
  /** The group each face moves with, by face id: things glued on a panel go here. */
  groups: Map<string, THREE.Group>;
  /** Where each face's own meshes go, by face id (glue flaps already lifted). */
  anchors: Map<string, THREE.Group>;
  hinges: Hinge[];
}

const rectFace = (id: string, r: Rect, through?: string): Face => ({
  id,
  poly: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  center: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
  glue: false,
  ...(through ? { through } : {}),
});

/** A tucked tab cut off its panel: what the panel keeps, the neck that bends, the tab, and the two hinges. */
function tuckParts(t: TuckDef, panel: Rect): { body: Rect; neck: Rect; tip: Rect; hinges: FoldDef[] } {
  const r = t.tab, n = TUCK_NECK;
  const along = (x1: number, y1: number, x2: number, y2: number, angle: number): FoldDef => ({ x1, y1, x2, y2, kind: 'valley', angle, step: t.step });
  switch (t.edge) {
    case 'left':
      return {
        body: { ...panel, w: r.x - panel.x }, neck: { ...r, w: n }, tip: { ...r, x: r.x + n, w: r.w - n },
        hinges: [along(r.x, r.y, r.x, r.y + r.h, TUCK_ANGLE), along(r.x + n, r.y, r.x + n, r.y + r.h, -TUCK_ANGLE)],
      };
    case 'right':
      return {
        body: { ...panel, x: r.x + r.w, w: panel.x + panel.w - r.x - r.w }, neck: { ...r, x: r.x + r.w - n, w: n }, tip: { ...r, w: r.w - n },
        hinges: [along(r.x + r.w, r.y, r.x + r.w, r.y + r.h, TUCK_ANGLE), along(r.x + r.w - n, r.y, r.x + r.w - n, r.y + r.h, -TUCK_ANGLE)],
      };
    case 'top':
      return {
        body: { ...panel, h: r.y - panel.y }, neck: { ...r, h: n }, tip: { ...r, y: r.y + n, h: r.h - n },
        hinges: [along(r.x, r.y, r.x + r.w, r.y, TUCK_ANGLE), along(r.x, r.y + n, r.x + r.w, r.y + n, -TUCK_ANGLE)],
      };
    default:
      return {
        body: { ...panel, y: r.y + r.h, h: panel.y + panel.h - r.y - r.h }, neck: { ...r, y: r.y + r.h - n, h: n }, tip: { ...r, h: r.h - n },
        hinges: [along(r.x, r.y + r.h, r.x + r.w, r.y + r.h, TUCK_ANGLE), along(r.x, r.y + r.h - n, r.x + r.w, r.y + r.h - n, -TUCK_ANGLE)],
      };
  }
}

/** Tucked tabs add hinges that exist only in 3D. */
export function facesOf(d: Dieline): { faces: Face[]; tuckHinges: FoldDef[] } {
  const faces: Face[] = d.panels.map((p) => rectFace(p.id, p.rect));
  const tuckHinges: FoldDef[] = [];
  for (const t of d.tucks ?? []) {
    const i = faces.findIndex((f) => f.id === t.panelId);
    const panel = d.panels.find((p) => p.id === t.panelId);
    if (i < 0 || !panel) continue;
    const parts = tuckParts(t, panel.rect);
    faces[i] = rectFace(t.panelId, parts.body);
    faces.push(rectFace(`${t.panelId}~neck`, parts.neck, t.through), rectFace(`${t.panelId}~tab`, parts.tip, t.through));
    tuckHinges.push(...parts.hinges);
  }
  d.glue.forEach((g, i) => {
    const poly = flattenPath(g)[0];
    if (!poly || poly.length < 3) return;
    const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
    // Glue zones already covered by a panel (tabs drawn over a panel) are not separate faces.
    if (faces.some((f) => pointInPath(c, [f.poly]))) return;
    faces.push({ id: `glue${i}`, poly, center: c, glue: true });
  });
  return { faces, tuckHinges };
}

const inFace = (f: Face, p: Point) => pointInPath(p, [f.poly]);

/** The two faces a fold joins, found by probing just either side of its middle. */
function hingeFaces(faces: Face[], f: FoldDef): [Face, Face] | null {
  const mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
  const len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) || 1;
  const nx = -(f.y2 - f.y1) / len, ny = (f.x2 - f.x1) / len;
  const a = faces.find((fc) => inFace(fc, { x: mx + nx * 0.6, y: my + ny * 0.6 }));
  const b = faces.find((fc) => inFace(fc, { x: mx - nx * 0.6, y: my - ny * 0.6 }));
  return a && b && a !== b ? [a, b] : null;
}

/** Piece mm (y down) to scene units (y up), 1 unit = 1 mm. */
export const v3 = (p: Point) => new THREE.Vector3(p.x, -p.y, 0);

export function faceArea(f: Face): number {
  let a = 0;
  for (let i = 0; i < f.poly.length; i++) {
    const p = f.poly[i], q = f.poly[(i + 1) % f.poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** Built flat; `poseFold` folds it. */
export function buildFoldModel(d: Dieline): FoldModel {
  const { faces, tuckHinges } = facesOf(d);
  const groups = new Map<Face, THREE.Group>();
  const hingesOut: Hinge[] = [];
  const rootFace = faces.find((f) => f.id === 'front') ?? faces.reduce((a, b) => (faceArea(b) > faceArea(a) ? b : a));
  const root = new THREE.Group();
  const rootGroup = new THREE.Group();
  root.add(rootGroup);
  groups.set(rootFace, rootGroup);
  // Breadth-first from the root face.
  const queue = [rootFace];
  const hinges = [...d.folds, ...tuckHinges].map((f) => ({ f, pair: hingeFaces(faces, f) }));
  while (queue.length) {
    const cur = queue.shift()!;
    for (const { f, pair } of hinges) {
      if (!pair || !pair.includes(cur)) continue;
      const child = pair[0] === cur ? pair[1] : pair[0];
      if (groups.has(child)) continue;
      const p1 = v3({ x: f.x1, y: f.y1 }), p2 = v3({ x: f.x2, y: f.y2 });
      const dir = p2.clone().sub(p1).normalize();
      // Fold away from the printed side: the child turns towards -z.
      const toChild = v3(child.center).sub(p1);
      toChild.sub(dir.clone().multiplyScalar(toChild.dot(dir)));
      const axis = toChild.clone().cross(new THREE.Vector3(0, 0, -1)).normalize();
      const degrees = Math.min(180, f.angle ?? 90); // negative: towards the printed side
      const step = f.step ?? 0;
      const axisAt = p1.clone().add(new THREE.Vector3(0, 0, degrees >= 170 ? -FLAT_GAP * (1 + step) : 0));
      const pivot = new THREE.Group();
      pivot.position.copy(axisAt);
      const childGroup = new THREE.Group();
      childGroup.position.copy(axisAt.clone().negate());
      pivot.add(childGroup);
      groups.get(cur)!.add(pivot);
      groups.set(child, childGroup);
      hingesOut.push({ pivot, axis, angle: degrees * (Math.PI / 180), step });
      queue.push(child);
    }
  }
  const anchors = new Map<string, THREE.Group>();
  for (const f of faces) {
    const anchor = new THREE.Group();
    // The glued (printed) side of a flap lies on its panel; the flap body sits just off it.
    if (f.glue) anchor.position.z = -GLUE_LIFT;
    (groups.get(f) ?? rootGroup).add(anchor);
    anchors.set(f.id, anchor);
  }
  root.position.set(-rootFace.center.x, rootFace.center.y, 0);
  return { root, faces, groups: new Map([...groups].map(([f, g]) => [f.id, g])), anchors, hinges: hingesOut };
}

/**
 * 0 is flat as printed, 1 assembled. Staged folds (a flap tucked in before
 * the cover closes) move one after the other, each in its share of the way.
 */
export function poseFold(hinges: Hinge[], t: number): void {
  const fold = Math.max(0, Math.min(1, t));
  const steps = [...new Set(hinges.map((h) => h.step))].sort((a, b) => a - b);
  for (const h of hinges) {
    const k = Math.max(0, Math.min(1, fold * steps.length - steps.indexOf(h.step)));
    h.pivot.quaternion.setFromAxisAngle(h.axis, h.angle * k);
  }
}
