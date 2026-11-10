// Enlarging small images for print. The browser's bicubic scaling is soft
// when an image is blown up several times; Lanczos-3 keeps edges and text
// crisper, and a light unsharp mask scaled to the enlargement restores some
// contrast. Pure functions on RGBA arrays, no DOM.

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number, a: number) => (Math.abs(x) < a ? sinc(x) * sinc(x / a) : 0);

interface Taps { start: Int32Array; count: number; w: Float32Array }

/** Normalised Lanczos weights for one axis (handles both up- and downscaling). */
function taps(srcLen: number, dstLen: number, a: number): Taps {
  const scale = dstLen / srcLen;
  const support = scale < 1 ? a / scale : a;
  const count = Math.ceil(support) * 2 + 1;
  const start = new Int32Array(dstLen);
  const w = new Float32Array(dstLen * count);
  const k = scale < 1 ? scale : 1;
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const s = Math.floor(center - support) + 1;
    start[i] = s;
    let sum = 0;
    for (let j = 0; j < count; j++) {
      const v = lanczos((s + j - center) * k, a);
      w[i * count + j] = v;
      sum += v;
    }
    for (let j = 0; j < count; j++) w[i * count + j] /= sum || 1;
  }
  return { start, count, w };
}

/** Lanczos-3 resize. Works on premultiplied alpha so transparent edges get no dark fringe. */
export function lanczosResize(src: Pixels, dw: number, dh: number, a = 3): Pixels {
  const { width: sw, height: sh, data } = src;
  const pre = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const al = data[i * 4 + 3] / 255;
    pre[i * 4] = data[i * 4] * al;
    pre[i * 4 + 1] = data[i * 4 + 1] * al;
    pre[i * 4 + 2] = data[i * 4 + 2] * al;
    pre[i * 4 + 3] = data[i * 4 + 3];
  }
  // Horizontal pass: sw x sh to dw x sh.
  const tx = taps(sw, dw, a);
  const mid = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      const s = tx.start[x];
      for (let j = 0; j < tx.count; j++) {
        const wgt = tx.w[x * tx.count + j];
        if (wgt === 0) continue;
        const sx = Math.min(sw - 1, Math.max(0, s + j));
        const p = (row + sx) * 4;
        r += pre[p] * wgt; g += pre[p + 1] * wgt; b += pre[p + 2] * wgt; al += pre[p + 3] * wgt;
      }
      const o = (y * dw + x) * 4;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = al;
    }
  }
  // Vertical pass: dw x sh to dw x dh, then un-premultiply.
  const ty = taps(sh, dh, a);
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const s = ty.start[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let j = 0; j < ty.count; j++) {
        const wgt = ty.w[y * ty.count + j];
        if (wgt === 0) continue;
        const sy = Math.min(sh - 1, Math.max(0, s + j));
        const p = (sy * dw + x) * 4;
        r += mid[p] * wgt; g += mid[p + 1] * wgt; b += mid[p + 2] * wgt; al += mid[p + 3] * wgt;
      }
      const o = (y * dw + x) * 4;
      const A = Math.min(255, Math.max(0, al));
      const inv = A > 0 ? 255 / A : 0;
      out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv; out[o + 3] = A;
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Separable box-approximated Gaussian blur (3 box passes) of one float channel. */
function blurChannel(ch: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  // Work on a copy: the passes ping-pong between two buffers.
  let a = ch.slice(), b = new Float32Array(ch.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += a[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * Unsharp mask on luminance only (no colour fringes): out = in + amount * (in - blur).
 * `sigma` in output pixels.
 */
export function unsharp(img: Pixels, sigma: number, amount: number): void {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const blur = blurChannel(lum, w, h, sigma);
  for (let i = 0; i < n; i++) {
    const d = amount * (lum[i] - blur[i]);
    data[i * 4] += d; data[i * 4 + 1] += d; data[i * 4 + 2] += d;
  }
}

/** Lanczos-3, then above 1.5x an unsharp mask whose radius follows the enlargement. */
export function enlarge(src: Pixels, dw: number, dh: number): Pixels {
  const out = lanczosResize(src, dw, dh);
  const factor = Math.min(dw / src.width, dh / src.height);
  if (factor > 1.5) unsharp(out, Math.min(6, 0.5 * factor), 0.35);
  return out;
}
