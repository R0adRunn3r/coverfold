import Konva from 'konva';
import { layerPanel } from '../../core/align';
import { bleedShapePath } from '../../core/bleedShape';
import type { Path } from '../../core/geometry';
import { facePanels, panelAt, panelBleedRect, panelSafeRect } from '../../core/layout';
import { layerAssetIds, type ImageLayer, type Layer, type TextLayer } from '../../core/model';
import { cropSide, maxCropSize, type CropSide } from '../../core/crop';
import { filledMode, isPicturePanel } from '../../core/placement';
import { activeLayers, activePiece, type Editor, type EditorState } from '../../core/store';
import { splitFor } from '../../core/expand';
import { faceDieline, isMultiPage } from '../../core/faces';
import { wantedMargin } from '../../core/printPlan';
import { buildDieline } from '../../core/templates/catalog';
import type { Dieline, PanelDef, Side } from '../../core/templates/types';
import { t } from '../../i18n';
import { getPreview, loadPreview } from '../assets';
import { drawLayerLocal, type DrawEnv } from '../render/draw';
import { layoutText, textMode } from '../render/textLayout';

/** Side anchors that crop a picture, by the box side they move. */
const SIDE_OF: Record<string, CropSide | undefined> = { 'middle-left': 'left', 'middle-right': 'right', 'top-center': 'top', 'bottom-center': 'bottom' };
/** Ellipse masks are not side-cropped, so a circle stays a circle. */
const croppable = (l: ImageLayer) => l.mask?.shape !== 'ellipse';

export const ASSET_MIME = 'application/x-coverfold-asset';

export interface EditorCanvasOptions {
  onDropAsset(assetId: string, panelId: string | null, at: { x: number; y: number }): void;
  onDropFiles(files: File[], panelId: string | null, at: { x: number; y: number }): void;
  onViewChange?(zoom: number): void;
}

const CSS_PX_PER_MM = 96 / 25.4;
const SNAP_PX = 6;
const COLORS = {
  trim: '#d92d2d',
  bleed: '#2f6fd3',
  bleedTint: 'rgba(217, 45, 45, 0.10)',
  safe: '#2f9e5a',
  fold: '#5b6170',
  glue: 'rgba(91, 97, 112, 0.35)',
  label: '#2f5bd3',
  snap: '#e0338a',
  dropHi: 'rgba(47, 91, 211, 0.18)',
  seam: '#9333ea',
  seamTint: 'rgba(147, 51, 234, 0.12)',
};

function toPath2D(path: Path): Path2D {
  const p = new Path2D();
  for (const s of path) {
    if (s.t === 'M') p.moveTo(s.x, s.y);
    else if (s.t === 'L') p.lineTo(s.x, s.y);
    else if (s.t === 'C') p.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y);
    else p.closePath();
  }
  return p;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Editor canvas in plain Konva and DOM, no UI framework. Draws the active face
 * in millimetres (the stage is scaled) and writes changes back through editor commands.
 */
export class EditorCanvas {
  private stage: Konva.Stage;
  private paperLayer = new Konva.Layer({ listening: false });
  private contentLayer = new Konva.Layer();
  private overlayLayer = new Konva.Layer({ listening: false });
  private uiLayer = new Konva.Layer();
  private content = new Konva.Group();
  private transformer: Konva.Transformer;
  private snapLines = new Konva.Group({ listening: false });
  private dropHighlight = new Konva.Rect({ visible: false, fill: COLORS.dropHi, listening: false });
  private nodes = new Map<string, Konva.Shape>();
  private unsub: () => void;
  private ro: ResizeObserver;
  private scale = 1;
  private autoFit = true;
  private guides = true;
  private dieline: Dieline | null = null;
  private faceKey = '';
  private bleed = 3;
  private panning: { x: number; y: number } | null = null;
  /**
   * fills: the panel the layer filled at drag start (it will fill the panel it
   * is dropped on); target: that panel; clipWidth: the clip of an older
   * clipped layer, lifted while it moves.
   */
  private drag: { id: string; fills: PanelDef | null; target: PanelDef | null; clipWidth: number } | null = null;
  /** Side-handle crop in progress; max is where the picture ends (mm). */
  private cropping: { layer: ImageLayer; side: CropSide; max: number } | null = null;
  private spaceDown = false;
  private measureCtx = new OffscreenCanvas(8, 8).getContext('2d')!;
  private activeAnchor = '';

