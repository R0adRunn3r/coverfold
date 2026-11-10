// The part of the dieline each assembly step is about, so the instructions can
// highlight it on a small drawing of the flat piece.

export type StepHighlight = 'cut' | 'folds' | 'glue' | 'seams' | 'none';

const CUT = /^asm\.(cutMarks|cutLine|disc\.cut|flap\.slit)$/;
const FOLD = /^asm\.(scoreFolds|.*\.fold|sleeve\.flaps|slipcase\.walls|obi\.wrap)$/;
const GLUE = /^asm\.(.*\.glue)$/;

export function stepHighlight(key: string): StepHighlight {
  if (CUT.test(key)) return 'cut';
  if (FOLD.test(key)) return 'folds';
  if (GLUE.test(key)) return 'glue';
  return 'none';
}
