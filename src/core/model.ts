import type { PaperKind, Side } from './templates/types';

export type BleedFill = 'auto' | 'mirror' | 'stretch' | 'none';

/** How a layer mixes with what lies below it (canvas composite operations). */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'darken' | 'lighten' | 'color' | 'luminosity';
export const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'darken', 'lighten', 'color', 'luminosity'];

/**
 * Drop shadow, or a glow when `distance` is 0. Sizes in mm; `angle` in
 * degrees (0 = right, 90 = down) in the layer's own frame, so the shadow
 * turns with the layer like CSS shadows do.
 */
export interface Shadow { color: string; blur: number; distance: number; angle: number }
export const DEFAULT_SHADOW: Shadow = { color: 'rgba(0,0,0,0.5)', blur: 0.8, distance: 0.6, angle: 45 };

/** Text outline, drawn under the letters (so they keep their shape); width in mm. */
export interface Outline { color: string; width: number }
export const DEFAULT_OUTLINE: Outline = { color: '#ffffff', width: 0.4 };

/** Image cut to a shape; `radius` (mm) for rounded corners. Masked images get no automatic bleed. */
export interface ImageMask { shape: 'ellipse' | 'rounded'; radius: number }

/** QR error correction: L 7%, M 15%, Q 25%, H 30% of the code may be damaged. */
export type QrEcc = 'L' | 'M' | 'Q' | 'H';

interface LayerBase {
  id: string;
  name: string;
  /** Top-left of the unrotated box, in trim coordinates of the piece face (mm). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the box centre. */
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Restrict drawing to one panel (plus its bleed), or to the whole piece. */
  clip: { panelId: string } | null;
  shadow?: Shadow | null;
  blend?: BlendMode;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
  naturalW: number;
  naturalH: number;
  flipX: boolean;
  flipY: boolean;
  /** How the bleed is produced when the image stops at a cut edge. */
  bleedFill: BleedFill;
  /** `blur`: Gaussian blur on print, in mm (standard deviation). */
  adjust: { brightness: number; contrast: number; saturation: number; grayscale: boolean; blur?: number };
  /**
   * Part of the picture shown in the box (normalised 0-1, same proportions as
   * the box); none = the whole picture. See core/crop.
   */
  crop?: { x: number; y: number; w: number; h: number } | null;
  mask?: ImageMask | null;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  /** Points (1 pt = 0.3528 mm). */
  fontSize: number;
  fontWeight: 400 | 700;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  /**
   * plain: wrapped text; tracklist: one line per track, durations aligned to
   * the right with dot leaders; arc: text around a circle (disc labels).
   */
  mode?: TextMode;
  /** arc mode: radius of the text's centre line (mm) and which half of the circle. */
  arcRadius?: number;
  arcSide?: 'top' | 'bottom';
  outline?: Outline | null;
}

export type TextMode = 'plain' | 'tracklist' | 'arc';

/**
 * Two-colour gradient over the layer box. Linear: `angle` in degrees, 0 runs
 * left to right, 90 top to bottom. Radial: from the centre outwards. Colours
 * may be transparent (rgba or #rrggbbaa), e.g. a shade behind text.
 */
export interface Gradient { kind: 'linear' | 'radial'; from: string; to: string; angle: number }

export interface FillLayer extends LayerBase {
  type: 'fill';
  color: string;
  /** When set, replaces the plain colour. */
  gradient?: Gradient | null;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: string | null;
  /** When set (and fill is on), the shape is filled with it instead of the plain colour. */
  gradient?: Gradient | null;
  stroke: string | null;
  strokeWidth: number;
  cornerRadius: number;
}

/**
 * QR code: square modules over the box (kept square), with a 2-module
 * quiet zone inside it. `background` fills the box (null = transparent, then
 * the artwork below must be light and plain for phones to read it).
 */
export interface QrLayer extends LayerBase {
  type: 'qr';
  text: string;
  color: string;
  background: string | null;
  /** Chosen robustness; a logo always raises it to H (see core/qr qrEcc). */
  ecc: QrEcc;
  logo?: QrLogo | null;
}

/**
 * Where a picture is opaque, on a coarse grid (at most 64 cells a side):
 * row-major bits, base64. Saved with the logo so the modules it covers are
 * known everywhere (editor, checks, export) without decoding the image.
 */
export interface Footprint { w: number; h: number; bits: string }

/**
 * Picture in the middle of a QR code. `size`: its longer side as a share
 * (0-1) of the code's side. Modules under its opaque parts are left out,
 * so a logo with transparency covers only what it needs.
 */
export interface QrLogo {
  assetId: string;
  name: string;
  naturalW: number;
  naturalH: number;
  size: number;
  footprint: Footprint;
}