  constructor(private container: HTMLDivElement, private editor: Editor, private opts: EditorCanvasOptions) {
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.transformer = new Konva.Transformer({
      rotationSnaps: [0, 90, 180, 270],
      rotationSnapTolerance: 4,
      anchorSize: 9,
      borderStroke: '#2f5bd3',
      anchorStroke: '#2f5bd3',
      anchorCornerRadius: 2,
      ignoreStroke: true,
      flipEnabled: false,
    });
    this.transformer.on('transformstart', () => {
      this.activeAnchor = this.transformer.getActiveAnchor() ?? '';
      // Side handles crop a picture: it keeps its scale, the box shows more or less of it.
      const side = SIDE_OF[this.activeAnchor];
      const nodes = this.transformer.nodes();
      const layer = side && nodes.length === 1 ? this.layerById(nodes[0].id()) : undefined;
      this.cropping = layer?.type === 'image' && croppable(layer) && side ? { layer, side, max: maxCropSize(layer, side) } : null;
    });
    this.transformer.on('transformend', () => { this.cropping = null; });
    // A crop stops where the picture ends: an upright box lands exactly on the
    // edge, a turned one stays at its last valid size.
    this.transformer.boundBoxFunc((oldBox, newBox) => {
      const c = this.cropping;
      if (!c) return newBox;
      const horizontal = c.side === 'left' || c.side === 'right';
      const size = (horizontal ? newBox.width : newBox.height) / this.scale;
      if (size < 1) return oldBox;
      if (size <= c.max + 0.01) return newBox;
      if (Math.abs(newBox.rotation) > 1e-3) return oldBox;
      const max = c.max * this.scale;
      if (c.side === 'right') return { ...newBox, width: max };
      if (c.side === 'bottom') return { ...newBox, height: max };
      if (c.side === 'left') return { ...newBox, x: newBox.x + newBox.width - max, width: max };
      return { ...newBox, y: newBox.y + newBox.height - max, height: max };
    });
    this.contentLayer.add(this.content);
    this.uiLayer.add(this.dropHighlight, this.snapLines, this.transformer);
    this.stage.add(this.paperLayer, this.contentLayer, this.overlayLayer, this.uiLayer);

    this.bindStageEvents();
    this.bindDom();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.unsub = editor.store.subscribe((s, prev) => this.sync(s, prev));
    this.sync(editor.store.getState(), null);
  }

  destroy(): void {
    this.unsub();
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.stage.destroy();
  }

  get zoom(): number { return this.scale / CSS_PX_PER_MM; }

  zoomToFit(): void {
    if (!this.dieline) return;
    this.autoFit = true;
    const pad = 48;
    const w = this.dieline.w + 2 * this.bleed;
    const h = this.dieline.h + 2 * this.bleed;
    const s = Math.max(0.2, Math.min((this.stage.width() - 2 * pad) / w, (this.stage.height() - 2 * pad) / h));
    this.setView(s, (this.stage.width() - this.dieline.w * s) / 2, (this.stage.height() - this.dieline.h * s) / 2);
  }

  /** 1 mm on screen is about 1 mm on paper (assuming 96 CSS px per inch). */
  zoomReal(): void {
    this.zoomAt(CSS_PX_PER_MM, { x: this.stage.width() / 2, y: this.stage.height() / 2 });
  }

  zoomBy(factor: number): void {
    this.zoomAt(this.scale * factor, { x: this.stage.width() / 2, y: this.stage.height() / 2 });
  }

  setGuidesVisible(v: boolean): void {
    this.guides = v;
    this.overlayLayer.visible(v);
  }

  private zoomAt(next: number, pivot: { x: number; y: number }) {
    this.autoFit = false;
    const s = Math.max(0.3, Math.min(60, next));
    const pos = this.stage.position();
    const mx = (pivot.x - pos.x) / this.scale;
    const my = (pivot.y - pos.y) / this.scale;
    this.setView(s, pivot.x - mx * s, pivot.y - my * s);
  }

  private setView(s: number, x: number, y: number) {
    this.scale = s;
    this.stage.scale({ x: s, y: s });
    this.stage.position({ x, y });
    this.transformer.anchorSize(9);
    this.drawOverlay();
    this.stage.batchDraw();
    this.opts.onViewChange?.(this.zoom);
  }

