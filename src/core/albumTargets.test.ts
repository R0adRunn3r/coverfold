import { describe, expect, it } from 'vitest';
import { coverKind, defaultAlbumPlan, onPanel, picturePanels } from './albumTargets';
import { makePiece, makeProject } from './model';
import { buildDieline } from './templates/catalog';

const cover = (types: string[], front = false) => ({ types, front });
const where = (c: { pieceId: string; side: string; panel: { id: string } } | null, ids: Record<string, string>) =>
  c ? `${ids[c.pieceId]}:${c.side}:${c.panel.id}` : null;

describe('album targets', () => {
  const booklet = makePiece('jewel.booklet4'), tray = makePiece('jewel.tray'), disc = makePiece('disc.label');
  const jewel = makeProject('j', 'jewel', [booklet, tray, disc]);
  const ids = { [booklet.id]: 'booklet', [tray.id]: 'tray', [disc.id]: 'disc' };

  it('lists the panels a picture can fill, without spines or hidden panels', () => {
    const keys = picturePanels(jewel).map((c) => where(c, ids));
    expect(keys).toContain('booklet:outside:front');
    expect(keys).toContain('tray:inside:trayIn');
    expect(keys).toContain('disc:outside:disc');
    expect(keys.some((k) => k!.includes('spine'))).toBe(false);
  });

  it('reads the kind of a cover', () => {
    expect(coverKind(cover(['Back', 'Spine']))).toBe('back');
    expect(coverKind(cover([], true))).toBe('front');
    expect(coverKind(cover(['Booklet']))).toBe('other');
  });

  it('dresses a jewel case: front on the booklet, back on the tray card, disc on the disc', () => {
    const covers = [cover(['Booklet']), cover(['Back']), cover(['Front'], true), cover(['Medium']), cover(['Tray'])];
    const plan = defaultAlbumPlan(jewel, booklet.id, covers);
    expect(plan.covers.map((c) => where(c, ids))).toEqual([null, 'tray:outside:back', 'booklet:outside:front', 'disc:outside:disc', 'tray:inside:trayIn']);
    expect(where(plan.titles, ids)).toBe('booklet:outside:front');
    expect(where(plan.tracklist, ids)).toBe('tray:outside:back');
  });

  it('puts the front on a front panel even when another piece is open', () => {
    const plan = defaultAlbumPlan(jewel, tray.id, [cover(['Front'], true), cover(['Back'])]);
    expect(plan.covers.map((c) => where(c, ids))).toEqual(['booklet:outside:front', 'tray:outside:back']);
  });

  it('uses the same piece for the back when it is the only one', () => {
    const wrap = makePiece('dvd.wrap');
    const p = makeProject('d', 'dvd', [wrap]);
    const plan = defaultAlbumPlan(p, wrap.id, [cover(['Front'], true), cover(['Back'])]);
    expect(plan.covers.map((c) => c?.panel.id)).toEqual(['front', 'back']);
  });

  it('uses the cover pages of a stapled booklet', () => {
    const b = makePiece('jewel.bookletN', { pages: 8 });
    const p = makeProject('b', 'jewel', [b]);
    const plan = defaultAlbumPlan(p, b.id, [cover(['Front'], true), cover(['Back'])]);
    expect(plan.covers.map((c) => c?.side)).toEqual(['p1', 'p8']);
  });

  it('gives the panel to the main front picture, the other scans stay in the library', () => {
    const plan = defaultAlbumPlan(jewel, booklet.id, [cover(['Front']), cover(['Front'], true)]);
    expect(plan.covers.map((c) => where(c, ids))).toEqual([null, 'booklet:outside:front']);
  });

  it('still places title and tracklist with no covers', () => {
    const plan = defaultAlbumPlan(jewel, booklet.id, []);
    expect(where(plan.titles, ids)).toBe('booklet:outside:front');
    expect(where(plan.tracklist, ids)).toBe('tray:outside:back');
  });

  it('mirrors a box onto an upside-down panel', () => {
    const back = buildDieline('jewel.ocard', {}).panels.find((p) => p.id === 'back')!;
    const r = back.rect;
    const box = onPanel({ x: r.x + 5, y: r.y + 10, w: 20, h: 8 }, back);
    expect(box.rotation).toBe(180);
    expect(box.x + box.w).toBeCloseTo(r.x + r.w - 5);
    expect(box.y + box.h).toBeCloseTo(r.y + r.h - 10);
  });
});
