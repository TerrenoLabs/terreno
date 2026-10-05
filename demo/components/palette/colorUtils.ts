import type {ThemePrimitiveColors} from "@terreno/ui";

/**
 * Color math utilities for the palette generator: hex/RGB/HSL conversions, deterministic
 * 000-900 shade ramp generation from a single anchor color, and WCAG 2.1 contrast checks.
 * Kept dependency-free so it can be unit tested with `bun test` and reused on web + native.
 */

/** @internal */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  /** Hue in degrees, 0-360. */
  h: number;
  /** Saturation, 0-1. */
  s: number;
  /** Lightness, 0-1. */
  l: number;
}

/** The 11 shade steps used by the four main Terreno color families. */
export const SHADE_KEYS = [
  "000",
  "050",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;

/** Shade steps for status families. 050 is the dark-mode error, success, and warning surface. */
export const STATUS_SHADE_KEYS = ["000", "050", "100", "200"] as const;

/** @internal */
export type ShadeKey = (typeof SHADE_KEYS)[number];
/** @internal */
export type StatusShadeKey = (typeof STATUS_SHADE_KEYS)[number];

/** The four main tonal families the generator produces full 000-900 ramps for. */
export const MAIN_FAMILIES = ["neutral", "primary", "secondary", "accent"] as const;
/** Status families use a compact 000/050/100/200 ramp. */
export const STATUS_FAMILIES = ["error", "warning", "success"] as const;

export type MainFamily = (typeof MAIN_FAMILIES)[number];
export type StatusFamily = (typeof STATUS_FAMILIES)[number];

/**
 * How far to blend each shade away from the anchor, keeping the anchor color verbatim at 500.
 * Positive values interpolate toward white (lighter shades); negative values toward black (darker
 * shades). This preserves the user's exact typed color at 500 while guaranteeing a monotonic ramp.
 */
const SHADE_BLEND: Record<Exclude<ShadeKey, "500">, number> = {
  "000": 0.93,
  "050": 0.8,
  "100": 0.64,
  "200": 0.46,
  "300": 0.28,
  "400": 0.12,
  "600": -0.15,
  "700": -0.32,
  "800": -0.52,
  "900": -0.72,
};

/** Blend factors for the compact status ramp; the anchor is kept verbatim at 100. */
const STATUS_BLEND: Record<StatusShadeKey, number> = {
  "000": 0.82,
  "050": 0.55,
  "100": 0,
  "200": -0.28,
};

/**
 * Blend an anchor's HSL toward white (t > 0) or black (t < 0) by adjusting lightness only, easing
 * saturation down toward the extremes so light steps do not look neon and dark steps stay rich.
 */
const blendShade = (anchor: Hsl, t: number): string => {
  if (t === 0) {
    return hslToHex(anchor);
  }
  const magnitude = Math.abs(t);
  const targetL = t > 0 ? anchor.l + (1 - anchor.l) * t : anchor.l * (1 + t);
  const saturation = clamp(anchor.s * (1 - magnitude * 0.3), 0, 1);
  return hslToHex({h: anchor.h, l: targetL, s: saturation});
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const toHexChannel = (value: number): string => {
  const clamped = Math.round(clamp(value, 0, 255));
  return clamped.toString(16).padStart(2, "0");
};

/**
 * Normalize user input into a `#rrggbb` string, expanding 3-digit shorthand and adding a leading
 * `#`. Returns `undefined` when the input is not a valid hex color.
 */
export const normalizeHex = (input: string): string | undefined => {
  if (!input) {
    return undefined;
  }
  const trimmed = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return undefined;
};

/** Parse a hex string into an RGB triple, or `undefined` when invalid. */
/** @internal */
export const hexToRgb = (hex: string): Rgb | undefined => {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return undefined;
  }
  const value = normalized.slice(1);
  return {
    b: Number.parseInt(value.slice(4, 6), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    r: Number.parseInt(value.slice(0, 2), 16),
  };
};

/** Convert an RGB triple to a `#rrggbb` string. */
/** @internal */
export const rgbToHex = ({r, g, b}: Rgb): string => {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
};

/** Convert an RGB triple (0-255) to HSL. */
const rgbToHsl = ({r, g, b}: Rgb): Hsl => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return {h: 0, l, s: 0};
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) {
    h += 360;
  }
  return {h, l, s};
};

