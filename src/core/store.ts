import { createStore, type StoreApi } from 'zustand/vanilla';
import { alignLayers, alignTarget, layerPanel, type AlignHow, type AlignTo } from './align';
import { cropFor, sameProportions } from './crop';
import { ensureFace, faceDieline, faceIds, faceLayers } from './faces';
import { findPanel, type FitMode } from './layout';
import { filledMode, fitPatch, movePatch } from './placement';
import {
  makeImageLayer, makePiece, newId,
  type Layer, type Piece, type PrintSettings, type Project,
} from './model';
import type { PaperKind, Side } from './templates/types';

export interface Selection {
  pieceId: string | null;
  side: Side;
  layerIds: string[];
}

export interface EditorState {
  project: Project | null;
  selection: Selection;
  past: Project[];
  future: Project[];
  /** Consecutive edits with the same key (e.g. dragging a slider) merge into one undo step. */
  coalesce: { key: string; at: number } | null;
}

export type EditorStore = StoreApi<EditorState>;

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

export const activePiece = (s: EditorState): Piece | null =>
  s.project?.pieces.find((p) => p.id === s.selection.pieceId) ?? null;

const NO_LAYERS: Layer[] = [];

export const activeLayers = (s: EditorState): Layer[] => {
  const piece = activePiece(s);
  return piece ? faceLayers(piece, s.selection.side) : NO_LAYERS;
};

export const selectedLayers = (s: EditorState): Layer[] => {
  const ids = new Set(s.selection.layerIds);
  return activeLayers(s).filter((l) => ids.has(l.id));
};

export type ArrangeOp = 'front' | 'forward' | 'backward' | 'back';

/** A face of a piece of the project (the active one when left out). */
export interface FaceRef { pieceId: string; side: Side }