export type Layer = ImageLayer | TextLayer | FillLayer | ShapeLayer | QrLayer;
export type LayerType = Layer['type'];

/** Images a layer draws (its picture, a QR code's logo). */
export function layerAssetIds(l: Layer): string[] {
  if (l.type === 'image') return [l.assetId];
  if (l.type === 'qr' && l.logo) return [l.logo.assetId];
  return [];
}

export interface Piece {
  id: string;
  templateId: string;
  params: Record<string, number>;
  /** Overrides the template's paper kind (decides which sheet group it prints on). */
  paper: PaperKind | null;
  copies: number;
  layers: Record<Side, Layer[]>;
}

export type DuplexMode = 'none' | 'long' | 'short';
export type CutLineMode = 'auto' | 'always' | 'never';
export type ImageFormat = 'jpeg' | 'png';

export interface PrintSettings {
  dpi: number;
  format: ImageFormat;
  jpegQuality: number;
  bleed: number;
  cropMarks: boolean;
  foldMarks: boolean;
  cutLine: CutLineMode;
  printerMargin: number;
  duplex: DuplexMode;
  backOffsetX: number;
  backOffsetY: number;
  ruler: boolean;
  instructions: boolean;
  /** Text above all images goes into the PDF as real text (sharp at any DPI). */
  vectorText?: boolean;
  /** Enlarge low-resolution images with Lanczos-3 and light sharpening instead of the browser's bicubic. */
  enhanceSmall?: boolean;
}

export interface Project {
  id: string;
  name: string;
  kit: string;
  createdAt: number;
  updatedAt: number;
  pieces: Piece[];
  /** Assets imported into this project (library), even if not placed. */
  assetIds: string[];
  print: PrintSettings;
}

export const DEFAULT_PRINT: PrintSettings = {
  // 600 DPI keeps small rasterised text crisp on photo printers. PNG avoids
  // compression artefacts on edges and text, at about 40 MB per sheet.
  dpi: 600,
  format: 'png',
  jpegQuality: 0.95,
  bleed: 3,
  cropMarks: true,
  foldMarks: true,
  cutLine: 'auto',
  printerMargin: 4,
  duplex: 'none',
  backOffsetX: 0,
  backOffsetY: 0,
  ruler: true,
  // Costs an extra sheet, so off by default.
  instructions: false,
  vectorText: true,
  enhanceSmall: true,
};

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const base = (name: string, box: { x: number; y: number; w: number; h: number }): LayerBase => ({
  id: newId(),
  name,
  ...box,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  clip: null,
});

export function makeImageLayer(assetId: string, name: string, naturalW: number, naturalH: number, box: { x: number; y: number; w: number; h: number }): ImageLayer {
  return {
    ...base(name, box),
    type: 'image',
    assetId,
    naturalW,
    naturalH,
    flipX: false,
    flipY: false,
    bleedFill: 'auto',
    adjust: { brightness: 0, contrast: 0, saturation: 0, grayscale: false },
  };
}

export function makeTextLayer(text: string, box: { x: number; y: number; w: number; h: number }, opts: Partial<TextLayer> = {}): TextLayer {
  return {
    ...base(text.split('\n')[0].slice(0, 24) || 'Text', box),
    type: 'text',
    text,
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 400,
    italic: false,
    color: '#111111',
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    ...opts,
  };
}

export function makeFillLayer(color: string, box: { x: number; y: number; w: number; h: number }, name = 'Background'): FillLayer {
  return { ...base(name, box), type: 'fill', color };
}

export function makeShapeLayer(shape: 'rect' | 'ellipse', box: { x: number; y: number; w: number; h: number }): ShapeLayer {
  return { ...base(shape === 'rect' ? 'Rectangle' : 'Ellipse', box), type: 'shape', shape, fill: '#e0e0e0', stroke: null, strokeWidth: 0.5, cornerRadius: 0 };
}

export function makeQrLayer(text: string, box: { x: number; y: number; w: number; h: number }): QrLayer {
  return { ...base('QR', box), type: 'qr', text, color: '#000000', background: '#ffffff', ecc: 'M' };
}

export function makePiece(templateId: string, params: Record<string, number> = {}): Piece {
  return { id: newId(), templateId, params, paper: null, copies: 1, layers: { outside: [], inside: [] } };
}

export function makeProject(name: string, kit: string, pieces: Piece[]): Project {
  const now = Date.now();
  return { id: newId(), name, kit, createdAt: now, updatedAt: now, pieces, assetIds: [], print: { ...DEFAULT_PRINT } };
}

export const PT_TO_MM = 25.4 / 72;
