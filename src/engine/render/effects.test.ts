import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTLINE, DEFAULT_SHADOW, makeFillLayer, makeTextLayer } from '../../core/model';
import { activeShadow, blendOp, needsRaster } from './effects';
import { vectorTextLayers } from './renderFace';

describe('layer effects', () => {
  const box = { x: 0, y: 0, w: 50, h: 10 };

  it('ignores invisible shadows and maps blend modes to canvas operations', () => {
    const l = makeTextLayer('a', box);
    expect(activeShadow({ ...l, shadow: { ...DEFAULT_SHADOW, color: 'rgba(0,0,0,0)' } })).toBeNull();
    expect(activeShadow({ ...l, shadow: DEFAULT_SHADOW })).toEqual(DEFAULT_SHADOW);
    expect(blendOp(l)).toBe('source-over');
    expect(blendOp({ ...l, blend: 'normal' })).toBe('source-over');
    expect(blendOp({ ...l, blend: 'multiply' })).toBe('multiply');
  });

  it('keeps text with effects out of the vector text, and everything below it too', () => {
    const bg = makeFillLayer('#fff', box);
    const plain = makeTextLayer('plain', box);
    const outlined = { ...makeTextLayer('outlined', box), outline: DEFAULT_OUTLINE };
    const shadowed = { ...makeTextLayer('shadowed', box), shadow: DEFAULT_SHADOW };
    const blended = { ...makeTextLayer('blended', box), blend: 'multiply' as const };
    for (const fx of [outlined, shadowed, blended]) expect(needsRaster(fx)).toBe(true);
    expect(needsRaster(plain)).toBe(false);
    // Plain text above the effect layer can still be vector; plain text below it cannot.
    const v = vectorTextLayers([bg, plain, outlined, { ...plain, id: 'top' }]);
    expect([...v]).toEqual(['top']);
    expect(vectorTextLayers([bg, shadowed]).size).toBe(0);
  });
});
