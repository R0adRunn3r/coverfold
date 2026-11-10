import type { LineSeg, Path, Rect } from '../geometry';

export type PaperKind = 'paper' | 'cardstock' | 'sticker';
/** A printable face of a piece: outside/inside, or a page of a saddle-stitched booklet. */
export type Side = 'outside' | 'inside' | `p${number}`;
/** Kinds of package; 'digipak' covers digipak, gatefold and wallet (all cardboard covers that open like a book). */
export type Family = 'jewel' | 'dvd' | 'sleeve' | 'disc' | 'digipak' | 'bluray';

/**
 * What lies beyond a panel edge:
 * - cut: the sheet is trimmed here, so artwork must bleed past it
 * - fold: another visible panel continues, so no bleed, clip exactly
 * - flap: a hidden glue flap continues, so artwork bleeds onto the flap
 */
export type EdgeKind = 'cut' | 'fold' | 'flap';

export interface PanelEdges { top: EdgeKind; right: EdgeKind; bottom: EdgeKind; left: EdgeKind }

export interface PanelDef {
  id: string;
  labelKey: string;
  labelVars?: Record<string, string | number>;
  /** Trim coordinates (mm), origin at the top-left of the piece's trim bounding box. */
  rect: Rect;
  edges: PanelEdges;
  /** Inset of the safe area from the panel edges (mm). */
  safe: number;
  /**
   * Safe area when it is not the rectangle inset by `safe`: a closure flap
   * shows only its body once closed (its tab goes in a slit) and its sides
   * taper, so the safe area is smaller than the panel.
   */
  safeRect?: Rect;
  shape?: 'rect' | 'disc';
  /** Spines: suggested text rotation in degrees. */
  textRotation?: 0 | 90 | 270;
  /**
   * The panel is printed upside down in the flat layout (e.g. the back of an
   * O-card, which wraps around the case edge): content placed in it is turned
   * by this angle so it reads correctly once assembled.
   */
  orientation?: 0 | 180;
}

export interface FoldDef extends LineSeg {
  kind: 'valley' | 'mountain';
  /** Fold angle once assembled, in degrees (90 for a box edge, 180 for a flap folded flat). Default 90. */
  angle?: number;
  /**
   * Order in the 3D folding animation: lower steps fold first (default 0).
   * A flap tucked inside folds before the cover closes over it.
   */
  step?: number;
}

export interface Dieline {
  /** Trim bounding box size (mm). */
  w: number;
  h: number;
  /** Cut outline; may contain holes (even-odd). */
  cut: Path;
  /** True when the cut outline is exactly the bounding rectangle (crop marks are enough). */
  rectangular: boolean;
  panels: PanelDef[];
  /** Panels as seen when looking at the inside face (mirrored left to right). */
  insidePanels: PanelDef[];
  folds: FoldDef[];
  /** Glue zones on the outside face. */
  glue: Path[];
  /** Cuts inside the piece (open lines, e.g. the slit a closure tab goes in): cut like the outline, no bleed. */
  slits?: Path[];
  /**
   * Tabs that go through a slit once assembled: in 3D the tab leaves its
   * panel at `edge` and passes under the panel `through`. Nothing printed.
   */
  tucks?: TuckDef[];
  /** Extra non-rectangular safe guides (e.g. disc rings). */
  safeGuides: Path[];
}

/** A tab of a panel that tucks into a slit (3D only). */
export interface TuckDef {
  /** Panel the tab belongs to. */
  panelId: string;
  /** The tab, in piece coordinates. */
  tab: Rect;
  /** Edge of the tab that joins the rest of the panel. */
  edge: 'left' | 'right' | 'top' | 'bottom';
  /** Panel whose slit the tab goes through. */
  through: string;
  /** Animation step: the tab tucks in once its flap has closed. */
  step: number;
}

export interface ParamPreset { labelKey: string; values: Record<string, number> }

export interface ParamSpec {
  key: string;
  labelKey: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** A choice rather than a measurement (e.g. tray or pocket): its values and their names. */
  choices?: ParamChoice[];
}

export interface ParamChoice {
  value: number;
  labelKey: string;
  hintKey?: string;
  /** Measurements that suit this choice, taken when switching to it unless the user changed them. */
  suits?: Record<string, number>;
}

export interface TemplateDef {
  id: string;
  family: Family;
  nameKey: string;
  descKey: string;
  paper: PaperKind;
  sides: Side[];
  params: ParamSpec[];
  presets: ParamPreset[];
  build(params: Record<string, number>): Dieline;
  /**
   * Saddle-stitched booklets: the editable faces are pages p1...pN (each with
   * its own single-panel dieline); printing recombines them into spreads.
   */
  pages?: { count(params: Record<string, number>): number; dieline(params: Record<string, number>, page: number): Dieline };
  /** i18n keys of the assembly steps, in order. */
  assemblyKeys: string[];
  /** Steps that depend on the measurements or choices (e.g. tray or pocket); default: assemblyKeys. */
  assemblyFor?(params: Record<string, number>): string[];
  /**
   * The outside panel whose inside holds the disc, for pieces that take a
   * tray or a pocket (choice in the 'holder' param).
   */
  discHolder?: { panelId: string };
}