export function createEditor() {
  const store = createStore<EditorState>(() => ({
    project: null,
    selection: { pieceId: null, side: 'outside', layerIds: [] },
    past: [],
    future: [],
    coalesce: null,
  }));

  const get = store.getState;
  const set = store.setState;

  /** Nesting depth of batch(); while it is above 0 every change joins one undo step. */
  let batching = 0;

  /** Applies an undoable change to a copy of the project. */
  function commit(mutate: (p: Project) => void, coalesceKey?: string): void {
    const s = get();
    if (!s.project) return;
    const next = structuredClone(s.project);
    mutate(next);
    next.updatedAt = Date.now();
    const now = Date.now();
    const merge = batching > 0 || (!!coalesceKey && s.coalesce?.key === coalesceKey && now - s.coalesce.at < COALESCE_MS);
    set({
      project: next,
      past: merge ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      coalesce: coalesceKey && !batching ? { key: coalesceKey, at: now } : null,
    });
  }

  /** Runs `fn` on the layers of a face (the active one by default). */
  function onTarget(target: FaceRef | undefined, fn: (layers: Layer[], piece: Piece) => void, coalesceKey?: string) {
    const { selection } = get();
    const ref = target ?? (selection.pieceId ? { pieceId: selection.pieceId, side: selection.side } : null);
    if (!ref) return;
    commit((p) => {
      const piece = p.pieces.find((x) => x.id === ref.pieceId);
      if (piece) fn(ensureFace(piece, ref.side), piece);
    }, coalesceKey);
  }

  /** Piece and face a change goes to, with its dieline. */
  function resolve(target?: FaceRef) {
    const s = get();
    const piece = target ? s.project?.pieces.find((x) => x.id === target.pieceId) ?? null : activePiece(s);
    if (!piece || !s.project) return null;
    const side = target?.side ?? s.selection.side;
    return { piece, side, d: faceDieline(piece, side), bleed: s.project.print.bleed };
  }

  function onFace(fn: (layers: Layer[], piece: Piece) => void, coalesceKey?: string) {
    onTarget(undefined, fn, coalesceKey);
  }

  function validSelection(project: Project | null, sel: Selection): Selection {
    if (!project) return { pieceId: null, side: 'outside', layerIds: [] };
    const piece = project.pieces.find((p) => p.id === sel.pieceId) ?? project.pieces[0] ?? null;
    if (!piece) return { pieceId: null, side: 'outside', layerIds: [] };
    const faces = faceIds(piece);
    const side = faces.includes(sel.side) ? sel.side : faces[0];
    const ids = new Set(faceLayers(piece, side).map((l) => l.id));
    return { pieceId: piece.id, side, layerIds: sel.layerIds.filter((id) => ids.has(id)) };
  }

  const api = {
    store,

    load(project: Project) {
      set({ project, past: [], future: [], coalesce: null, selection: validSelection(project, { pieceId: null, side: 'outside', layerIds: [] }) });
    },

    close() {
      set({ project: null, past: [], future: [], coalesce: null, selection: { pieceId: null, side: 'outside', layerIds: [] } });
    },

    undo() {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev || !s.project) return;
      set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], coalesce: null, selection: validSelection(prev, s.selection) });
    },

    redo() {
      const s = get();
      const next = s.future[0];
      if (!next || !s.project) return;
      set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), coalesce: null, selection: validSelection(next, s.selection) });
    },

    rename(name: string) {
      commit((p) => { p.name = name; }, 'rename');
    },

    /** Adds a piece; it becomes the open one unless `open` is false. */
    addPiece(templateId: string, params: Record<string, number> = {}, open = true) {
      const piece = makePiece(templateId, params);
      commit((p) => { p.pieces.push(piece); });
      if (open) set({ selection: validSelection(get().project, { pieceId: piece.id, side: 'outside', layerIds: [] }) });
      return piece.id;
    },

    removePiece(id: string) {
      commit((p) => { p.pieces = p.pieces.filter((x) => x.id !== id); });
      set({ selection: validSelection(get().project, { ...get().selection, pieceId: get().selection.pieceId === id ? null : get().selection.pieceId }) });
    },

    setPieceParams(id: string, params: Record<string, number>) {
      commit((p) => {
        const piece = p.pieces.find((x) => x.id === id);
        if (piece) piece.params = { ...piece.params, ...params };
      }, `params:${id}`);
      set({ selection: validSelection(get().project, get().selection) });
    },

    setPiecePaper(id: string, paper: PaperKind | null) {
      commit((p) => {
        const piece = p.pieces.find((x) => x.id === id);
        if (piece) piece.paper = paper;
      });
    },

    setPieceCopies(id: string, copies: number) {
      commit((p) => {
        const piece = p.pieces.find((x) => x.id === id);
        if (piece) piece.copies = Math.max(1, Math.min(20, Math.round(copies)));
      }, `copies:${id}`);
    },

    selectPiece(id: string) {
      set({ selection: validSelection(get().project, { pieceId: id, side: 'outside', layerIds: [] }) });
    },

    setSide(side: Side) {
      set({ selection: validSelection(get().project, { ...get().selection, side, layerIds: [] }) });
    },

    select(layerIds: string[]) {
      set({ selection: { ...get().selection, layerIds } });
    },

    toggleSelect(layerId: string) {
      const ids = get().selection.layerIds;
      set({ selection: { ...get().selection, layerIds: ids.includes(layerId) ? ids.filter((i) => i !== layerId) : [...ids, layerId] } });
    },

    /** Runs several changes as one undo step, e.g. an album import across several pieces. */
    batch<T>(fn: () => T): T {
      const s = get();
      if (!s.project || batching) {
        batching++;
        try { return fn(); } finally { batching--; }
      }
      const before = s.project, past = s.past;
      batching++;
      try {
        return fn();
      } finally {
        batching--;
        if (get().project !== before) set({ past: [...past, before].slice(-HISTORY_LIMIT), future: [], coalesce: null });
      }
    },

    /** Adds a layer to the active face, or to another face of the project (then it is not selected). */
    addLayer(layer: Layer, select = true, target?: FaceRef) {
      onTarget(target, (layers) => { layers.push(layer); });
      if (select && !target) api.select([layer.id]);
    },

    updateLayer(id: string, patch: Partial<Layer>, coalesceKey?: string) {
      onFace((layers) => {
        const i = layers.findIndex((l) => l.id === id);
        if (i >= 0) layers[i] = { ...layers[i], ...patch } as Layer;
      }, coalesceKey);
    },

    updateLayers(patches: { id: string; patch: Partial<Layer> }[], coalesceKey?: string) {
      onFace((layers) => {
        for (const { id, patch } of patches) {
          const i = layers.findIndex((l) => l.id === id);
          if (i >= 0) layers[i] = { ...layers[i], ...patch } as Layer;
        }
      }, coalesceKey);
    },

    /** Same as updateLayer but without an undo step (derived values such as measured text height). */
    patchSilently(id: string, patch: Partial<Layer>) {
      const s = get();
      if (!s.project) return;
      const project = structuredClone(s.project);
      const piece = project.pieces.find((p) => p.id === s.selection.pieceId);
      const layers = piece ? ensureFace(piece, s.selection.side) : undefined;
      const i = layers?.findIndex((l) => l.id === id) ?? -1;
      if (!layers || i < 0) return;
      layers[i] = { ...layers[i], ...patch } as Layer;
      set({ project });
    },

    removeLayers(ids: string[]) {
      const drop = new Set(ids);
      onFace((layers) => {
        for (let i = layers.length - 1; i >= 0; i--) if (drop.has(layers[i].id)) layers.splice(i, 1);
      });
      api.select([]);
    },

    duplicateLayers(ids: string[]) {
      const copies: string[] = [];
      onFace((layers) => {
        for (const id of ids) {
          const src = layers.find((l) => l.id === id);
          if (!src) continue;
          const copy = { ...structuredClone(src), id: newId(), x: src.x + 3, y: src.y + 3 } as Layer;
          layers.splice(layers.indexOf(src) + 1, 0, copy);
          copies.push(copy.id);
        }
      });
      api.select(copies);
    },

    arrange(ids: string[], op: ArrangeOp) {
      onFace((layers) => {
        const sel = layers.filter((l) => ids.includes(l.id));
        if (sel.length === 0) return;
        const rest = layers.filter((l) => !ids.includes(l.id));
        let out: Layer[];
        if (op === 'front') out = [...rest, ...sel];
        else if (op === 'back') out = [...sel, ...rest];
        else {
          out = [...layers];
          const order = op === 'forward' ? [...sel].reverse() : sel;
          for (const l of order) {
            const i = out.indexOf(l);
            const j = op === 'forward' ? Math.min(out.length - 1, i + 1) : Math.max(0, i - 1);
            out.splice(i, 1);
            out.splice(j, 0, l);
          }
        }
        layers.splice(0, layers.length, ...out);
      });
    },

    /** Aligns layers (see core/align); locked layers stay where they are. */
    alignLayers(ids: string[], how: AlignHow, to: AlignTo) {
      const s = get();
      const piece = activePiece(s);
      if (!piece) return;
      const layers = activeLayers(s).filter((l) => ids.includes(l.id));
      const target = alignTarget(layers, to, faceDieline(piece, s.selection.side), s.selection.side);
      const moves = alignLayers(layers.filter((l) => !l.locked), how, target)
        .filter((m) => { const l = layers.find((x) => x.id === m.id)!; return m.align || Math.abs(m.x - l.x) > 1e-6 || Math.abs(m.y - l.y) > 1e-6; });
      if (moves.length) api.updateLayers(moves.map(({ id, ...patch }) => ({ id, patch: patch as Partial<Layer> })));
    },

    /** Moves a layer to a new index (0 = bottom). */
    reorder(id: string, index: number) {
      onFace((layers) => {
        const i = layers.findIndex((l) => l.id === id);
        if (i < 0) return;
        const [l] = layers.splice(i, 1);
        layers.splice(Math.max(0, Math.min(layers.length, index)), 0, l);
      });
    },

    copyLayersTo(ids: string[], pieceId: string, side: Side) {
      const s = get();
      const src = activeLayers(s).filter((l) => ids.includes(l.id));
      commit((p) => {
        const target = p.pieces.find((x) => x.id === pieceId);
        if (!target) return;
        for (const l of src) ensureFace(target, side).push({ ...structuredClone(l), id: newId(), clip: null } as Layer);
      });
    },

    /**
     * Fits a layer to a panel (see core/placement): a picture's box becomes
     * the panel and the picture is framed inside it, keeping zoom and pan.
     */
    fitLayer(id: string, panelId: string, mode: FitMode) {
      const r = resolve();
      const layer = activeLayers(get()).find((l) => l.id === id);
      const panel = r && findPanel(r.d, r.side, panelId);
      if (!r || !layer || !panel) return;
      api.updateLayer(id, fitPatch(layer, panel, mode, r.bleed, { from: layerPanel(layer, r.d, r.side) }));
    },

    /**
     * Moves a layer to another panel: if it fills its panel it fills the new
     * one, otherwise it keeps its size and its place within the panel.
     */
    moveToPanel(id: string, panelId: string) {
      const r = resolve();
      const layer = activeLayers(get()).find((l) => l.id === id);
      const to = r && findPanel(r.d, r.side, panelId);
      if (!r || !layer || !to) return;
      api.updateLayer(id, movePatch(layer, layerPanel(layer, r.d, r.side), to, r.bleed));
    },

    /**
     * Adds an image. On a panel it fills it (plus bleed), cropped to the
     * panel's proportions; elsewhere it is dropped at a moderate size.
     * Returns the new layer's id.
     */
    placeImage(asset: { id: string; name: string; width: number; height: number }, panelId: string | null, at?: { x: number; y: number }, target?: FaceRef): string | null {
      const r = resolve(target);
      if (!r) return null;
      const panel = panelId ? findPanel(r.d, r.side, panelId) : undefined;
      const aspect = asset.width / asset.height;
      const w = Math.min(r.d.w * 0.5, 80), h = w / aspect;
      const layer = makeImageLayer(asset.id, asset.name, asset.width, asset.height, { x: (at?.x ?? r.d.w / 2) - w / 2, y: (at?.y ?? r.d.h / 2) - h / 2, w, h });
      // Upside-down panels (O-card back) turn the picture so it reads correctly once folded.
      if (panel) Object.assign(layer, fitPatch(layer, panel, 'cover-bleed', r.bleed, { centre: true }));
      if (!get().project!.assetIds.includes(asset.id)) commit((p) => { p.assetIds.push(asset.id); });
      api.addLayer(layer, true, target);
      return layer.id;
    },

    /**
     * Swaps the picture of an image layer. The same picture at another size
     * (e.g. enlarged in another program) keeps box and crop exactly; otherwise a
     * picture filling its panel fills it again, from the middle.
     */
    replaceImage(layerId: string, asset: { id: string; name: string; width: number; height: number }) {
      const r = resolve();
      const layer = activeLayers(get()).find((l) => l.id === layerId);
      if (!r || !layer || layer.type !== 'image') return;
      const aspect = asset.width / asset.height;
      const picture = { assetId: asset.id, name: asset.name, naturalW: asset.width, naturalH: asset.height };
      if (!get().project!.assetIds.includes(asset.id)) commit((p) => { p.assetIds.push(asset.id); });
      if (sameProportions(aspect, layer.naturalW / layer.naturalH)) {
        // The crop is in picture units (0-1): it frames the same part of the bigger picture.
        api.updateLayer(layerId, picture);
        return;
      }
      if (layer.mask) {
        // A shaped picture keeps its frame: the new one is centred in it.
        api.updateLayer(layerId, { ...picture, crop: cropFor(layer.w / layer.h, aspect) });
        return;
      }
      const panel = layerPanel(layer, r.d, r.side);
      const mode = panel ? filledMode(layer, panel, r.bleed) : null;
      if (panel && mode) {
        api.updateLayer(layerId, { ...picture, ...fitPatch({ ...layer, ...picture }, panel, mode, r.bleed, { centre: true }) });
        return;
      }
      api.updateLayer(layerId, { x: layer.x, y: layer.y + (layer.h - layer.w / aspect) / 2, w: layer.w, h: layer.w / aspect, ...picture, crop: null });
    },

    addAssets(ids: string[]) {
      const p = get().project;
      if (!p) return;
      const missing = ids.filter((id) => !p.assetIds.includes(id));
      if (missing.length) commit((proj) => { proj.assetIds.push(...missing); });
    },

    /**
     * Puts another version of a picture (e.g. enlarged with AI) in its place
     * everywhere: same spot in the picture list, every layer and QR logo
     * that showed it shows the new one with the same box and crop. One undo step.
     */
    replaceAsset(oldId: string, asset: { id: string; width: number; height: number }) {
      const p = get().project;
      if (!p || oldId === asset.id) return;
      const picture = { assetId: asset.id, naturalW: asset.width, naturalH: asset.height };
      commit((proj) => {
        const ids = proj.assetIds.filter((a) => a !== asset.id);
        const at = ids.indexOf(oldId);
        if (at >= 0) ids[at] = asset.id;
        else ids.push(asset.id);
        proj.assetIds = ids;
        for (const piece of proj.pieces) {
          for (const side of Object.keys(piece.layers) as Side[]) {
            piece.layers[side] = faceLayers(piece, side).map((l) => {
              if (l.type === 'image' && l.assetId === oldId) return { ...l, ...picture };
              if (l.type === 'qr' && l.logo?.assetId === oldId) return { ...l, logo: { ...l.logo, ...picture } };
              return l;
            });
          }
        }
      });
    },

    removeAsset(id: string) {
      commit((p) => {
        p.assetIds = p.assetIds.filter((a) => a !== id);
        for (const piece of p.pieces) {
          for (const side of Object.keys(piece.layers) as Side[]) {
            piece.layers[side] = faceLayers(piece, side)
              .filter((l) => !(l.type === 'image' && l.assetId === id))
              .map((l) => (l.type === 'qr' && l.logo?.assetId === id ? { ...l, logo: null } : l));
          }
        }
      });
      set({ selection: validSelection(get().project, get().selection) });
    },

    setPrint(patch: Partial<PrintSettings>) {
      commit((p) => { p.print = { ...p.print, ...patch }; }, `print:${Object.keys(patch).join(',')}`);
    },
  };

  return api;
}

export type Editor = ReturnType<typeof createEditor>;