  private resize() {
    this.stage.size({ width: this.container.clientWidth, height: this.container.clientHeight });
    if (this.autoFit) this.zoomToFit();
    else this.stage.batchDraw();
  }

  private env(): DrawEnv | null {
    const s = this.editor.store.getState();
    if (!this.dieline) return null;
    return { dieline: this.dieline, bleed: this.bleed, side: s.selection.side, getImage: (id) => getPreview(id) };
  }

  private sync(s: EditorState, prev: EditorState | null) {
    const piece = activePiece(s);
    if (!piece || !s.project) {
      this.dieline = null;
      this.content.destroyChildren();
      this.nodes.clear();
      this.transformer.nodes([]);
      this.paperLayer.destroyChildren();
      this.overlayLayer.destroyChildren();
      this.stage.batchDraw();
      return;
    }
    const d = faceDieline(piece, s.selection.side);
    const pr = s.project.print;
    // Print settings decide where a wide piece is split into sheets (seams drawn on the overlay).
    const faceKey = `${piece.id}|${s.selection.side}|${d.w}x${d.h}|${pr.bleed}|${pr.printerMargin}|${pr.cropMarks}|${pr.foldMarks}|${pr.cutLine}|${JSON.stringify(piece.params)}`;
    const faceChanged = faceKey !== this.faceKey;
    this.dieline = d;
    this.bleed = s.project.print.bleed;
    if (faceChanged) {
      this.faceKey = faceKey;
      this.drawPaper();
      this.content.clipFunc(() => [toPath2D(bleedShapePath(d, this.bleed)), 'evenodd']);
      if (this.autoFit || !prev || activePiece(prev)?.id !== piece.id) this.zoomToFit();
      else this.drawOverlay();
    }
    const layersChanged = !prev || faceChanged || activeLayers(prev) !== activeLayers(s);
    if (layersChanged) this.buildNodes(activeLayers(s));
    if (layersChanged || !prev || prev.selection.layerIds !== s.selection.layerIds) this.syncSelection(s);
    this.stage.batchDraw();
  }

  private buildNodes(layers: Layer[]) {
    const env = this.env();
    if (!env) return;
    this.content.destroyChildren();
    this.nodes.clear();
    // White paper inside the content canvas too: blend modes mix with it as
    // they do with the white page of the export.
    this.content.add(new Konva.Rect({ x: -env.bleed - 1, y: -env.bleed - 1, width: env.dieline.w + 2 * env.bleed + 2, height: env.dieline.h + 2 * env.bleed + 2, fill: '#ffffff', listening: false }));
    for (const layer of layers) {
      for (const id of layerAssetIds(layer)) {
        if (!getPreview(id)) void loadPreview(id).then((bmp) => { if (bmp) this.contentLayer.batchDraw(); });
      }
      if (layer.type === 'text') this.measureText(layer);
      const clipRect = layer.clip ? facePanels(env.dieline, env.side).find((p) => p.id === layer.clip!.panelId) : undefined;
      const group = new Konva.Group(clipRect ? (() => {
        const r = panelBleedRect(clipRect, env.bleed);
        return { clip: { x: r.x, y: r.y, width: r.w, height: r.h } };
      })() : {});
      const node = new Konva.Shape({
        id: layer.id,
        x: layer.x + layer.w / 2,
        y: layer.y + layer.h / 2,
        offsetX: layer.w / 2,
        offsetY: layer.h / 2,
        width: layer.w,
        height: layer.h,
        rotation: layer.rotation,
        opacity: layer.opacity,
        visible: layer.visible,
        draggable: !layer.locked,
        fill: '#000',
        perfectDrawEnabled: false,
        sceneFunc: (ctx, shape) => {
          const current = this.layerById(shape.id());
          const e = this.env();
          if (!current || !e) return;
          // During a side-handle crop, draw the crop it will get at the old size: the
          // handle's stretch then keeps the picture scale, with no distortion.
          const live = shape.getAttr('liveCrop') as ImageLayer['crop'] | undefined;
          drawLayerLocal(ctx._context, { ...current, ...(live ? { crop: live } : {}), w: shape.width(), h: shape.height() } as Layer, e);
        },
        hitFunc: (ctx, shape) => {
          ctx.beginPath();
          ctx.rect(0, 0, shape.width(), shape.height());
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        },
      });
      node.on('mousedown touchstart', (e) => this.onNodeDown(layer.id, e.evt as MouseEvent));
      node.on('dragstart', () => this.onDragStart(layer.id, group));
      node.on('dragmove', () => { this.snap(node); this.trackPanel(node); });
      node.on('dragend', () => this.onDragEnd(node, group));
      node.on('transform', () => {
        const c = this.cropping;
        if (!c || c.layer.id !== layer.id) return;
        const horizontal = c.side === 'left' || c.side === 'right';
        node.setAttr('liveCrop', cropSide(c.layer, c.side, horizontal ? c.layer.w * node.scaleX() : c.layer.h * node.scaleY()).crop);
      });
      node.on('transformend', () => this.commitNodes());
      group.add(node);
      this.content.add(group);
      this.nodes.set(layer.id, node);
    }
  }

