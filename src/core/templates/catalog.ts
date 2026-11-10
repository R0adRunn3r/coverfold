import { circlePath, polygonPath, rectPath, type Point, type Rect } from '../geometry';
import { isPartParams, partDieline } from '../split';
import { arcPath, notchPoints, roundedPolygon } from './shapes';
import type { Dieline, EdgeKind, FoldDef, PanelDef, PanelEdges, ParamSpec, TemplateDef } from './types';

// Sizes follow the industry standards, cross-checked against the Pirates Press
// dielines and MadeGoodDesigns. Everything is parametric so a real case that
// differs by a millimetre can be matched without a new template.

const edges = (top: EdgeKind, right: EdgeKind, bottom: EdgeKind, left: EdgeKind): PanelEdges => ({ top, right, bottom, left });
const ALL_CUT = edges('cut', 'cut', 'cut', 'cut');

const panel = (id: string, labelKey: string, rect: Rect, e: PanelEdges, safe = 3, extra: Partial<PanelDef> = {}): PanelDef => ({
  id, labelKey, rect, edges: e, safe, ...extra,
});

/** Inside face = outside mirrored left to right (sheet flipped like a page). */
function mirrorPanels(panels: PanelDef[], w: number, relabel: Record<string, { id: string; labelKey: string }> = {}): PanelDef[] {
  return panels.map((p) => {
    const r = relabel[p.id];
    return {
      ...p,
      id: r?.id ?? `${p.id}-in`,
      labelKey: r?.labelKey ?? p.labelKey,
      rect: { ...p.rect, x: w - p.rect.x - p.rect.w },
      safeRect: p.safeRect && { ...p.safeRect, x: w - p.safeRect.x - p.safeRect.w },
      edges: { top: p.edges.top, bottom: p.edges.bottom, left: p.edges.right, right: p.edges.left },
      textRotation: p.textRotation === 90 ? 270 : p.textRotation === 270 ? 90 : p.textRotation,
    };
  });
}

const vFold = (x: number, y1: number, y2: number, angle = 90): FoldDef => ({ x1: x, y1, x2: x, y2, kind: 'valley', angle });
const hFold = (y: number, x1: number, x2: number, angle = 90): FoldDef => ({ x1, y1: y, x2, y2: y, kind: 'valley', angle });

function rectDieline(w: number, h: number, panels: PanelDef[], folds: FoldDef[], inside: PanelDef[]): Dieline {
  return { w, h, cut: rectPath({ x: 0, y: 0, w, h }), rectangular: true, panels, insidePanels: inside, folds, glue: [], safeGuides: [] };
}

const SPINE_SAFE = 0.75;

/**
 * Board thickness (mm). Folded cardboard needs a little extra length on every
 * panel that wraps around something: the fold bends around the middle of the
 * board, so spines and walls grow by one thickness (what print shops do).
 */
const THICK = { key: 'thick', labelKey: 'param.thick', default: 0.35, min: 0, max: 0.8, step: 0.05 };

/** What holds the disc inside a digipak or wallet: a tray (bought, or printed in 3D) or a paper pocket. */
export const HOLDER_TRAY = 0;
export const HOLDER_POCKET = 1;
const holderParam = (def: number): ParamSpec => ({
  key: 'holder', labelKey: 'param.holder', default: def, min: 0, max: 1, step: 1,
  choices: [{ value: HOLDER_TRAY, labelKey: 'holder.tray' }, { value: HOLDER_POCKET, labelKey: 'holder.pocket' }],
});
/** Assembly steps with the last one chosen by the disc holder. */
const holderSteps = (base: string[]) => (p: Record<string, number>) => [...base, p.holder === HOLDER_POCKET ? 'asm.holder.pocket' : 'asm.holder.tray'];

const jewelBooklet1: TemplateDef = {
  id: 'jewel.booklet1',
  family: 'jewel',
  nameKey: 'tpl.jewel.booklet1.name',
  descKey: 'tpl.jewel.booklet1.desc',
  paper: 'paper',
  sides: ['outside', 'inside'],
  params: [
    { key: 'w', labelKey: 'param.width', default: 120, min: 110, max: 125, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 120, min: 110, max: 125, step: 0.5 },
  ],
  presets: [],
  build: ({ w, h }) => {
    const front = panel('front', 'panel.front', { x: 0, y: 0, w, h }, ALL_CUT);
    return rectDieline(w, h, [front], [], mirrorPanels([front], w, { front: { id: 'inside', labelKey: 'panel.insideFront' } }));
  },
  assemblyKeys: ['asm.cutMarks', 'asm.booklet1.insert'],
};

