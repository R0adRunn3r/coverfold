// CSS colours as the app writes them (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()):
// parsing, formatting and contrast, without a canvas (usable in core checks).

/** Colour as hex (#rrggbb) and alpha (0-1); null if not understood. */
export function parseColor(v: string): { hex: string; a: number } | null {
  const h = v.trim().toLowerCase();
  const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  let m = /^#([0-9a-f]{3})$/.exec(h);
  if (m) return { hex: `#${[...m[1]].map((c) => c + c).join('')}`, a: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(h);
  if (m) return { hex: `#${m[1]}`, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(([^)]+)\)$/.exec(h);
  if (m) {
    const [r, g, b, a] = m[1].split(',').map((x) => parseFloat(x));
    if ([r, g, b].some((x) => !Number.isFinite(x))) return null;
    return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, a: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1 };
  }
  return null;
}

/** Hex + alpha back to a CSS colour: plain hex when opaque, rgba() otherwise. */
export function formatColor(hex: string, a: number): string {
  if (a >= 0.995) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 100) / 100})`;
}

/** Relative luminance (WCAG) of a colour composited over white; null if not understood. */
export function luminance(color: string): number | null {
  const c = parseColor(color);
  if (!c) return null;
  const n = parseInt(c.hex.slice(1), 16);
  const lin = (v: number) => {
    const s = (v * c.a + 255 * (1 - c.a)) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio (1 to 21); null if either colour is not understood. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