  private layerById(id: string): Layer | undefined {
    return activeLayers(this.editor.store.getState()).find((l) => l.id === id);
  }

  /** Text boxes grow with their content; the height is derived, not edited. */
  private measureText(layer: TextLayer) {
    if (textMode(layer) === 'arc') return;
    const h = layoutText(this.measureCtx, layer).height;
    if (Math.abs(h - layer.h) > 0.05) queueMicrotask(() => this.editor.patchSilently(layer.id, { h }));
  }

  private syncSelection(s: EditorState) {
    const selected = s.selection.layerIds.map((id) => this.nodes.get(id)).filter((n): n is Konva.Shape => !!n && n.draggable());
    this.transformer.nodes(selected);
    const layers = activeLayers(s).filter((l) => s.selection.layerIds.includes(l.id));
    // Images and QR codes keep their proportions; a single picture gets side handles to crop it.
    const onlyImages = layers.length > 0 && layers.every((l) => l.type === 'image' || l.type === 'qr');
    const anyText = layers.some((l) => l.type === 'text');
    const crop = layers.length === 1 && layers[0].type === 'image' && croppable(layers[0]);
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    this.transformer.keepRatio(onlyImages);
    this.transformer.enabledAnchors(crop
      ? [...corners, 'top-center', 'middle-left', 'middle-right', 'bottom-center']
      : onlyImages ? corners
        : anyText ? [...corners, 'middle-left', 'middle-right']
          : ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']);
    this.uiLayer.batchDraw();
  }

  private onDragStart(id: string, group: Konva.Group) {
    const layer = this.layerById(id);
    const d = this.dieline;
    if (!layer || !d) return;
    const side = this.editor.store.getState().selection.side;
    const from = this.transformer.nodes().length <= 1 ? layerPanel(layer, d, side) : undefined;
    const fills = from && isPicturePanel(from) && filledMode(layer, from, this.bleed) ? from : null;
    // An older clipped layer would vanish as it leaves its panel: show it whole while it moves.
    const clipWidth = group.clipWidth() ?? 0;
    if (clipWidth) group.clipWidth(0);
    this.drag = { id, fills, target: null, clipWidth };
  }

  /** While a layer that fills its panel is dragged, light up the panel it would fill on release. */
  private trackPanel(node: Konva.Shape) {
    const drag = this.drag;
    if (!drag?.fills || !this.dieline) return;
    const side = this.editor.store.getState().selection.side;
    const p = panelAt(this.dieline, side, node.x(), node.y());
    drag.target = p && p.id !== drag.fills.id && isPicturePanel(p) ? p : null;
    if (drag.target) {
      const r = panelBleedRect(drag.target, this.bleed);
      this.dropHighlight.setAttrs({ x: r.x, y: r.y, width: r.w, height: r.h, visible: true });
    } else this.dropHighlight.visible(false);
  }

  private onDragEnd(node: Konva.Shape, group: Konva.Group) {
    const drag = this.drag;
    this.drag = null;
    this.dropHighlight.visible(false);
    if (drag?.clipWidth) group.clipWidth(drag.clipWidth);
    const layer = drag && this.layerById(drag.id);
    if (drag?.target && layer) {
      // Dropped on another panel: it fills that one (one undo step, framing kept).
      this.snapLines.destroyChildren();
      node.position({ x: layer.x + layer.w / 2, y: layer.y + layer.h / 2 });
      this.editor.moveToPanel(drag.id, drag.target.id);
      return;
    }
    this.commitNodes();
  }

  /** Writes node geometry back to the store, folding the Konva scale into w and h. */
  private commitNodes() {
    this.snapLines.destroyChildren();
    const patches: { id: string; patch: Partial<Layer> }[] = [];
    const side = this.editor.store.getState().selection.side;
    for (const [id, node] of this.nodes) {
      const layer = this.layerById(id);
      if (!layer) continue;
      const sx = node.scaleX(), sy = node.scaleY();
      const w = layer.w * sx, h = layer.h * sy;
      const x = node.x() - w / 2, y = node.y() - h / 2;
      const rotation = ((node.rotation() % 360) + 360) % 360;
      if (Math.abs(x - layer.x) < 1e-6 && Math.abs(y - layer.y) < 1e-6 && Math.abs(w - layer.w) < 1e-6 && Math.abs(h - layer.h) < 1e-6 && Math.abs(rotation - layer.rotation) < 1e-6) continue;
      const patch: Partial<Layer> = { x, y, w, h, rotation };
      const moved = SIDE_OF[this.activeAnchor];
      if (layer.type === 'image' && moved && croppable(layer) && (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6)) {
        (patch as Partial<ImageLayer>).crop = cropSide(layer, moved, moved === 'left' || moved === 'right' ? w : h).crop;
        node.setAttr('liveCrop', undefined);
      }
      // An older clipped layer follows to the panel it is moved onto, so it never disappears.
      if (layer.clip && this.dieline) {
        const p = panelAt(this.dieline, side, x + w / 2, y + h / 2);
        if (p?.id !== layer.clip.panelId) patch.clip = p ? { panelId: p.id } : null;
      }
      if (layer.type === 'text') {
        // Corner handles scale the type, side handles only rewrap it.
        if (!this.activeAnchor.startsWith('middle') && Math.abs(sy - 1) > 1e-3) (patch as Partial<TextLayer>).fontSize = Math.max(2, layer.fontSize * sy);
      }
      patches.push({ id, patch });
      node.scale({ x: 1, y: 1 });
    }
    if (patches.length) this.editor.updateLayers(patches);
  }

  private snapTargets(): { xs: number[]; ys: number[] } {
    const d = this.dieline!;
    const side = this.editor.store.getState().selection.side;
    const xs = [0, d.w, d.w / 2], ys = [0, d.h, d.h / 2];
    for (const p of facePanels(d, side)) {
      const b = panelBleedRect(p, this.bleed), sf = panelSafeRect(p);
      xs.push(p.rect.x, p.rect.x + p.rect.w, p.rect.x + p.rect.w / 2, b.x, b.x + b.w, sf.x, sf.x + sf.w);
      ys.push(p.rect.y, p.rect.y + p.rect.h, p.rect.y + p.rect.h / 2, b.y, b.y + b.h, sf.y, sf.y + sf.h);
    }
    return { xs, ys };
  }

  private snap(node: Konva.Shape) {
    this.snapLines.destroyChildren();
    if (!this.dieline || this.transformer.nodes().length > 1 || Math.abs(node.rotation() % 90) > 0.01) return;
    const { xs, ys } = this.snapTargets();
    const tol = SNAP_PX / this.scale;
    const w = node.width() * node.scaleX(), h = node.height() * node.scaleY();
    const quarter = Math.round(node.rotation() / 90) % 2 !== 0;
    const bw = quarter ? h : w, bh = quarter ? w : h;
    const cx = node.x(), cy = node.y();
    const pick = (cands: number[], edges: number[]) => {
      let best: { delta: number; at: number } | null = null;
      for (const c of cands) for (const e of edges) {
        const delta = c - e;
        if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: c };
      }
      return best;
    };
    const bx = pick(xs, [cx - bw / 2, cx, cx + bw / 2]);
    const by = pick(ys, [cy - bh / 2, cy, cy + bh / 2]);
    if (bx) node.x(cx + bx.delta);
    if (by) node.y(cy + by.delta);
    const d = this.dieline;
    const sw = 1 / this.scale;
    if (bx) this.snapLines.add(new Konva.Line({ points: [bx.at, -this.bleed - 5, bx.at, d.h + this.bleed + 5], stroke: COLORS.snap, strokeWidth: sw }));
    if (by) this.snapLines.add(new Konva.Line({ points: [-this.bleed - 5, by.at, d.w + this.bleed + 5, by.at], stroke: COLORS.snap, strokeWidth: sw }));
  }

