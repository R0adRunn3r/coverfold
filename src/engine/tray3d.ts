// 3D-printable disc tray for cardboard digipaks and gatefolds (design in
// core/tray.ts): a plate glued inside the cover, a ring the disc rests on and
// a spring-arm hub that grips the centre hole. Parts are closed solids that
// overlap slightly so slicers merge them. Binary STL in mm, no overhangs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ARM_ROOT_R, ARM_SWEEP, ARM_TIP_R, ARMS, DISC_T, discZ, GRIP_R, HUB, HUB_HOLE_R, NOTCH, POST_IN_R, POST_SPAN, RING_H, RING_IN, RING_OUT,
  trayHeight, type TrayParams,
} from '../core/tray';

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const circle = (cx: number, cy: number, r: number, cw = false) => new THREE.Path().absarc(cx, cy, r, 0, Math.PI * 2, cw);

const extrude = (shape: THREE.Shape, depth: number, z: number) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 64 });
  g.translate(0, 0, z);
  return g;
};

/** Ring sector between radii r0, r1 and angles a0, a1 (radians). */
function sector(r0: number, r1: number, a0: number, a1: number, steps = 12): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; pts.push(new THREE.Vector2(r1 * Math.cos(a), r1 * Math.sin(a))); }
  for (let i = steps; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / steps; pts.push(new THREE.Vector2(r0 * Math.cos(a), r0 * Math.sin(a))); }
  return new THREE.Shape(pts);
}

/**
 * Closed solid swept around the z axis: the (r, z) profile polygon turned
 * from a0 to a1, with flat end caps.
 */
function sweep(profile: [number, number][], a0: number, a1: number, steps: number, z0: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const at = (r: number, z: number, a: number) => [r * Math.cos(a), r * Math.sin(a), z + z0];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const n = profile.length;
  for (let s = 0; s < steps; s++) {
    const t0 = a0 + ((a1 - a0) * s) / steps, t1 = a0 + ((a1 - a0) * (s + 1)) / steps;
    for (let i = 0; i < n; i++) {
      const [r1, z1] = profile[i], [r2, z2] = profile[(i + 1) % n];
      const p1 = at(r1, z1, t0), p2 = at(r2, z2, t0), p3 = at(r2, z2, t1), p4 = at(r1, z1, t1);
      tri(p1, p3, p2);
      tri(p1, p4, p3);
    }
  }
  // End caps (the profile may be concave: ear clipping).
  const faces = THREE.ShapeUtils.triangulateShape(profile.map(([r, z]) => new THREE.Vector2(r, z)), []);
  for (const [i, j, k] of faces) {
    const [ri, zi] = profile[i], [rj, zj] = profile[j], [rk, zk] = profile[k];
    tri(at(ri, zi, a0), at(rj, zj, a0), at(rk, zk, a0));
    tri(at(ri, zi, a1), at(rk, zk, a1), at(rj, zj, a1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Footprint of one spring arm: a strip of width w following a spiral from the root to the tip radius. */
function armShape(a0: number, w: number): THREE.Shape {
  const steps = 30;
  const rc = (t: number) => ARM_ROOT_R + (ARM_TIP_R - ARM_ROOT_R) * t;
  const outer: THREE.Vector2[] = [], inner: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = a0 + ARM_SWEEP * t, r = rc(t);
    outer.push(new THREE.Vector2((r + w / 2) * Math.cos(a), (r + w / 2) * Math.sin(a)));
    inner.push(new THREE.Vector2((r - w / 2) * Math.cos(a), (r - w / 2) * Math.sin(a)));
  }
  return new THREE.Shape([...outer, ...inner.reverse()]);
}

/** Base on z = 0, hub pointing up (+z). */
export function trayGeometry(p: TrayParams): THREE.BufferGeometry {
  const fit = HUB[p.fit];
  const parts: THREE.BufferGeometry[] = [];
  // Plate: cut out under the hub (the arms move there) and at two finger notches.
  const outline = p.test ? new THREE.Shape().absarc(0, 0, p.w / 2, 0, Math.PI * 2, false) : roundedRect(p.w, p.h, 3);
  outline.holes.push(circle(0, 0, HUB_HOLE_R, true));
  if (!p.test) for (const sx of [-1, 1]) outline.holes.push(circle(sx * NOTCH.x, 0, NOTCH.r, true));
  parts.push(extrude(outline, p.plate, 0));
  // Ring the disc rests on, at its clamping area.
  const ring = new THREE.Shape().absarc(0, 0, RING_OUT, 0, Math.PI * 2, false);
  ring.holes.push(circle(0, 0, RING_IN, true));
  parts.push(extrude(ring, RING_H + 0.05, p.plate - 0.05));
  // Spring arms: they stand on the build plate, below the disc, and bend sideways.
  const armTop = discZ(p) - 0.15;
  const z1 = discZ(p) + DISC_T + 0.05;
  const top = trayHeight(p);
  // Post profile (r, z): straight where the disc sits, a lip over it, then a lead-in chamfer.
  const post: [number, number][] = [
    [POST_IN_R, 0], [GRIP_R, 0], [GRIP_R, z1], [GRIP_R + fit.lip, z1 + 0.3], [GRIP_R + fit.lip, z1 + 0.5], [GRIP_R - 0.7, top], [POST_IN_R, top],
  ];
  for (let i = 0; i < ARMS; i++) {
    const a0 = (i * 2 * Math.PI) / ARMS;
    parts.push(extrude(armShape(a0, fit.arm), armTop, 0));
    // Anchor tying the arm root firmly into the plate rim.
    parts.push(extrude(sector(ARM_ROOT_R - fit.arm / 2, HUB_HOLE_R + 0.6, a0 - 0.17, a0 + 0.05), armTop, 0));
    const tip = a0 + ARM_SWEEP;
    parts.push(sweep(post, tip - POST_SPAN, tip + 0.02, 8, 0));
  }
  const merged = mergeGeometries(parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k);
    return ng;
  }));
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Expects non-indexed triangles, positions in mm. */
export function toSTL(g: THREE.BufferGeometry, name = 'Coverfold tray'): Uint8Array {
  const pos = g.attributes.position;
  const count = pos.count / 3;
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const header = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(header);
  dv.setUint32(80, count, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let o = 84;
  for (let i = 0; i < count; i++) {
    a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    for (const v of [n, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}
