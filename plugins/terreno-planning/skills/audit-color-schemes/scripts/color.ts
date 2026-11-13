// WCAG 2.x color math shared by the audit-color-schemes scripts.
//
// Parses the color strings React Native accepts in practice (hex 3/4/6/8, rgb/rgba,
// hsl/hsla, a small set of named colors), composites translucent colors over the surface
// they sit on, and returns the WCAG contrast ratio.

export interface Rgba {
  a: number;
  b: number;
  g: number;
  r: number;
}

/** WCAG 1.4.3 normal text. */
export const AA_TEXT = 4.5;
/** WCAG 1.4.3 large text (18pt / 14pt bold) and WCAG 1.4.11 non-text UI. */
export const AA_LARGE_OR_UI = 3;

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  blue: "#0000FF",
  gray: "#808080",
  green: "#008000",
  grey: "#808080",
  lightgray: "#D3D3D3",
  lightgrey: "#D3D3D3",
  orange: "#FFA500",
  purple: "#800080",
  red: "#FF0000",
  white: "#FFFFFF",
  yellow: "#FFFF00",
};

export const NAMED_COLOR_NAMES = Object.keys(NAMED_COLORS);

const parseHex = (value: string): Rgba | undefined => {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value);
  const digits = match?.[1];
  if (!digits || ![3, 4, 6, 8].includes(digits.length)) {
    return undefined;
  }
  const full =
    digits.length <= 4
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return {
    a: full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1,
    b: Number.parseInt(full.slice(4, 6), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    r: Number.parseInt(full.slice(0, 2), 16),
  };
};

const hslToRgb = (h: number, s: number, l: number): {b: number; g: number; r: number} => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] =
    segment < 1
      ? [chroma, x, 0]
      : segment < 2
        ? [x, chroma, 0]
        : segment < 3
          ? [0, chroma, x]
          : segment < 4
            ? [0, x, chroma]
            : segment < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = l - chroma / 2;
  return {b: (b1 + m) * 255, g: (g1 + m) * 255, r: (r1 + m) * 255};
};

const parseFunctional = (value: string): Rgba | undefined => {
  const match = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(value);
  if (!match) {
    return undefined;
  }
  const parts = match[2]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => part.trim());
  if (parts.length < 3) {
    return undefined;
  }
  const alphaPart = parts[3];
  const a = alphaPart
    ? alphaPart.endsWith("%")
      ? Number.parseFloat(alphaPart) / 100
      : Number.parseFloat(alphaPart)
    : 1;
  if (match[1].toLowerCase().startsWith("rgb")) {
    const [r, g, b] = parts
      .slice(0, 3)
      .map((part) =>
        part.endsWith("%") ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part)
      );
    return {a, b, g, r};
  }
  const [h, s, l] = [
    Number.parseFloat(parts[0]),
    Number.parseFloat(parts[1]) / 100,
    Number.parseFloat(parts[2]) / 100,
  ];
  return {a, ...hslToRgb(h, s, l)};
};

/** Parse a color string; returns undefined for anything that is not a concrete color. */
export const parseColor = (input: string): Rgba | undefined => {
  const value = input.trim().toLowerCase();
  if (value === "transparent") {
    return {a: 0, b: 0, g: 0, r: 0};
  }
  const named = NAMED_COLORS[value];
  if (named) {
    return parseHex(named);
  }
  return parseHex(value) ?? parseFunctional(value);
};

/** Alpha-composite `top` over an opaque `bottom`. */
export const composite = (top: Rgba, bottom: Rgba): Rgba => ({
  a: 1,
  b: top.b * top.a + bottom.b * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  r: top.r * top.a + bottom.r * (1 - top.a),
});

const channel = (value: number): number => {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const luminance = (rgb: Rgba): number =>
  0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);

/**
 * WCAG contrast ratio of `foreground` drawn on `background`. A translucent background is
 * first composited over `base` (the page surface); a translucent foreground over the
 * resulting background. Returns undefined when either color cannot be parsed.
 */
export const contrastRatio = ({
  background,
  base = "#FFFFFF",
  foreground,
}: {
  background: string;
  base?: string;
  foreground: string;
}): number | undefined => {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const page = parseColor(base);
  if (!fg || !bg || !page) {
    return undefined;
  }
  const opaqueBackground = bg.a < 1 ? composite(bg, {...page, a: 1}) : bg;
  const opaqueForeground = fg.a < 1 ? composite(fg, opaqueBackground) : fg;
  const lighter = Math.max(luminance(opaqueForeground), luminance(opaqueBackground));
  const darker = Math.min(luminance(opaqueForeground), luminance(opaqueBackground));
  return (lighter + 0.05) / (darker + 0.05);
};

/** Euclidean RGB distance, good enough to suggest the nearest theme token. */
export const colorDistance = (left: string, right: string): number => {
  const a = parseColor(left);
  const b = parseColor(right);
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
};

export const formatRatio = (ratio: number | undefined): string =>
  ratio === undefined ? "n/a" : `${ratio.toFixed(2)}:1`;