const jewelBooklet4: TemplateDef = {
  id: 'jewel.booklet4',
  family: 'jewel',
  nameKey: 'tpl.jewel.booklet4.name',
  descKey: 'tpl.jewel.booklet4.desc',
  paper: 'paper',
  sides: ['outside', 'inside'],
  params: [
    { key: 'pw', labelKey: 'param.pageWidth', default: 120, min: 110, max: 125, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 120, min: 110, max: 125, step: 0.5 },
  ],
  presets: [],
  build: ({ pw, h }) => {
    const w = pw * 2;
    const outside = [
      panel('back', 'panel.page4', { x: 0, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
      panel('front', 'panel.page1', { x: pw, y: 0, w: pw, h }, edges('cut', 'cut', 'cut', 'fold')),
    ];
    const inside = mirrorPanels(outside, w, {
      front: { id: 'p2', labelKey: 'panel.page2' },
      back: { id: 'p3', labelKey: 'panel.page3' },
    });
    return rectDieline(w, h, outside, [vFold(pw, 0, h, 180)], inside);
  },
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.booklet4.fold', 'asm.booklet1.insert'],
};

/**
 * Saddle-stitched booklet (8-32 pages). Pages are edited one by one; odd pages
 * always sit on the right of a spread (fold on their left), even pages on the
 * left. Printing nests N/4 double-sided spreads in reading order.
 */
const jewelBookletN: TemplateDef = {
  id: 'jewel.bookletN',
  family: 'jewel',
  nameKey: 'tpl.jewel.bookletN.name',
  descKey: 'tpl.jewel.bookletN.desc',
  paper: 'paper',
  sides: ['outside', 'inside'],
  params: [
    { key: 'pages', labelKey: 'param.pages', default: 8, min: 8, max: 32, step: 4 },
    { key: 'pw', labelKey: 'param.pageWidth', default: 120, min: 110, max: 125, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 120, min: 110, max: 125, step: 0.5 },
  ],
  presets: [],
  build: (p) => jewelBooklet4.build(p),
  pages: {
    count: ({ pages }) => Math.max(8, Math.round(pages / 4) * 4),
    dieline: ({ pw, h, pages }, n) => {
      const total = Math.max(8, Math.round(pages / 4) * 4);
      const right = n % 2 === 1;
      const labelKey = n === 1 ? 'panel.cover' : n === total ? 'panel.backCover' : 'panel.pageN';
      const page = panel('page', labelKey, { x: 0, y: 0, w: pw, h }, right ? edges('cut', 'cut', 'cut', 'fold') : edges('cut', 'fold', 'cut', 'cut'), 3, { labelVars: { n } });
      return rectDieline(pw, h, [page], [right ? vFold(0, 0, h, 180) : vFold(pw, 0, h, 180)], []);
    },
  },
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.bookletN.nest', 'asm.bookletN.staple', 'asm.booklet1.insert'],
};

const jewelTray: TemplateDef = {
  id: 'jewel.tray',
  family: 'jewel',
  nameKey: 'tpl.jewel.tray.name',
  descKey: 'tpl.jewel.tray.desc',
  paper: 'paper',
  sides: ['outside', 'inside'],
  params: [
    { key: 'bw', labelKey: 'param.backWidth', default: 138, min: 130, max: 142, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 6.5, min: 4, max: 8, step: 0.25 },
    { key: 'h', labelKey: 'param.height', default: 118, min: 112, max: 120, step: 0.5 },
  ],
  presets: [],
  build: ({ bw, spine, h }) => {
    const w = bw + 2 * spine;
    const outside = [
      panel('spineL', 'panel.spineLeft', { x: 0, y: 0, w: spine, h }, edges('cut', 'fold', 'cut', 'cut'), SPINE_SAFE, { textRotation: 90 }),
      panel('back', 'panel.back', { x: spine, y: 0, w: bw, h }, edges('cut', 'fold', 'cut', 'fold')),
      panel('spineR', 'panel.spineRight', { x: spine + bw, y: 0, w: spine, h }, edges('cut', 'cut', 'cut', 'fold'), SPINE_SAFE, { textRotation: 90 }),
    ];
    const inside = mirrorPanels(outside, w, {
      back: { id: 'trayIn', labelKey: 'panel.underTray' },
      spineL: { id: 'spineR-in', labelKey: 'panel.hidden' },
      spineR: { id: 'spineL-in', labelKey: 'panel.hidden' },
    });
    return rectDieline(w, h, outside, [vFold(spine, 0, h), vFold(spine + bw, 0, h)], inside);
  },
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.tray.fold', 'asm.tray.insert'],
};

const discLabel: TemplateDef = {
  id: 'disc.label',
  family: 'disc',
  nameKey: 'tpl.disc.label.name',
  descKey: 'tpl.disc.label.desc',
  paper: 'sticker',
  sides: ['outside'],
  params: [
    { key: 'outer', labelKey: 'param.outerDiameter', default: 117, min: 76, max: 120, step: 0.5 },
    { key: 'inner', labelKey: 'param.innerDiameter', default: 41, min: 15, max: 46, step: 0.5 },
  ],
  presets: [
    { labelKey: 'preset.discSticker', values: { outer: 117, inner: 41 } },
    { labelKey: 'preset.discFullFace', values: { outer: 117, inner: 22 } },
    { labelKey: 'preset.discMini', values: { outer: 78, inner: 41 } },
  ],
  build: ({ outer, inner }) => {
    const r = outer / 2;
    const ri = inner / 2;
    const disc = panel('disc', 'panel.disc', { x: 0, y: 0, w: outer, h: outer }, ALL_CUT, 3, { shape: 'disc' });
    return {
      w: outer,
      h: outer,
      cut: [...circlePath(r, r, r), ...circlePath(r, r, ri)],
      rectangular: false,
      panels: [disc],
      insidePanels: [],
      folds: [],
      glue: [],
      safeGuides: [circlePath(r, r, r - 3), circlePath(r, r, ri + 3)],
    };
  },
  assemblyKeys: ['asm.disc.cut', 'asm.disc.apply'],
};

const dvdWrap: TemplateDef = {
  id: 'dvd.wrap',
  family: 'dvd',
  nameKey: 'tpl.dvd.wrap.name',
  descKey: 'tpl.dvd.wrap.desc',
  paper: 'paper',
  sides: ['outside', 'inside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 129.5, min: 125, max: 135, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 14, min: 5, max: 30, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 183, min: 175, max: 190, step: 0.5 },
  ],
  presets: [
    { labelKey: 'preset.dvd14', values: { spine: 14 } },
    { labelKey: 'preset.dvd9', values: { spine: 9 } },
    { labelKey: 'preset.dvd7', values: { spine: 7 } },
  ],
  build: ({ pw, spine, h }) => {
    const w = pw * 2 + spine;
    const outside = [
      panel('back', 'panel.back', { x: 0, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
      panel('spine', 'panel.spine', { x: pw, y: 0, w: spine, h }, edges('cut', 'fold', 'cut', 'fold'), Math.min(2, spine / 4), { textRotation: 90 }),
      panel('front', 'panel.front', { x: pw + spine, y: 0, w: pw, h }, edges('cut', 'cut', 'cut', 'fold')),
    ];
    const inside = mirrorPanels(outside, w, {
      front: { id: 'inFront', labelKey: 'panel.insideFront' },
      back: { id: 'inBack', labelKey: 'panel.insideBack' },
      spine: { id: 'inSpine', labelKey: 'panel.hidden' },
    });
    return rectDieline(w, h, outside, [vFold(pw, 0, h), vFold(pw + spine, 0, h)], inside);
  },
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.dvd.insert'],
};

/** Blu-ray keep case wrap: same geometry as the DVD wrap, smaller (Amaray 11 mm, Elite 12.5 mm, slim). */
const blurayWrap: TemplateDef = {
  ...dvdWrap,
  id: 'bluray.wrap',
  family: 'bluray',
  nameKey: 'tpl.bluray.wrap.name',
  descKey: 'tpl.bluray.wrap.desc',
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 129, min: 120, max: 135, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 11, min: 5, max: 20, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 148, min: 140, max: 155, step: 0.5 },
  ],
  presets: [
    { labelKey: 'preset.bluray11', values: { spine: 11 } },
    { labelKey: 'preset.bluray125', values: { spine: 12.5 } },
    { labelKey: 'preset.bluray7', values: { spine: 7 } },
  ],
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.bluray.insert'],
};

/** Japanese-style obi: a strip wrapped around the spine side of a jewel case. */
const jewelObi: TemplateDef = {
  id: 'jewel.obi',
  family: 'jewel',
  nameKey: 'tpl.jewel.obi.name',
  descKey: 'tpl.jewel.obi.desc',
  paper: 'paper',
  sides: ['outside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 30, min: 15, max: 50, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 11, min: 5, max: 15, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 120, min: 100, max: 126, step: 0.5 },
  ],
  presets: [],
  build: ({ pw, spine, h }) => {
    const w = pw * 2 + spine;
    const outside = [
      panel('back', 'panel.back', { x: 0, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'cut'), 2),
      panel('spine', 'panel.spine', { x: pw, y: 0, w: spine, h }, edges('cut', 'fold', 'cut', 'fold'), SPINE_SAFE, { textRotation: 90 }),
      panel('front', 'panel.front', { x: pw + spine, y: 0, w: pw, h }, edges('cut', 'cut', 'cut', 'fold'), 2),
    ];
    return rectDieline(w, h, outside, [vFold(pw, 0, h), vFold(pw + spine, 0, h)], []);
  },
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.obi.wrap'],
};

/**
 * O-card for a jewel case: a tube open on the sides. On A4 it can only wrap
 * around the top and bottom edges of the case, so the back panel is printed
 * upside down in the flat layout.
 */
const jewelOcard: TemplateDef = {
  id: 'jewel.ocard',
  family: 'jewel',
  nameKey: 'tpl.jewel.ocard.name',
  descKey: 'tpl.jewel.ocard.desc',
  paper: 'cardstock',
  sides: ['outside'],
  params: [
    { key: 'w', labelKey: 'param.width', default: 142.5, min: 130, max: 150, step: 0.5 },
    { key: 'ph', labelKey: 'param.panelHeight', default: 125, min: 115, max: 130, step: 0.5 },
    { key: 'edge', labelKey: 'param.edge', default: 11, min: 5, max: 15, step: 0.5 },
    { key: 'flap', labelKey: 'param.flap', default: 8, min: 6, max: 15, step: 0.5 },
    THICK,
  ],
  presets: [],
  build: ({ w, ph: ph0, edge: edge0, flap, thick }) => {
    const ph = ph0 + thick, edge = edge0 + thick;
    const y1 = ph, y2 = ph + edge, y3 = 2 * ph + edge, y4 = 2 * ph + 2 * edge;
    const h = y4 + flap;
    const inset = Math.min(4, w / 10);
    const outline = polygonPath([
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: y4 }, { x: w - inset, y: h }, { x: inset, y: h }, { x: 0, y: y4 },
    ]);
    const outside: PanelDef[] = [
      panel('front', 'panel.front', { x: 0, y: 0, w, h: ph }, edges('cut', 'cut', 'fold', 'cut')),
      panel('bottomEdge', 'panel.bottomEdge', { x: 0, y: y1, w, h: edge }, edges('fold', 'cut', 'fold', 'cut'), 1),
      panel('back', 'panel.backUpsideDown', { x: 0, y: y2, w, h: ph }, edges('fold', 'cut', 'fold', 'cut'), 3, { orientation: 180 }),
      panel('topEdge', 'panel.topEdge', { x: 0, y: y3, w, h: edge }, edges('fold', 'cut', 'flap', 'cut'), 1, { orientation: 180 }),
    ];
    const glue = polygonPath([{ x: 0, y: y4 }, { x: w, y: y4 }, { x: w - inset, y: h }, { x: inset, y: h }]);
    return {
      w, h, cut: outline, rectangular: false, panels: outside, insidePanels: [],
      folds: [hFold(y1, 0, w), hFold(y2, 0, w), hFold(y3, 0, w), hFold(y4, 0, w)],
      glue: [glue], safeGuides: [],
    };
  },
  assemblyKeys: ['asm.cutLine', 'asm.scoreFolds', 'asm.ocard.fold', 'asm.ocard.glue'],
};

/** Digipak-style 4-panel cardboard wrap; the disc sits on a glued-in tray or in a pocket. */
/** CD and DVD digipaks are the same wrap round a tray or a pocket. */
const DIGIPAK_WRAP = {
  build: (p: Record<string, number>) => bookWrap(p, p.holder === HOLDER_POCKET ? 'panel.insideRightPocket' : 'panel.insideRightTray'),
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.digipak.fold', 'asm.holder.tray'],
  assemblyFor: holderSteps(['asm.cutMarks', 'asm.scoreFolds', 'asm.digipak.fold']),
  discHolder: { panelId: 'back' },
} satisfies Partial<TemplateDef>;

const digipak4: TemplateDef = {
  id: 'digipak.4p',
  family: 'digipak',
  nameKey: 'tpl.digipak.4p.name',
  descKey: 'tpl.digipak.4p.desc',
  paper: 'cardstock',
  sides: ['outside', 'inside'],
  // Digipak and cardboard gatefold are the same wrap: what changes is what holds
  // the disc. 138 mm panels keep it on one A4 sheet.
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 138, min: 125, max: 150, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 5, min: 2, max: 12, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 125.5, min: 118, max: 130, step: 0.5 },
    THICK,
    holderParam(HOLDER_TRAY),
  ],
  presets: [],
  ...DIGIPAK_WRAP,
};