/** Convert HSL to an RGB triple (0-255). */
const hslToRgb = ({h, s, l}: Hsl): Rgb => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) {
    [r1, g1, b1] = [c, x, 0];
  } else if (hp < 2) {
    [r1, g1, b1] = [x, c, 0];
  } else if (hp < 3) {
    [r1, g1, b1] = [0, c, x];
  } else if (hp < 4) {
    [r1, g1, b1] = [0, x, c];
  } else if (hp < 5) {
    [r1, g1, b1] = [x, 0, c];
  } else {
    [r1, g1, b1] = [c, 0, x];
  }
  const m = l - c / 2;
  return {
    b: (b1 + m) * 255,
    g: (g1 + m) * 255,
    r: (r1 + m) * 255,
  };
};

export const hexToHsl = (hex: string): Hsl | undefined => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return undefined;
  }
  return rgbToHsl(rgb);
};

export const hslToHex = (hsl: Hsl): string => {
  return rgbToHex(hslToRgb(hsl));
};

/**
 * Generate the full 000-900 ramp for a main color family from a single anchor color. The anchor is
 * placed verbatim at the 500 step; lighter and darker steps track fixed target lightness values
 * while preserving the anchor hue. Saturation is eased toward the extremes so very light and very
 * dark steps do not look neon.
 */
/** @internal */
export const generateColorScale = (anchorHex: string): Record<ShadeKey, string> => {
  const anchorHsl = hexToHsl(anchorHex);
  const normalizedAnchor = normalizeHex(anchorHex);
  if (!anchorHsl || !normalizedAnchor) {
    throw new Error(`Invalid anchor color: ${anchorHex}`);
  }

  const result = {} as Record<ShadeKey, string>;
  for (const shade of SHADE_KEYS) {
    if (shade === "500") {
      result[shade] = normalizedAnchor;
      continue;
    }
    result[shade] = blendShade(anchorHsl, SHADE_BLEND[shade]);
  }
  return result;
};

/** Generate the compact 000/050/100/200 ramp for a status family from an anchor color. */
/** @internal */
export const generateStatusScale = (anchorHex: string): Record<StatusShadeKey, string> => {
  const anchorHsl = hexToHsl(anchorHex);
  const normalizedAnchor = normalizeHex(anchorHex);
  if (!anchorHsl || !normalizedAnchor) {
    throw new Error(`Invalid anchor color: ${anchorHex}`);
  }
  const result = {} as Record<StatusShadeKey, string>;
  for (const shade of STATUS_SHADE_KEYS) {
    result[shade] = shade === "100" ? normalizedAnchor : blendShade(anchorHsl, STATUS_BLEND[shade]);
  }
  return result;
};

/** Anchor colors (one per family) that seed the generated palette. */
export interface PaletteAnchors {
  neutral: string;
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
}

/**
 * Expand a set of anchor colors into the full flat map of color primitives consumed by
 * `ThemeProvider` / `setPrimitives` (e.g. `primary500`, `neutral050`, `error100`, ...).
 */
export const generatePrimitivesFromAnchors = (
  anchors: PaletteAnchors
): Partial<ThemePrimitiveColors> => {
  const primitives: Record<string, string> = {};

  for (const family of MAIN_FAMILIES) {
    const scale = generateColorScale(anchors[family]);
    for (const shade of SHADE_KEYS) {
      primitives[`${family}${shade}`] = scale[shade];
    }
  }

  for (const family of STATUS_FAMILIES) {
    const scale = generateStatusScale(anchors[family]);
    for (const shade of STATUS_SHADE_KEYS) {
      primitives[`${family}${shade}`] = scale[shade];
    }
  }

  return primitives as Partial<ThemePrimitiveColors>;
};

/**
 * A tone constraint applied to a semantic family so its meaning stays legible: an optional hue band
 * (center + max deviation, in degrees) plus optional saturation limits (0-1). Families without a
 * lock (primary/secondary/accent) are free brand colors.
 */
interface ToneLock {
  /** Center hue in degrees the family should stay near. */
  hueCenter?: number;
  /** Maximum allowed deviation from `hueCenter` in degrees (circular). */
  hueTolerance?: number;
  /** Maximum saturation (0-1); values above are clamped down (keeps neutral gray). */
  maxSaturation?: number;
  /** Minimum saturation (0-1); values below are clamped up. */
  minSaturation?: number;
}

/**
 * The semantic families whose tone is locked so they keep conveying their meaning: error stays red,
 * warning orange/amber, success green, and neutral a low-saturation gray. Bands are intentionally
 * generous so users still have room to pick a specific shade within the correct tone.
 */