  private drawPaper() {
    this.paperLayer.destroyChildren();
    const d = this.dieline!;
    const bleed = this.bleed;
    this.paperLayer.add(new Konva.Shape({
      sceneFunc: (ctx) => {
        const c = ctx._context;
        c.save();
        c.shadowColor = 'rgba(0,0,0,0.18)';
        c.shadowBlur = 12;
        c.shadowOffsetY = 2;
        c.fillStyle = '#ffffff';
        c.fill(toPath2D(bleedShapePath(d, bleed)), 'evenodd');
        c.restore();
      },
    }));
    this.paperLayer.batchDraw();
  }

  private drawOverlay() {
    this.overlayLayer.destroyChildren();
    const d = this.dieline;
    if (!d) return;
    const s = this.editor.store.getState();
    const side: Side = s.selection.side;
    const px = 1 / this.scale;
    const bleed = this.bleed;
    const panels = facePanels(d, side);
    this.overlayLayer.add(new Konva.Shape({
      sceneFunc: (kctx) => {
        const c = kctx._context;
        c.save();
        // Bleed band, cut off when trimmed.
        const band = new Path2D();
        band.addPath(toPath2D(bleedShapePath(d, bleed)));
        band.addPath(toPath2D(d.cut));
        c.fillStyle = COLORS.bleedTint;
        c.fill(band, 'evenodd');
        c.setLineDash([4 * px, 3 * px]);
        c.lineWidth = px;
        c.strokeStyle = COLORS.bleed;
        c.stroke(toPath2D(bleedShapePath(d, bleed)));
        c.setLineDash([1.5 * px, 2.5 * px]);
        c.strokeStyle = COLORS.safe;
        for (const p of panels) {
          if (p.shape === 'disc' || p.labelKey === 'panel.hidden') continue;
          const r = panelSafeRect(p);
          c.strokeRect(r.x, r.y, r.w, r.h);
        }
        for (const g of d.safeGuides) c.stroke(toPath2D(g));
        c.setLineDash([5 * px, 3 * px]);
        c.strokeStyle = COLORS.fold;
        for (const f of d.folds) {
          c.beginPath();
          c.moveTo(f.x1, f.y1);
          c.lineTo(f.x2, f.y2);
          c.stroke();
        }
        // Glue zones, hatched.
        if (side === 'outside') {
          c.setLineDash([]);
          for (const g of d.glue) {
            c.save();
            c.clip(toPath2D(g));
            c.strokeStyle = COLORS.glue;
            c.lineWidth = px;
            for (let x = -d.h; x < d.w + d.h; x += 3) {
              c.beginPath();
              c.moveTo(x, 0);
              c.lineTo(x + d.h, d.h);
              c.stroke();
            }
            c.restore();
          }
        }
        for (const p of panels) {
          if (p.labelKey !== 'panel.hidden') continue;
          c.fillStyle = 'rgba(120,120,120,0.12)';
          c.fillRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
        }
        c.setLineDash([]);
        c.lineWidth = 1.2 * px;
        c.strokeStyle = COLORS.trim;
        c.stroke(toPath2D(d.cut));
        for (const sl of d.slits ?? []) c.stroke(toPath2D(sl));
        c.fillStyle = COLORS.label;
        c.font = `600 ${11 * px}px Inter, sans-serif`;
        c.textBaseline = 'top';
        for (const p of panels) this.drawPanelLabel(c, p, px);
        this.drawSeams(c, d, side, px);
        if (side === 'outside' && d.glue.length) {
          c.textAlign = 'center';
          c.fillStyle = 'rgba(70,74,84,0.8)';
          for (const g of d.glue) {
            const pts = g.filter((x): x is Extract<typeof x, { x: number }> => 'x' in x);
            const gx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
            const gy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
            c.textBaseline = 'middle';
            c.fillText(t('editor.glue'), gx, gy);
          }
        }
        c.restore();
      },
    }));
    this.overlayLayer.visible(this.guides);
    this.overlayLayer.batchDraw();
  }

