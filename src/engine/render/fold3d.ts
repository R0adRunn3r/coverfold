// 3D preview of a piece with its artwork, folded along its fold lines.
// Plain three.js, loaded on demand.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { expandForPrint } from '../../core/expand';
import { insideView } from '../../core/faces';
import type { Piece } from '../../core/model';
import { buildDieline, getTemplate } from '../../core/templates/catalog';
import type { Dieline, Side } from '../../core/templates/types';
import type { TrayParams } from '../../core/tray';
import { trayGeometry } from '../tray3d';
import { buildFoldModel, POCKET_LIFT, poseFold, type Face, type Hinge } from './foldModel';
import { drawFace, preloadPreviews } from './preview';

const PAPER = 0xf4f2ee;

async function faceTexture(piece: Piece, side: Side, d: Dieline, mirror: boolean): Promise<THREE.CanvasTexture> {
  await preloadPreviews([piece]);
  const k = Math.min(5, 2048 / Math.max(d.w, d.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(d.w * k));
  canvas.height = Math.max(2, Math.round(d.h * k));
  const ctx = canvas.getContext('2d')!;
  drawFace(ctx, piece, side, 0, k, 0, 0);
  // Slits show as a fine dark cut, mirrored like the face when it is the inside.
  const slits = (mirror ? insideView(d) : d).slits ?? [];
  if (slits.length) {
    ctx.save();
    ctx.scale(k, k);
    ctx.strokeStyle = 'rgba(20,20,24,0.85)';
    ctx.lineWidth = 0.35;
    ctx.lineCap = 'round';
    for (const sl of slits) {
      ctx.beginPath();
      for (const s of sl) if (s.t === 'M') ctx.moveTo(s.x, s.y); else if (s.t === 'L') ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (mirror) {
    // The inside face is drawn as seen from inside (mirrored): flip it back onto the geometry.
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    tex.offset.x = 1;
  }
  return tex;
}

async function discLabelMaterial(disc: Piece): Promise<THREE.MeshStandardMaterial> {
  const tex = await faceTexture(disc, 'outside', buildDieline(disc.templateId, disc.params), false);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, alphaTest: 0.05 });
}

function faceGeometry(f: Face, d: Dieline): THREE.BufferGeometry {
  const shape = new THREE.Shape(f.poly.map((p) => new THREE.Vector2(p.x, -p.y)));
  const g = new THREE.ShapeGeometry(shape);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / d.w;
    uv[i * 2 + 1] = 1 + pos.getY(i) / d.h;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A paper pocket glued inside a panel; `piece` gives its artwork (plain paper when null). */
export interface PocketParams { panelId: string; w: number; h: number; piece: Piece | null }

/** Artwork of a pocket piece, cropped to the pocket itself (its glue tabs fold underneath). */
async function pocketTexture(pocket: Piece): Promise<THREE.CanvasTexture | null> {
  const d = buildDieline(pocket.templateId, pocket.params);
  const body = d.panels.find((p) => p.id === 'front');
  if (!body) return null;
  await preloadPreviews([pocket]);
  const k = Math.min(6, 1024 / Math.max(body.rect.w, body.rect.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(body.rect.w * k));
  canvas.height = Math.max(2, Math.round(body.rect.h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f2ee';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-body.rect.x * k, -body.rect.y * k);
  drawFace(ctx, pocket, 'outside', 0, k, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class FoldViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  private controls: OrbitControls;
  private model = new THREE.Group();
  private hinges: Hinge[] = [];
  private disposables: { dispose(): void }[] = [];
  private fold = 1;
  private raf = 0;
  /** Bumped by each setPiece: a slower earlier call sees it changed and gives up. */
  private token = 0;
  private ro: ResizeObserver;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0aa, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-200, 300, 500);
    this.scene.add(sun);
    const back = new THREE.DirectionalLight(0xffffff, 0.6);
    back.position.set(200, -100, -400);
    this.scene.add(back);
    this.scene.add(this.model);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private clear() {
    this.model.clear();
    this.hinges = [];
    for (const x of this.disposables) x.dispose();
    this.disposables = [];
  }

  /**
   * Booklets show their cover spread. With `extras.tray` a 3D-printed tray sits
   * inside the cover with a disc on it, dressed with `extras.disc` when given.
   */
  async setPiece(source: Piece, extras: { tray?: TrayParams | null; disc?: Piece | null; pocket?: PocketParams | null } = {}): Promise<void> {
    const token = ++this.token;
    const piece = expandForPrint([source])[0];
    const discLabel = extras.disc ? await discLabelMaterial(extras.disc) : null;
    const pocketArt = extras.pocket?.piece ? await pocketTexture(extras.pocket.piece) : null;
    if (token !== this.token) { discLabel?.map?.dispose(); discLabel?.dispose(); pocketArt?.dispose(); return; }
    this.clear();
    if (discLabel) this.disposables.push(discLabel, discLabel.map!);
    if (pocketArt) this.disposables.push(pocketArt);
    const d = buildDieline(piece.templateId, piece.params);
    const outside = await faceTexture(piece, 'outside', d, false);
    const hasInside = getTemplate(piece.templateId).sides.includes('inside');
    const inside = hasInside ? await faceTexture(piece, 'inside', d, true) : null;
    this.disposables.push(outside, ...(inside ? [inside] : []));
    const front = new THREE.MeshStandardMaterial({ map: outside, roughness: 0.75, side: THREE.FrontSide, alphaTest: 0.05 });
    const back = new THREE.MeshStandardMaterial({ map: inside, color: inside ? 0xffffff : PAPER, roughness: 0.85, side: THREE.BackSide, alphaTest: inside ? 0.05 : 0 });
    this.disposables.push(front, back);

    if (d.panels.some((p) => p.shape === 'disc')) {
      this.model.add(this.discGroup(d.w / 2, front));
      this.model.position.set(0, 0, 0);
    } else {
      const groups = this.buildFolded(d, front, back);
      if (extras.tray) this.addTray(d, groups, extras.tray, discLabel);
      if (extras.pocket) this.addPocket(d, groups, extras.pocket, pocketArt);
    }
    this.setFold(this.fold);
    this.frame();
  }

  /**
   * The printed tray glued on the inside of a panel, hub towards the inside,
   * and a disc on the hub. It moves with that panel when the cover folds.
   */
  private addTray(d: Dieline, groups: Map<string, THREE.Group>, tray: TrayParams, label: THREE.Material | null) {
    const panel = d.panels.find((p) => p.id === tray.panelId);
    const group = groups.get(tray.panelId);
    if (!panel || !group) return;
    const geo = trayGeometry(tray);
    const plastic = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.55, metalness: 0.05 });
    this.disposables.push(geo, plastic);
    const mesh = new THREE.Mesh(geo, plastic);
    // The tray stands on the inside face (-z) of the panel.
    mesh.rotation.x = Math.PI;
    mesh.position.set(panel.rect.x + panel.rect.w / 2, -(panel.rect.y + panel.rect.h / 2), -0.05);
    group.add(mesh);
    const disc = this.discGroup(58.5, label ?? new THREE.MeshStandardMaterial({ color: 0xe9ecf1, metalness: 0.6, roughness: 0.3 }));
    // Turned about the vertical axis, so the label reads upright from the inside.
    disc.rotation.y = Math.PI;
    disc.position.set(mesh.position.x, mesh.position.y, -(tray.plate + 0.8) - 1.25);
    group.add(disc);
  }

  /**
   * The paper pocket glued on the inside of a panel, centred, its open side
   * towards the fold it shares with the spine. Seen from inside, left and
   * right swap: the pocket's open (left) edge lands on the spine side.
   */
  private addPocket(d: Dieline, groups: Map<string, THREE.Group>, pocket: PocketParams, art: THREE.Texture | null) {
    const panel = d.panels.find((p) => p.id === pocket.panelId);
    const group = groups.get(pocket.panelId);
    if (!panel || !group) return;
    const geo = new THREE.PlaneGeometry(pocket.w, pocket.h);
    const paper = new THREE.MeshStandardMaterial({ map: art, color: art ? 0xffffff : PAPER, roughness: 0.85 });
    this.disposables.push(geo, paper);
    const mesh = new THREE.Mesh(geo, paper);
    // Facing the inside (-z): half a turn around y.
    mesh.rotation.y = Math.PI;
    const spineOnRight = panel.edges.right === 'fold';
    // Mirroring puts the open edge on the far side from where it is printed; keep it towards the spine.
    if (!spineOnRight) mesh.scale.x = -1;
    mesh.position.set(panel.rect.x + panel.rect.w / 2, -(panel.rect.y + panel.rect.h / 2), -POCKET_LIFT);
    group.add(mesh);
  }

  /** Returns each face's group by face id. */
  private buildFolded(d: Dieline, front: THREE.Material, back: THREE.Material): Map<string, THREE.Group> {
    const model = buildFoldModel(d);
    this.hinges = model.hinges;
    for (const f of model.faces) {
      const g = faceGeometry(f, d);
      this.disposables.push(g);
      model.anchors.get(f.id)!.add(new THREE.Mesh(g, front), new THREE.Mesh(g, back));
    }
    this.model.add(model.root);
    this.model.position.set(0, 0, 0);
    return model.groups;
  }

  /** Centred on the origin, label facing +z, silver underside. */
  private discGroup(labelR: number, label: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const hole = 7.5;
    // Ring UVs span the outer radius: the label texture (as wide as the label) fits as drawn.
    const top = new THREE.RingGeometry(hole, labelR, 96, 1);
    const silver = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 1.2, 96, 1, true), silver);
    base.rotation.x = Math.PI / 2;
    base.position.z = -0.6;
    const under = new THREE.Mesh(new THREE.RingGeometry(hole, 60, 96, 1), silver);
    under.position.z = -1.2;
    under.rotation.y = Math.PI;
    const labelMesh = new THREE.Mesh(top, label);
    labelMesh.position.z = 0.05;
    const bed = new THREE.Mesh(new THREE.RingGeometry(hole, 60, 96, 1), silver);
    group.add(base, under, bed, labelMesh);
    this.disposables.push(top, base.geometry, under.geometry, bed.geometry, silver);
    return group;
  }

  /** 0 is flat as printed, 1 assembled (see poseFold). */
  setFold(t: number): void {
    this.fold = Math.max(0, Math.min(1, t));
    poseFold(this.hinges, this.fold);
  }

  /** Three-quarter view of the whole model, from behind with `inside`. */
  frame(inside = false): void {
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.75 + 10;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    const dir = new THREE.Vector3(inside ? -0.45 : 0.45, 0.25, inside ? -1 : 1).normalize();
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = dist / 50;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
