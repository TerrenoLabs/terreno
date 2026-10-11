export const WCAG_NORMAL_TEXT_CONTRAST = 4.5;

const srgbChannel = (value: number): number => {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const parseHex = (hex: string): {b: number; g: number; r: number} | undefined => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match?.[1];
  if (!value) {
    return undefined;
  }
  return {
    b: Number.parseInt(value.slice(4, 6), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    r: Number.parseInt(value.slice(0, 2), 16),
  };
};

const luminance = (rgb: {b: number; g: number; r: number}): number => {
  return 0.2126 * srgbChannel(rgb.r) + 0.7152 * srgbChannel(rgb.g) + 0.0722 * srgbChannel(rgb.b);
};

/** WCAG contrast ratio, from 1 (identical) to 21 (black on white). Unparsed colors return 1. */
export const contrastRatio = (foreground: string, background: string): number => {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) {
    return 1;
  }
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Text role that meets WCAG AA for normal text on `background`.
 * Prefers `primary` so unchanged surfaces keep their current color.
 */
export const readableTextColor = (
  primary: string,
  inverted: string,
  background: string
): "inverted" | "primary" => {
  const primaryRatio = contrastRatio(primary, background);
  if (primaryRatio >= WCAG_NORMAL_TEXT_CONTRAST) {
    return "primary";
  }
  const invertedRatio = contrastRatio(inverted, background);
  if (invertedRatio > primaryRatio) {
    return "inverted";
  }
  return "primary";
};