  /**
   * Where a piece wider than A4 is split into sheets: a line at each seam and,
   * on the inside, the strip the glue tab will cover.
   */
  private drawSeams(c: CanvasRenderingContext2D, d: Dieline, side: Side, px: number) {
    const s = this.editor.store.getState();
    const piece = activePiece(s);
    if (!piece || !s.project || isMultiPage(piece) || (side !== 'outside' && side !== 'inside')) return;
    const pr = s.project.print;
    // Seams are chosen on the outside layout; the inside view shows them mirrored.
    const ranges = splitFor(buildDieline(piece.templateId, piece.params), { printerMargin: pr.printerMargin, margin: wantedMargin(pr), minMargin: pr.bleed });
    if (!ranges) return;
    const bleed = this.bleed;
    c.save();
    ranges.slice(0, -1).forEach((r, i) => {
      const x = side === 'inside' ? d.w - r.x1 : r.x1;
      if (side === 'inside') {
        c.fillStyle = COLORS.seamTint;
        c.fillRect(x - r.tab, 0, r.tab, d.h);
      }
      c.setLineDash([8 * px, 4 * px]);
      c.lineWidth = 1.5 * px;
      c.strokeStyle = COLORS.seam;
      c.beginPath();
      c.moveTo(x, -bleed - 8 * px);
      c.lineTo(x, d.h + bleed + 8 * px);
      c.stroke();
      const label = t('editor.seam', { n: i + 1, m: i + 2 });
      c.font = `600 ${11 * px}px Inter, sans-serif`;
      const w = c.measureText(label).width + 8 * px;
      const y = -bleed - 26 * px;
      c.setLineDash([]);
      c.fillStyle = COLORS.seam;
      c.beginPath();
      c.roundRect(x - w / 2, y, w, 16 * px, 4 * px);
      c.fill();
      c.fillStyle = '#ffffff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, x, y + 8.5 * px);
    });
    c.restore();
  }

