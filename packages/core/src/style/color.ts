// Color parsing and alpha compositing — Spec Section 9.4 (colors) / 9.5 (alpha).
// Supported: #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() with numeric args, and
// the keywords white/black/transparent. Anything else is unresolved (null).

export interface RgbaColor {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  a: number; // 0..1
}

const KEYWORDS: Record<string, RgbaColor> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

function hexPair(hex: string, i: number): number {
  return parseInt(hex.slice(i, i + 2), 16);
}

function hexNibble(hex: string, i: number): number {
  const c = hex[i] ?? "0";
  return parseInt(c + c, 16);
}

export function parseColor(raw: string): RgbaColor | null {
  const value = raw.trim().toLowerCase();

  if (value in KEYWORDS) return { ...(KEYWORDS[value] as RgbaColor) };

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (/^[0-9a-f]{3}$/.test(hex)) {
      return { r: hexNibble(hex, 0), g: hexNibble(hex, 1), b: hexNibble(hex, 2), a: 1 };
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return { r: hexPair(hex, 0), g: hexPair(hex, 2), b: hexPair(hex, 4), a: 1 };
    }
    if (/^[0-9a-f]{8}$/.test(hex)) {
      return {
        r: hexPair(hex, 0),
        g: hexPair(hex, 2),
        b: hexPair(hex, 4),
        a: hexPair(hex, 6) / 255,
      };
    }
    return null;
  }

  const rgbMatch = /^rgba?\(\s*([^)]+)\)$/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1]?.split(",").map((s) => s.trim()) ?? [];
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts.length >= 4 && parts[3] !== undefined ? Number(parts[3]) : 1;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a };
  }

  return null;
}

/** Composites `fg` over `bg` in sRGB space, per spec 9.5. Result is always
 * fully opaque (a=1) since it represents the visible resulting color. */
export function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}
