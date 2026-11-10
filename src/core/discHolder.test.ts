/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { holderOf, holderPanel, pocketFits, pocketFor, pocketSize, projectPocket } from './discHolder';
import { splitFor } from './expand';
import { estimateSheets, kitPieces, KITS } from './kits';
import { makePiece, makeProject } from './model';
import { preflight } from './preflight';
import { ALL_ASSEMBLY_KEYS, assemblyKeysOf, buildDieline, HOLDER_POCKET, TEMPLATES } from './templates/catalog';
import { trayFor } from './tray';

describe('digipak / gatefold, one piece', () => {
  it('fits one A4 sheet whole by default', () => {
    const fit = { printerMargin: 4, margin: 8.5, minMargin: 3 };
    expect(splitFor(buildDieline('digipak.4p', {}), fit)).toBeNull();
    expect(estimateSheets(['digipak.4p']).sheets).toBe(1);
    // With 142 mm panels it is printed in two parts to join.
    expect(splitFor(buildDieline('digipak.4p', { pw: 142, h: 125 }), fit)).toHaveLength(2);
  });

  it('holds the disc on a tray or in a pocket', () => {
    const tray = makePiece('digipak.4p');
    const pocket = makePiece('digipak.4p', { holder: HOLDER_POCKET });
    expect(holderOf(tray)).toBe('tray');
    expect(holderOf(pocket)).toBe('pocket');
    expect(holderOf(makePiece('wallet.six'))).toBe('pocket');
    expect(holderOf(makePiece('jewel.tray'))).toBeNull();
    expect(trayFor(tray)).not.toBeNull();
    expect(trayFor(pocket)).toBeNull();
    // The inside panel says what goes on it.
    const inside = (p: ReturnType<typeof makePiece>) => buildDieline(p.templateId, p.params).insidePanels.find((x) => x.id === 'inRight')!.labelKey;
    expect(inside(tray)).toBe('panel.insideRightTray');
    expect(inside(pocket)).toBe('panel.insideRightPocket');
  });

  it('gives assembly steps for the chosen holder', () => {
    expect(assemblyKeysOf('digipak.4p', {}).at(-1)).toBe('asm.holder.tray');
    expect(assemblyKeysOf('digipak.4p', { holder: HOLDER_POCKET }).at(-1)).toBe('asm.holder.pocket');
    expect(assemblyKeysOf('wallet.six', {}).at(-1)).toBe('asm.holder.pocket');
    expect(ALL_ASSEMBLY_KEYS).toEqual(expect.arrayContaining(['asm.holder.tray', 'asm.holder.pocket', 'asm.cutMarks']));
  });

  it('has every assembly step translated', () => {
    for (const lang of ['it', 'en']) {
      const strings = JSON.parse(readFileSync(new URL(`../i18n/${lang}.json`, import.meta.url), 'utf8'));
      const get = (k: string) => k.split('.').reduce((o, p) => o?.[p], strings);
      for (const k of ALL_ASSEMBLY_KEYS) expect(typeof get(k), `${lang} ${k}`).toBe('string');
      for (const t of TEMPLATES) expect(typeof get(t.nameKey), `${lang} ${t.nameKey}`).toBe('string');
    }
  });
});

describe('the pocket', () => {
  const panelOf = (params: Record<string, number>) => holderPanel(makePiece('digipak.4p', params))!;

  it('fits the usual digipak and wider panels', () => {
    const pocket = makePiece('wallet.pocket');
    expect(pocketSize(pocket)).toEqual({ w: 126, h: 124 });
    expect(pocketFits(pocketSize(pocket), panelOf({}))).toBe(true);
    expect(pocketFits(pocketSize(pocket), panelOf({ pw: 142, h: 125 }))).toBe(true);
  });

  it('is sized down for a lower cover, or found too big', () => {
    expect(pocketFor(panelOf({ h: 124 }))).toEqual({ w: 126, h: 123 });
    expect(pocketFor(panelOf({ h: 120 }))).toBeNull();
    expect(pocketFits({ w: 126, h: 124 }, panelOf({ h: 120 }))).toBe(false);
  });

  it('is flagged before printing when it does not fit', () => {
    const small = makePiece('digipak.4p', { holder: HOLDER_POCKET, h: 120 });
    const p = makeProject('p', 'digipak', [small, makePiece('wallet.pocket')]);
    expect(projectPocket(p)?.templateId).toBe('wallet.pocket');
    expect(preflight(p).filter((i) => i.kind === 'pocketTooBig')).toHaveLength(1);
    // With a tray, the pocket piece is not checked against the digipak.
    p.pieces[0] = makePiece('digipak.4p', { h: 120 });
    expect(preflight(p).some((i) => i.kind === 'pocketTooBig')).toBe(false);
  });

  it('is offered with digipak, gatefold and wallet, and ticking it puts the disc in it', () => {
    const kit = KITS.find((k) => k.id === 'digipak')!;
    expect(kit.pieces.map((p) => p.templateId)).toEqual(expect.arrayContaining(['digipak.4p', 'wallet.six', 'wallet.pocket', 'dvd.digipak']));
    const withPocket = kitPieces(['digipak.4p', 'wallet.six', 'wallet.pocket', 'disc.label'].map((templateId) => ({ templateId })));
    expect(withPocket.map(holderOf)).toEqual(['pocket', 'pocket', null, null]);
    const withTray = kitPieces([{ templateId: 'digipak.4p' }, { templateId: 'disc.label' }]);
    expect(withTray.map(holderOf)).toEqual(['tray', null]);
    // The wallet keeps its pocket even without the pocket piece.
    expect(holderOf(kitPieces([{ templateId: 'wallet.six' }])[0])).toBe('pocket');
  });
});