function sleeveDieline({ pw, h, spine, flap }: Record<string, number>): Dieline {
  const f = flap;
  const fx = pw + spine; // front panel left edge (fold side)
  const w = pw * 2 + spine;
  const fullH = h + 2 * f;
  // Glue flaps hang off the front panel; they are relieved near the fold so
  // the sleeve closes flat (15 mm) and slightly at the opening (3 mm).
  const reliefFold = Math.min(15, pw / 4);
  const reliefOpen = Math.min(3, pw / 10);
  const outline = polygonPath([
    { x: 0, y: f },
    { x: fx, y: f },
    { x: fx + reliefFold, y: 0 },
    { x: w - reliefOpen, y: 0 },
    { x: w, y: f },
    { x: w, y: f + h },
    { x: w - reliefOpen, y: fullH },
    { x: fx + reliefFold, y: fullH },
    { x: fx, y: f + h },
    { x: 0, y: f + h },
  ]);
  const topFlap = polygonPath([{ x: fx, y: f }, { x: fx + reliefFold, y: 0 }, { x: w - reliefOpen, y: 0 }, { x: w, y: f }]);
  const bottomFlap = polygonPath([{ x: fx, y: f + h }, { x: fx + reliefFold, y: fullH }, { x: w - reliefOpen, y: fullH }, { x: w, y: f + h }]);

  const outside: PanelDef[] = [
    panel('back', 'panel.back', { x: 0, y: f, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
    ...(spine > 0
      ? [panel('spine', 'panel.spine', { x: pw, y: f, w: spine, h }, edges('cut', 'fold', 'cut', 'fold'), Math.min(0.5, spine / 4), { textRotation: 90 as const })]
      : []),
    panel('front', 'panel.front', { x: fx, y: f, w: pw, h }, edges('flap', 'cut', 'flap', 'fold')),
  ];
  const inside = mirrorPanels(outside, w, {
    front: { id: 'inFront', labelKey: 'panel.insideFront' },
    back: { id: 'inBack', labelKey: 'panel.insideBack' },
    spine: { id: 'inSpine', labelKey: 'panel.hidden' },
  });
  // In 3D the glue flaps fold in first, then the back closes over them.
  const folds: FoldDef[] = [{ ...vFold(pw, f, f + h, spine > 0 ? 90 : 180), step: 1 }, hFold(f, fx, w, 180), hFold(f + h, fx, w, 180)];
  if (spine > 0) folds.push({ ...vFold(fx, f, f + h), step: 1 });
  return { w, h: fullH, cut: outline, rectangular: false, panels: outside, insidePanels: inside, folds, glue: [topFlap, bottomFlap], safeGuides: [] };
}

const sleeveParams = [
  { key: 'pw', labelKey: 'param.panelWidth', default: 124, min: 118, max: 135, step: 0.5 },
  { key: 'h', labelKey: 'param.height', default: 125, min: 118, max: 135, step: 0.5 },
  { key: 'spine', labelKey: 'param.spine', default: 0, min: 0, max: 10, step: 0.5 },
  { key: 'flap', labelKey: 'param.flap', default: 13, min: 8, max: 20, step: 0.5 },
];

const sleeveCard: TemplateDef = {
  id: 'sleeve.card',
  family: 'sleeve',
  nameKey: 'tpl.sleeve.card.name',
  descKey: 'tpl.sleeve.card.desc',
  paper: 'cardstock',
  sides: ['outside', 'inside'],
  params: sleeveParams,
  presets: [
    { labelKey: 'preset.sleeveSimple', values: { pw: 124, h: 125, spine: 0 } },
    { labelKey: 'preset.sleeveWithInner', values: { pw: 128, h: 126.5, spine: 3.5 } },
  ],
  build: sleeveDieline,
  assemblyKeys: ['asm.cutLine', 'asm.scoreFolds', 'asm.sleeve.flaps', 'asm.sleeve.glue'],
};

const sleeveInner: TemplateDef = {
  ...sleeveCard,
  id: 'sleeve.inner',
  nameKey: 'tpl.sleeve.inner.name',
  descKey: 'tpl.sleeve.inner.desc',
  paper: 'paper',
  presets: [],
  params: sleeveParams.map((p) => (p.key === 'spine' ? { ...p, default: 0 } : p)),
};

/** How the flap of a sleeve closes: its tab goes in a slit in the back, or it tucks inside (like soft plastic sleeves). */
export const CLOSE_SLIT = 0, CLOSE_TUCK = 1;
/** Whether the opening edge of the back has a thumb notch. */
export const NOTCH_OFF = 0, NOTCH_ON = 1;

/** Closure tab: how far it reaches past the flap (mm) and how wide it is at most. */
const TAB_LEN = 9, TAB_W = 40;
/** The flap wraps round the disc: the slit sits this much short of the flap's edge, so the tab pulls it snug. */
const SLIT_WRAP = 2;
/** Radius of the thumb notch in the opening edge of the back. */
const THUMB_R = 9;
/**
 * A tucked flap must slide past the glued seams: at its fold it is this much
 * narrower than the pocket on each side, and at its edge this much.
 */
const TUCK_SHOULDER = 2.5, TUCK_TIP = 10;

/**
 * Sleeve with a closure flap: back | front | flap, glue flaps on the front
 * (like the plain sleeve), open on the right. The flap folds over the
 * opening onto the back, where it shows (its own artwork), and closes either
 * with a rounded tab in a curved slit cut in the back, or tucked inside.
 * An optional thumb notch in the opening edge of the back helps take the disc out.
 */
function sleeveFlapDieline({ pw, h, flap: g, closure: depth, lock, notch }: Record<string, number>): Dieline {
  const slit = lock !== CLOSE_TUCK;
  const X = 2 * pw; // flap fold (opening edge of the front)
  const H = h + 2 * g;
  const cy = g + h / 2;
  const tabW = Math.min(TAB_W, h * 0.32);
  const tab = slit ? TAB_LEN : 0;
  const w = X + depth + tab;
  // The flap narrows towards its edge so it clears the glued seams.
  const inset = slit ? Math.min(5, depth / 4) : TUCK_TIP;
  const shoulder = slit ? 0 : TUCK_SHOULDER;
  const reliefFold = Math.min(15, pw / 4);
  const reliefOpen = Math.min(3, pw / 10);
  const flapPts: [Point, number][] = slit
    ? [
      [{ x: X + depth, y: g + inset }, 3],
      [{ x: X + depth, y: cy - tabW / 2 }, 1.5],
      [{ x: w, y: cy - tabW / 2 }, Math.min(8, tab - 1)],
      [{ x: w, y: cy + tabW / 2 }, Math.min(8, tab - 1)],
      [{ x: X + depth, y: cy + tabW / 2 }, 1.5],
      [{ x: X + depth, y: g + h - inset }, 3],
    ]
    : [
      [{ x: X, y: g + shoulder }, 0],
      [{ x: X + depth, y: g + inset }, 8],
      [{ x: X + depth, y: g + h - inset }, 8],
      [{ x: X, y: g + h - shoulder }, 0],
    ];
  const corners: [Point, number][] = [
    [{ x: 0, y: g }, 0],
    [{ x: pw, y: g }, 0],
    [{ x: pw + reliefFold, y: 0 }, 0],
    [{ x: X - reliefOpen, y: 0 }, 0],
    [{ x: X, y: g }, 0],
    ...flapPts,
    [{ x: X, y: g + h }, 0],
    [{ x: X - reliefOpen, y: H }, 0],
    [{ x: pw + reliefFold, y: H }, 0],
    [{ x: pw, y: g + h }, 0],
    [{ x: 0, y: g + h }, 0],
  ];
  const outline = [
    ...roundedPolygon(corners.map(([p]) => p), corners.map(([, r]) => r)),
    // Thumb notch in the opening edge of the back, going up the left edge (without it the edge is straight).
    ...(notch === NOTCH_OFF ? [] : notchPoints({ x: 0, y: cy + THUMB_R }, { x: 0, y: cy - THUMB_R }, { x: 1, y: 0 })),
  ];
  const topFlap = polygonPath([{ x: pw, y: g }, { x: pw + reliefFold, y: 0 }, { x: X - reliefOpen, y: 0 }, { x: X, y: g }]);
  const bottomFlap = polygonPath([{ x: pw, y: g + h }, { x: pw + reliefFold, y: H }, { x: X - reliefOpen, y: H }, { x: X, y: g + h }]);

  const outside: PanelDef[] = [
    panel('back', 'panel.back', { x: 0, y: g, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
    panel('front', 'panel.front', { x: pw, y: g, w: pw, h }, edges('flap', 'fold', 'flap', 'fold')),
    // Safe area: the part that shows once closed, clear of the tapered sides (the tab goes in the slit).
    panel('closure', 'panel.closure', { x: X, y: g, w: depth + tab, h }, edges('cut', 'cut', 'cut', 'fold'), 3,
      { safeRect: slit
        ? { x: X + 3, y: g + inset + 3, w: Math.max(0, depth - 6), h: h - 2 * inset - 6 }
        : { x: X + 2, y: g + inset + 3, w: Math.max(0, depth - 7), h: h - 2 * inset - 6 } }),
  ];
  const inside = mirrorPanels(outside, w, {
    front: { id: 'inFront', labelKey: 'panel.insideFront' },
    back: { id: 'inBack', labelKey: 'panel.insideBack' },
    closure: { id: 'inClosure', labelKey: 'panel.insideClosure' },
  });
  // In 3D: glue flaps first, then the back closes, then the flap folds over it and its tab goes in the slit.
  // A tucked flap folds in once the glue flaps are down, and the back closes over it.
  const folds: FoldDef[] = [
    hFold(g, pw, X, 180), hFold(g + h, pw, X, 180),
    { ...vFold(pw, g, g + h, 180), step: slit ? 1 : 2 },
    { ...vFold(X, g + shoulder, g + h - shoulder, 180), step: slit ? 2 : 1 },
  ];
  // The slit, where the edge of the flap lands on the back (measured from its opening edge), bowed like the tab.
  const sx = depth - SLIT_WRAP;
  const slits = slit ? [arcPath({ x: sx, y: cy - tabW / 2 - 1 }, { x: sx, y: cy + tabW / 2 + 1 }, 2.5)] : [];
  return {
    w, h: H, cut: polygonPath(outline), rectangular: false, panels: outside, insidePanels: inside, folds,
    glue: [topFlap, bottomFlap], slits, safeGuides: [],
    tucks: slit ? [{ panelId: 'closure', tab: { x: X + depth, y: cy - tabW / 2, w: tab, h: tabW }, edge: 'left', through: 'back', step: 3 }] : [],
  };
}

const sleeveFlap: TemplateDef = {
  id: 'sleeve.flap',
  family: 'sleeve',
  nameKey: 'tpl.sleeve.flap.name',
  descKey: 'tpl.sleeve.flap.desc',
  paper: 'cardstock',
  sides: ['outside', 'inside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 124, min: 120, max: 130, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 125, min: 120, max: 130, step: 0.5 },
    { key: 'flap', labelKey: 'param.flap', default: 13, min: 8, max: 20, step: 0.5 },
    { key: 'closure', labelKey: 'param.closure', default: 24, min: 16, max: 30, step: 0.5 },
    {
      key: 'lock', labelKey: 'param.lock', default: CLOSE_SLIT, min: 0, max: 1, step: 1,
      choices: [
        { value: CLOSE_SLIT, labelKey: 'param.lockSlit', hintKey: 'param.lockSlitHint', suits: { closure: 24 } },
        // A shorter flap is much easier to slide in between the back and the disc.
        { value: CLOSE_TUCK, labelKey: 'param.lockTuck', hintKey: 'param.lockTuckHint', suits: { closure: 18 } },
      ],
    },
    {
      key: 'notch', labelKey: 'param.notch', default: NOTCH_ON, min: 0, max: 1, step: 1,
      choices: [
        { value: NOTCH_ON, labelKey: 'common.yes', hintKey: 'param.notchOnHint' },
        { value: NOTCH_OFF, labelKey: 'common.no', hintKey: 'param.notchOffHint' },
      ],
    },
  ],
  presets: [],
  build: sleeveFlapDieline,
  assemblyKeys: ['asm.cutLine', 'asm.flap.slit', 'asm.scoreFolds', 'asm.sleeve.flaps', 'asm.sleeve.glue', 'asm.flap.close'],
  assemblyFor: (p) => (p.lock === CLOSE_TUCK
    ? ['asm.cutLine', 'asm.scoreFolds', 'asm.sleeve.flaps', 'asm.sleeve.glue', 'asm.flap.tuck']
    : ['asm.cutLine', 'asm.flap.slit', 'asm.scoreFolds', 'asm.sleeve.flaps', 'asm.sleeve.glue', 'asm.flap.close']),
};

/**
 * Slipcase for a cardboard sleeve: back | spine | front, with walls and glue
 * tabs on the front panel. Open on the right.
 */
const sleeveSlipcase: TemplateDef = {
  id: 'sleeve.slipcase',
  family: 'sleeve',
  nameKey: 'tpl.sleeve.slipcase.name',
  descKey: 'tpl.sleeve.slipcase.desc',
  paper: 'cardstock',
  sides: ['outside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 127, min: 120, max: 140, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 127, min: 120, max: 140, step: 0.5 },
    { key: 'depth', labelKey: 'param.depth', default: 4, min: 2, max: 15, step: 0.5 },
    { key: 'tab', labelKey: 'param.flap', default: 10, min: 6, max: 15, step: 0.5 },
    THICK,
  ],
  presets: [],
  build: ({ pw: pw0, h, depth: depth0, tab, thick }) => {
    const pw = pw0 + thick, depth = depth0 + thick;
    const fx = pw + depth;
    const w = pw * 2 + depth;
    const top = depth + tab;
    const H = h + 2 * top;
    const rel = Math.min(8, pw / 8);
    const outline = polygonPath([
      { x: 0, y: top }, { x: fx, y: top },
      { x: fx, y: tab }, { x: fx + rel, y: 0 }, { x: w - rel, y: 0 }, { x: w, y: tab },
      { x: w, y: H - tab }, { x: w - rel, y: H }, { x: fx + rel, y: H }, { x: fx, y: H - tab },
      { x: fx, y: top + h }, { x: 0, y: top + h },
    ]);
    const outside: PanelDef[] = [
      panel('back', 'panel.back', { x: 0, y: top, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
      panel('spine', 'panel.spine', { x: pw, y: top, w: depth, h }, edges('cut', 'fold', 'cut', 'fold'), Math.min(0.5, depth / 4), { textRotation: 90 }),
      panel('front', 'panel.front', { x: fx, y: top, w: pw, h }, edges('fold', 'cut', 'fold', 'fold')),
      panel('topWall', 'panel.topEdge', { x: fx, y: tab, w: pw, h: depth }, edges('flap', 'cut', 'fold', 'cut'), 0.5),
      panel('bottomWall', 'panel.bottomEdge', { x: fx, y: top + h, w: pw, h: depth }, edges('fold', 'cut', 'flap', 'cut'), 0.5),
    ];
    const glue = [
      polygonPath([{ x: fx, y: tab }, { x: fx + rel, y: 0 }, { x: w - rel, y: 0 }, { x: w, y: tab }]),
      polygonPath([{ x: fx, y: H - tab }, { x: fx + rel, y: H }, { x: w - rel, y: H }, { x: w, y: H - tab }]),
    ];
    return {
      w, h: H, cut: outline, rectangular: false, panels: outside, insidePanels: [],
      // In 3D the walls and their tabs stand up first, then spine and back close the box.
      folds: [{ ...vFold(pw, top, top + h), step: 1 }, { ...vFold(fx, top, top + h), step: 1 }, hFold(top, fx, w), hFold(top + h, fx, w), hFold(tab, fx, w), hFold(H - tab, fx, w)],
      glue, safeGuides: [],
    };
  },
  assemblyKeys: ['asm.cutLine', 'asm.scoreFolds', 'asm.slipcase.walls', 'asm.slipcase.glue'],
};

/**
 * Book-like wrap (back | spine | front), outside and inside: shared by the CD
 * and DVD digipaks. The spine grows by the board thickness.
 */
function bookWrap({ pw, spine: spine0, h, thick }: Record<string, number>, insideRight: string): Dieline {
  const spine = spine0 + thick;
  const w = pw * 2 + spine;
  const outside = [
    panel('back', 'panel.back', { x: 0, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
    panel('spine', 'panel.spine', { x: pw, y: 0, w: spine, h }, edges('cut', 'fold', 'cut', 'fold'), Math.min(0.75, spine / 4), { textRotation: 90 }),
    panel('front', 'panel.front', { x: pw + spine, y: 0, w: pw, h }, edges('cut', 'cut', 'cut', 'fold')),
  ];
  const inside = mirrorPanels(outside, w, {
    front: { id: 'inLeft', labelKey: 'panel.insideLeft' },
    back: { id: 'inRight', labelKey: insideRight },
    spine: { id: 'inSpine', labelKey: 'panel.hidden' },
  });
  return rectDieline(w, h, outside, [vFold(pw, 0, h), vFold(pw + spine, 0, h)], inside);
}

/**
 * Three-panel wallet (6 faces): back | spine | front | flap. The flap folds
 * flat inside, behind the front cover; it is a little narrower so it closes.
 */
const walletSix: TemplateDef = {
  id: 'wallet.six',
  family: 'digipak',
  nameKey: 'tpl.wallet.six.name',
  descKey: 'tpl.wallet.six.desc',
  paper: 'cardstock',
  sides: ['outside', 'inside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 142, min: 125, max: 150, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 5, min: 2, max: 12, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 125, min: 118, max: 130, step: 0.5 },
    THICK,
    holderParam(HOLDER_POCKET),
  ],
  presets: [],
  build: ({ pw, spine: spine0, h, thick }) => {
    const spine = spine0 + thick;
    const fw = pw - 2 - 2 * thick;
    const fx = 2 * pw + spine;
    const w = fx + fw;
    const outside = [
      panel('back', 'panel.back', { x: 0, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
      panel('spine', 'panel.spine', { x: pw, y: 0, w: spine, h }, edges('cut', 'fold', 'cut', 'fold'), Math.min(0.75, spine / 4), { textRotation: 90 }),
      panel('front', 'panel.front', { x: pw + spine, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'fold')),
      panel('flap', 'panel.flapOutside', { x: fx, y: 0, w: fw, h }, edges('cut', 'cut', 'cut', 'fold')),
    ];
    const inside = mirrorPanels(outside, w, {
      flap: { id: 'inFlap', labelKey: 'panel.insideFlap' },
      front: { id: 'inFront', labelKey: 'panel.insideFront' },
      back: { id: 'inBack', labelKey: 'panel.insideBack' },
      spine: { id: 'inSpine', labelKey: 'panel.hidden' },
    });
    // In 3D the flap tucks in behind the front first, then the cover closes over it.
    return rectDieline(w, h, outside, [{ ...vFold(pw, 0, h), step: 1 }, { ...vFold(pw + spine, 0, h), step: 1 }, vFold(fx, 0, h, 180)], inside);
  },
  assemblyKeys: ['asm.cutMarks', 'asm.scoreFolds', 'asm.six.fold', 'asm.holder.pocket'],
  assemblyFor: holderSteps(['asm.cutMarks', 'asm.scoreFolds', 'asm.six.fold']),
  discHolder: { panelId: 'back' },
};

/**
 * Disc pocket to glue inside a gatefold or wallet: glue tabs on three sides,
 * open on the left (towards the spine when glued on the right panel).
 */
const walletPocket: TemplateDef = {
  id: 'wallet.pocket',
  family: 'digipak',
  nameKey: 'tpl.wallet.pocket.name',
  descKey: 'tpl.wallet.pocket.desc',
  paper: 'paper',
  sides: ['outside'],
  params: [
    { key: 'pw', labelKey: 'param.width', default: 126, min: 122, max: 140, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 124, min: 122, max: 130, step: 0.5 },
    { key: 'tab', labelKey: 'param.flap', default: 12, min: 8, max: 16, step: 0.5 },
  ],
  presets: [],
  build: ({ pw, h, tab }) => {
    const c = tab;
    const H = h + 2 * tab;
    const outline = polygonPath([
      { x: 0, y: tab }, { x: c, y: 0 }, { x: pw - c, y: 0 }, { x: pw, y: tab },
      { x: pw + tab, y: tab + c }, { x: pw + tab, y: tab + h - c }, { x: pw, y: tab + h },
      { x: pw - c, y: H }, { x: c, y: H }, { x: 0, y: tab + h },
    ]);
    const front = panel('front', 'panel.pocket', { x: 0, y: tab, w: pw, h }, edges('flap', 'flap', 'flap', 'cut'));
    const glue = [
      polygonPath([{ x: 0, y: tab }, { x: c, y: 0 }, { x: pw - c, y: 0 }, { x: pw, y: tab }]),
      polygonPath([{ x: pw, y: tab }, { x: pw + tab, y: tab + c }, { x: pw + tab, y: tab + h - c }, { x: pw, y: tab + h }]),
      polygonPath([{ x: pw, y: tab + h }, { x: pw - c, y: H }, { x: c, y: H }, { x: 0, y: tab + h }]),
    ];
    return {
      w: pw + tab, h: H, cut: outline, rectangular: false, panels: [front], insidePanels: [],
      folds: [hFold(tab, 0, pw, 180), vFold(pw, tab, tab + h, 180), hFold(tab + h, 0, pw, 180)],
      glue, safeGuides: [],
    };
  },
  assemblyKeys: ['asm.cutLine', 'asm.scoreFolds', 'asm.pocket.glue'],
};

/** DVD-size digipak (2 panels, adhesive tray bought separately): wider than A4, printed in two parts. */
const dvdDigipak: TemplateDef = {
  id: 'dvd.digipak',
  family: 'dvd',
  nameKey: 'tpl.dvd.digipak.name',
  descKey: 'tpl.dvd.digipak.desc',
  paper: 'cardstock',
  sides: ['outside', 'inside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 136, min: 125, max: 142, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 14, min: 5, max: 20, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 190, min: 180, max: 195, step: 0.5 },
    THICK,
    holderParam(HOLDER_TRAY),
  ],
  presets: [],
  ...DIGIPAK_WRAP,
};

/**
 * Slipcover (O-card) for a keep case: a cardboard tube open at the top and
 * bottom. back | spine | front | opening edge | glue flap, glued under the back.
 */
function slipcover({ pw: pw0, h, spine: spine0, edge: edge0, flap, thick }: Record<string, number>): Dieline {
  const pw = pw0 + thick, spine = spine0 + thick, edge = edge0 + thick;
  const x1 = pw, x2 = pw + spine, x3 = 2 * pw + spine, x4 = x3 + edge;
  const w = x4 + flap;
  const c = Math.min(flap * 0.8, h / 10);
  const outline = polygonPath([
    { x: 0, y: 0 }, { x: x4, y: 0 }, { x: w, y: c }, { x: w, y: h - c }, { x: x4, y: h }, { x: 0, y: h },
  ]);
  const outside: PanelDef[] = [
    panel('back', 'panel.back', { x: 0, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'cut')),
    panel('spine', 'panel.spine', { x: x1, y: 0, w: spine, h }, edges('cut', 'fold', 'cut', 'fold'), Math.min(1, spine / 4), { textRotation: 90 }),
    panel('front', 'panel.front', { x: x2, y: 0, w: pw, h }, edges('cut', 'fold', 'cut', 'fold')),
    panel('edge', 'panel.openEdge', { x: x3, y: 0, w: edge, h }, edges('cut', 'flap', 'cut', 'fold'), Math.min(1, edge / 4), { textRotation: 90 }),
  ];
  return {
    w, h, cut: outline, rectangular: false, panels: outside, insidePanels: [],
    folds: [vFold(x1, 0, h), vFold(x2, 0, h), vFold(x3, 0, h), vFold(x4, 0, h)],
    glue: [polygonPath([{ x: x4, y: 0 }, { x: w, y: c }, { x: w, y: h - c }, { x: x4, y: h }])],
    safeGuides: [],
  };
}

const dvdSlipcover: TemplateDef = {
  id: 'dvd.slipcover',
  family: 'dvd',
  nameKey: 'tpl.dvd.slipcover.name',
  descKey: 'tpl.dvd.slipcover.desc',
  paper: 'cardstock',
  sides: ['outside'],
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 136, min: 125, max: 142, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 191, min: 180, max: 196, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 15, min: 6, max: 22, step: 0.5 },
    { key: 'edge', labelKey: 'param.openEdge', default: 15, min: 6, max: 22, step: 0.5 },
    { key: 'flap', labelKey: 'param.flap', default: 10, min: 8, max: 15, step: 0.5 },
    THICK,
  ],
  presets: [
    { labelKey: 'preset.dvd14', values: { spine: 15, edge: 15 } },
    { labelKey: 'preset.dvd9', values: { spine: 10, edge: 10 } },
    { labelKey: 'preset.dvd7', values: { spine: 8, edge: 8 } },
  ],
  build: slipcover,
  assemblyKeys: ['asm.cutLine', 'asm.scoreFolds', 'asm.slipcover.glue', 'asm.slipcover.insert'],
};

const bluraySlipcover: TemplateDef = {
  ...dvdSlipcover,
  id: 'bluray.slipcover',
  family: 'bluray',
  nameKey: 'tpl.bluray.slipcover.name',
  descKey: 'tpl.bluray.slipcover.desc',
  params: [
    { key: 'pw', labelKey: 'param.panelWidth', default: 130, min: 120, max: 140, step: 0.5 },
    { key: 'h', labelKey: 'param.height', default: 149.5, min: 140, max: 156, step: 0.5 },
    { key: 'spine', labelKey: 'param.spine', default: 13, min: 6, max: 20, step: 0.5 },
    { key: 'edge', labelKey: 'param.openEdge', default: 13, min: 6, max: 20, step: 0.5 },
    { key: 'flap', labelKey: 'param.flap', default: 10, min: 8, max: 15, step: 0.5 },
    THICK,
  ],
  presets: [
    { labelKey: 'preset.bluray11', values: { spine: 12, edge: 12 } },
    { labelKey: 'preset.bluray125', values: { spine: 13.5, edge: 13.5 } },
  ],
};

export const TEMPLATES: TemplateDef[] = [
  jewelBooklet1, jewelBooklet4, jewelBookletN, jewelTray, jewelObi, jewelOcard,
  discLabel, dvdWrap, blurayWrap, sleeveCard, sleeveFlap, sleeveInner, sleeveSlipcase, digipak4,
  walletSix, walletPocket, dvdDigipak, dvdSlipcover, bluraySlipcover,
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

/** Assembly steps of a piece with these params (some depend on the choices). */
export function assemblyKeysOf(templateId: string, params: Record<string, number>): string[] {
  const t = getTemplate(templateId);
  return t.assemblyFor ? t.assemblyFor({ ...defaultParams(t), ...params }) : t.assemblyKeys;
}

/** Every assembly step any template can use (for the translated strings). */
export const ALL_ASSEMBLY_KEYS = [...new Set(TEMPLATES.flatMap((t) => {
  const variants = t.assemblyFor
    ? t.params.flatMap((p) => (p.choices ?? []).map((c) => t.assemblyFor!({ ...defaultParams(t), [p.key]: c.value })))
    : [];
  return [t.assemblyKeys, ...variants].flat();
}))];

export function getTemplate(id: string): TemplateDef {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}

export function defaultParams(t: TemplateDef): Record<string, number> {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}

/**
 * The params to set when a choice changes: the choice itself, plus the
 * measurements that suit it, where they still have the value that suited the
 * previous choice (one the user changed is kept).
 */
export function choicePatch(t: TemplateDef, params: Record<string, number>, key: string, value: number): Record<string, number> {
  const full = { ...defaultParams(t), ...params };
  const choices = t.params.find((p) => p.key === key)?.choices ?? [];
  const from = choices.find((c) => c.value === full[key])?.suits ?? {};
  const to = choices.find((c) => c.value === value)?.suits ?? {};
  const patch: Record<string, number> = { [key]: value };
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const def = t.params.find((p) => p.key === k)?.default;
    const was = from[k] ?? def;
    const next = to[k] ?? def;
    if (next !== undefined && full[k] === was) patch[k] = next;
  }
  return patch;
}

const cache = new Map<string, Dieline>();
const paramKey = (t: TemplateDef, full: Record<string, number>) => t.params.map((p) => full[p.key]).join(',');

/**
 * Builds (and memoises) the dieline for a template with the given params.
 * Print parts of a split piece carry `__x0/__x1/__tab` and get their part.
 */
export function buildDieline(templateId: string, params: Record<string, number>): Dieline {
  const t = getTemplate(templateId);
  const full = { ...defaultParams(t), ...params };
  const part = isPartParams(full) ? `|part:${full.__x0},${full.__x1},${full.__tab}` : '';
  const key = `${templateId}|${paramKey(t, full)}${part}`;
  let d = cache.get(key);
  if (!d) {
    d = part ? partDieline(buildDieline(templateId, stripPart(params)), { x0: full.__x0, x1: full.__x1, tab: full.__tab }) : t.build(full);
    cache.set(key, d);
  }
  return d;
}

const stripPart = (p: Record<string, number>) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('__')));

/** Dieline of one page of a multi-page template (memoised). */
export function buildPageDieline(templateId: string, params: Record<string, number>, page: number): Dieline {
  const t = getTemplate(templateId);
  if (!t.pages) return buildDieline(templateId, params);
  const full = { ...defaultParams(t), ...params };
  const key = `${templateId}|${paramKey(t, full)}|p${page}`;
  let d = cache.get(key);
  if (!d) {
    d = t.pages.dieline(full, page);
    cache.set(key, d);
  }
  return d;
}