const FAMILY_TONE_LOCKS: Partial<Record<MainFamily | StatusFamily, ToneLock>> = {
  error: {hueCenter: 0, hueTolerance: 18},
  neutral: {maxSaturation: 0.12},
  success: {hueCenter: 130, hueTolerance: 45},
  warning: {hueCenter: 35, hueTolerance: 20},
};

/**
 * Snap a hue (degrees) into a band centered on `center` with a maximum deviation of `tolerance`,
 * taking the shorter way around the color wheel so bands that straddle 0/360 (e.g. red) wrap
 * correctly. Returns a value in [0, 360).
 */
/** @internal */
export const clampHueToBand = (hue: number, center: number, tolerance: number): number => {
  const normalized = ((hue % 360) + 360) % 360;
  const signedDistance = ((normalized - center + 540) % 360) - 180;
  if (Math.abs(signedDistance) <= tolerance) {
    return normalized;
  }
  const edge = signedDistance > 0 ? center + tolerance : center - tolerance;
  return ((edge % 360) + 360) % 360;
};

/**
 * Constrain an anchor color to its family's locked tone: status families (error/warning/success)
 * are snapped into their hue band (red/amber/green) and neutral is pulled toward gray by capping
 * saturation. Unlocked families (primary/secondary/accent) and invalid input are returned as-is, and
 * an already-in-tone color is returned verbatim so the exact anchor is preserved at its ramp step.
 */
export const constrainAnchorToFamilyTone = (
  family: MainFamily | StatusFamily,
  hex: string
): string => {
  const normalized = normalizeHex(hex);
  const lock = FAMILY_TONE_LOCKS[family];
  if (!normalized || !lock) {
    return normalized ?? hex;
  }
  const hsl = hexToHsl(normalized);
  if (!hsl) {
    return normalized;
  }
  let hue = hsl.h;
  let saturation = hsl.s;
  // A pure gray has a meaningless hue, so only snap the hue when there is real chroma to place.
  if (lock.hueCenter !== undefined && lock.hueTolerance !== undefined && saturation > 0) {
    hue = clampHueToBand(hue, lock.hueCenter, lock.hueTolerance);
  }
  if (lock.maxSaturation !== undefined) {
    saturation = Math.min(saturation, lock.maxSaturation);
  }
  if (lock.minSaturation !== undefined) {
    saturation = Math.max(saturation, lock.minSaturation);
  }
  if (hue === hsl.h && saturation === hsl.s) {
    return normalized;
  }
  return hslToHex({h: hue, l: hsl.l, s: saturation});
};

/** Apply {@link constrainAnchorToFamilyTone} to every family in an anchor set. */
export const constrainAnchorsToFamilyTones = (anchors: PaletteAnchors): PaletteAnchors => {
  const result = {...anchors};
  for (const family of [...MAIN_FAMILIES, ...STATUS_FAMILIES]) {
    result[family] = constrainAnchorToFamilyTone(family, anchors[family]);
  }
  return result;
};

/**
 * Relative luminance of an sRGB color per the WCAG 2.1 definition. Used as the basis for contrast
 * ratio computation.
 */
/** @internal */
export const relativeLuminance = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

/** WCAG contrast ratio between two colors, from 1 (identical) to 21 (black on white). */
/** @internal */
export const contrastRatio = (foreground: string, background: string): number => {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

export interface WcagAssessment {
  ratio: number;
  /** Passes AA for normal text (>= 4.5:1). */
  aa: boolean;
  /** Passes AA for large text (>= 3:1). */
  aaLarge: boolean;
  /** Passes AAA for normal text (>= 7:1). */
  aaa: boolean;
  /** Passes AAA for large text (>= 4.5:1). */
  aaaLarge: boolean;
}

/** Assess a foreground/background pair against all WCAG 2.1 contrast thresholds. */
export const assessContrast = (foreground: string, background: string): WcagAssessment => {
  const ratio = contrastRatio(foreground, background);
  return {
    aa: ratio >= 4.5,
    aaa: ratio >= 7,
    aaaLarge: ratio >= 4.5,
    aaLarge: ratio >= 3,
    ratio,
  };
};

/** Round a contrast ratio to a readable `x.xx` string. */
export const formatRatio = (ratio: number): string => {
  return `${Math.round(ratio * 100) / 100}:1`;
};

/** Pick black or white text for the strongest contrast against a given background. */
export const readableTextColor = (background: string): string => {
  const white = contrastRatio("#ffffff", background);
  const black = contrastRatio("#000000", background);
  return white >= black ? "#ffffff" : "#000000";
};