  private drawPanelLabel(c: CanvasRenderingContext2D, p: PanelDef, px: number) {
    const label = t(p.labelKey, p.labelVars ?? {}).toUpperCase();
    const pad = 3 * px;
    const h = 15 * px;
    const w = c.measureText(label).width + 2 * pad;
    const vertical = p.rect.w < w + 8 * px && p.rect.h > p.rect.w;
    c.save();
    if (p.orientation === 180) {
      // Upside-down panel: the label is upside down too, so the flat layout reads like the folded piece.
      c.translate(p.rect.x + p.rect.w - 4 * px, p.rect.y + p.rect.h - 4 * px);
      c.rotate(Math.PI);
    } else if (vertical) {
      c.translate(p.rect.x + p.rect.w / 2 + h / 2, p.rect.y + 4 * px);
      c.rotate(Math.PI / 2);
    } else if (p.shape === 'disc') {
      c.translate(p.rect.x + p.rect.w / 2 - w / 2, p.rect.y + 6 * px);
    } else {
      c.translate(p.rect.x + 4 * px, p.rect.y + 4 * px);
    }
    // A pill behind the text keeps it readable over any artwork.
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.roundRect(0, 0, w, h, 4 * px);
    c.fill();
    c.fillStyle = COLORS.label;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(label, pad, h / 2 + 0.5 * px);
    c.restore();
  }

  private onNodeDown(id: string, evt: MouseEvent) {
    const s = this.editor.store.getState();
    if (evt.shiftKey || evt.ctrlKey || evt.metaKey) this.editor.toggleSelect(id);
    else if (!s.selection.layerIds.includes(id)) this.editor.select([id]);
  }

