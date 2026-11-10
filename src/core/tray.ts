// 3D-printed disc tray for cardboard digipaks: sizes and fit.
// The solid model is built in engine/tray3d.ts.
import { holderOf, holderPanel } from './discHolder';
import type { Piece } from './model';

// The hub uses four spring arms (about 13 mm long, lying flat in a cut-out of
// the plate and bending sideways) instead of short petals, so the disc snaps on
// and off with little force. Bending strain 3*y*t / (2*L^2) is about 0.5% for
// y = 0.4, t = 1.4, L = 13 mm; 2.6 mm petals would need about 13%, more than
// PLA or PETG can take. Each arm ends in a post that grips the 15 mm hole, with
// a lead-in chamfer and a lip that holds the disc.

/** How tightly the hub holds the disc: printers differ, so it is a preference. */
export type HubFit = 'tight' | 'normal' | 'loose';

/** Per fit: arm width (stiffness, mm) and lip (how far the tooth reaches over the disc, mm). */
export const HUB: Record<HubFit, { arm: number; lip: number }> = {
  loose: { arm: 1.2, lip: 0.25 },
  normal: { arm: 1.4, lip: 0.35 },
  tight: { arm: 1.6, lip: 0.45 },
};

export interface TrayParams {
  /** Plate size (mm); for the test piece, the diameter of a round plate. */
  w: number;
  h: number;
  plate: number;
  fit: HubFit;
  /** Outside panel the tray is glued behind (its inside face). */
  panelId: string;
  /** Small round piece with the hub only, to try the grip before printing a whole tray. */
  test?: boolean;
}

/** Clearance all round (mm), so the tray never reaches the folds. */
const CLEARANCE = 1.5;
const PLATE = 1.2;

/** Tray sized to the holder panel, or null when the piece does not use a tray. */
export function trayFor(piece: Piece, fit: HubFit = 'normal'): TrayParams | null {
  if (holderOf(piece) !== 'tray') return null;
  const p = holderPanel(piece);
  if (!p) return null;
  return { w: p.rect.w - 2 * CLEARANCE, h: p.rect.h - 2 * CLEARANCE, plate: PLATE, fit, panelId: p.id };
}

/** The hub alone on a 44 mm disc: a few minutes to print. */
export const trayTestPiece = (fit: HubFit): TrayParams => ({ w: 44, h: 44, plate: PLATE, fit, panelId: '', test: true });

// Disc: 1.2 mm thick, 15 mm hole; its clamping area (22-36 mm) rests on the ring.
export const DISC_T = 1.2;
export const DISC_HOLE_R = 7.5;
export const RING_IN = 11, RING_OUT = 18, RING_H = 0.8;
/** Cut-out in the plate where the arms move (they touch the plate only at their root). */
export const HUB_HOLE_R = 10.7;
export const ARMS = 4;
/** Each arm turns 90 deg while going from the root radius to the tip radius. */
export const ARM_SWEEP = Math.PI / 2;
export const ARM_ROOT_R = 9.3, ARM_TIP_R = 6.9;
/** Grip radius of the posts (the hole is 7.5): a slight preload centres the disc. */
export const GRIP_R = 7.55, POST_IN_R = 6.0;
export const POST_SPAN = (18 * Math.PI) / 180;
/** Finger notches through the plate at the disc edge, left and right. */
export const NOTCH = { x: 52, r: 9 };

/** How far the posts rise above the disc: the lip that holds it, then a lead-in chamfer. */
export const POST_ABOVE_DISC = 1.45;

/** Height of the disc's underside above the base. */
export const discZ = (p: TrayParams) => p.plate + RING_H;

/** Total height of the tray (top of the posts): the closed cover needs at least this inside. */
export function trayHeight(p: TrayParams): number {
  return discZ(p) + DISC_T + POST_ABOVE_DISC;
}
