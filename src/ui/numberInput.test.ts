import { describe, expect, it } from 'vitest';
import { fmtNum, parseTyped, settle, stepDecimals, unitOf } from './numberInput';

describe('numbers shown in the UI', () => {
  it('always uses a point for decimals and drops trailing zeros', () => {
    expect(fmtNum(122.5)).toBe('122.5');
    expect(fmtNum(122.46)).toBe('122.5');
    expect(fmtNum(135)).toBe('135');
    expect(fmtNum(0.4, 2)).toBe('0.4');
    expect(fmtNum(1234.5)).toBe('1234.5');
  });
});

describe('typed slider values', () => {
  it('reads numbers the way people type them', () => {
    expect(parseTyped('25')).toBe(25);
    expect(parseTyped(' 1,5 mm')).toBe(1.5);
    expect(parseTyped('25%')).toBe(25);
    expect(parseTyped('+10')).toBe(10);
    expect(parseTyped('−3')).toBe(-3);
    expect(parseTyped('-0.05')).toBe(-0.05);
    expect(parseTyped('.5')).toBe(0.5);
    expect(parseTyped('abc')).toBeNull();
    expect(parseTyped('')).toBeNull();
  });

  it('knows the decimals of a step', () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(15)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(1e-7)).toBe(7);
  });

  it('keeps values within the slider, rounded to its precision but not to whole steps', () => {
    expect(settle(37, 0, 345, 15)).toBe(37);
    expect(settle(400, 0, 345, 15)).toBe(345);
    expect(settle(-5, 0, 100, 1)).toBe(0);
    expect(settle(1.234, 0, 5, 0.1)).toBe(1.2);
    expect(settle(0.123, -0.1, 0.5, 0.01)).toBe(0.12);
    expect(settle(12.6, 10, 29, 1)).toBe(13);
  });

  it('finds the unit of a formatted value', () => {
    expect(unitOf('25%')).toBe('%');
    expect(unitOf('1.5 mm')).toBe('mm');
    expect(unitOf('45°')).toBe('°');
    expect(unitOf('+10')).toBe('');
    expect(unitOf('-0.05')).toBe('');
  });
});