  private bindStageEvents() {
    this.stage.on('mousedown touchstart', (e) => {
      const evt = e.evt as MouseEvent;
      if (evt.button === 1 || this.spaceDown) {
        this.panning = { x: evt.clientX, y: evt.clientY };
        evt.preventDefault();
        return;
      }
      if (e.target === this.stage) this.editor.select([]);
    });
    this.stage.on('mousemove', (e) => {
      if (!this.panning) return;
      const evt = e.evt as MouseEvent;
      const pos = this.stage.position();
      this.autoFit = false;
      this.stage.position({ x: pos.x + evt.clientX - this.panning.x, y: pos.y + evt.clientY - this.panning.y });
      this.panning = { x: evt.clientX, y: evt.clientY };
      this.stage.batchDraw();
    });
    this.stage.on('mouseup mouseleave', () => { this.panning = null; });
    this.stage.on('wheel', (e) => {
      const evt = e.evt as WheelEvent;
      evt.preventDefault();
      if (evt.ctrlKey || evt.metaKey) {
        const pointer = this.stage.getPointerPosition() ?? { x: this.stage.width() / 2, y: this.stage.height() / 2 };
        this.zoomAt(this.scale * Math.exp(-evt.deltaY * 0.0015), pointer);
      } else {
        this.autoFit = false;
        const pos = this.stage.position();
        this.stage.position({ x: pos.x - (evt.shiftKey ? evt.deltaY : evt.deltaX), y: pos.y - (evt.shiftKey ? 0 : evt.deltaY) });
        this.stage.batchDraw();
      }
    });
  }

  private pointerMm(evt: DragEvent): { x: number; y: number } {
    this.stage.setPointersPositions(evt);
    const p = this.stage.getPointerPosition() ?? { x: 0, y: 0 };
    const pos = this.stage.position();
    return { x: (p.x - pos.x) / this.scale, y: (p.y - pos.y) / this.scale };
  }

  private panelUnder(at: { x: number; y: number }): PanelDef | undefined {
    if (!this.dieline) return undefined;
    const side = this.editor.store.getState().selection.side;
    return panelAt(this.dieline, side, at.x, at.y);
  }

  private onDragOver = (evt: DragEvent) => {
    if (!evt.dataTransfer) return;
    const types = [...evt.dataTransfer.types];
    if (!types.includes(ASSET_MIME) && !types.includes('Files')) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
    const panel = this.panelUnder(this.pointerMm(evt));
    if (panel) {
      const r = panelBleedRect(panel, this.bleed);
      this.dropHighlight.setAttrs({ x: r.x, y: r.y, width: r.w, height: r.h, visible: true });
    } else this.dropHighlight.visible(false);
    this.uiLayer.batchDraw();
  };

  private onDragLeave = () => {
    this.dropHighlight.visible(false);
    this.uiLayer.batchDraw();
  };

  private onDrop = (evt: DragEvent) => {
    if (!evt.dataTransfer) return;
    evt.preventDefault();
    this.onDragLeave();
    const at = this.pointerMm(evt);
    const panel = this.panelUnder(at);
    const assetId = evt.dataTransfer.getData(ASSET_MIME);
    if (assetId) this.opts.onDropAsset(assetId, panel?.id ?? null, at);
    else if (evt.dataTransfer.files.length) this.opts.onDropFiles([...evt.dataTransfer.files], panel?.id ?? null, at);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    if (e.code === 'Space') {
      this.spaceDown = true;
      this.content.listening(false);
      this.container.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    const ed = this.editor;
    const s = ed.store.getState();
    const ids = s.selection.layerIds;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); ed.redo(); return; }
    if (mod && e.key === '0') { e.preventDefault(); this.zoomToFit(); return; }
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); this.zoomBy(1.25); return; }
    if (mod && e.key === '-') { e.preventDefault(); this.zoomBy(0.8); return; }
    if (!ids.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ed.removeLayers(ids); return; }
    if (e.key === 'Escape') { ed.select([]); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); ed.duplicateLayers(ids); return; }
    if (mod && e.key === ']') { e.preventDefault(); ed.arrange(ids, e.shiftKey ? 'front' : 'forward'); return; }
    if (mod && e.key === '[') { e.preventDefault(); ed.arrange(ids, e.shiftKey ? 'back' : 'backward'); return; }
    const step = e.shiftKey ? 5 : 0.5;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (delta) {
      e.preventDefault();
      const layers = activeLayers(s).filter((l) => ids.includes(l.id) && !l.locked);
      ed.updateLayers(layers.map((l) => ({ id: l.id, patch: { x: l.x + delta[0], y: l.y + delta[1] } })), 'nudge');
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.content.listening(true);
      this.container.style.cursor = '';
    }
  };

  private bindDom() {
    const el = this.container;
    el.addEventListener('dragover', this.onDragOver);
    el.addEventListener('dragleave', this.onDragLeave);
    el.addEventListener('drop', this.onDrop);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }
}
