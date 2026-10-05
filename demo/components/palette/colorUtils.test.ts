import {describe, expect, it} from "bun:test";

import {
  assessContrast,
  clampHueToBand,
  constrainAnchorsToFamilyTones,
  constrainAnchorToFamilyTone,
  contrastRatio,
  generateColorScale,
  generatePrimitivesFromAnchors,
  generateStatusScale,
  hexToHsl,
  hexToRgb,
  hslToHex,
  normalizeHex,
  type PaletteAnchors,
  readableTextColor,
  relativeLuminance,
  rgbToHex,
  SHADE_KEYS,
  STATUS_SHADE_KEYS,
} from "./colorUtils";

describe("normalizeHex", () => {
  it("expands 3-digit shorthand", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("f00")).toBe("#ff0000");
  });

  it("normalizes 6-digit values and casing", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHex("0086B3")).toBe("#0086b3");
  });

  it("returns undefined for invalid input", () => {
    expect(normalizeHex("")).toBeUndefined();
    expect(normalizeHex("nope")).toBeUndefined();
    expect(normalizeHex("#12345")).toBeUndefined();
  });
});

describe("rgb/hsl conversions", () => {
  it("round-trips hex through rgb", () => {
    expect(rgbToHex(hexToRgb("#0086b3")!)).toBe("#0086b3");
  });

  it("round-trips hex through hsl within tolerance", () => {
    const original = "#0086b3";
    const roundTripped = hslToHex(hexToHsl(original)!);
    const a = hexToRgb(original)!;
    const b = hexToRgb(roundTripped)!;
    expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(2);
  });

  it("treats grays as zero saturation", () => {
    expect(hexToHsl("#808080")!.s).toBe(0);
  });
});

describe("generateColorScale", () => {
  it("produces all 11 shades", () => {
    const scale = generateColorScale("#0086b3");
    expect(Object.keys(scale).sort()).toEqual([...SHADE_KEYS].sort());
  });

  it("places the anchor verbatim at 500", () => {
    expect(generateColorScale("#0086b3")["500"]).toBe("#0086b3");
  });

  it("ramps from light to dark monotonically", () => {
    const scale = generateColorScale("#0086b3");
    const luminances = SHADE_KEYS.map((shade) => relativeLuminance(scale[shade]));
    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]).toBeLessThanOrEqual(luminances[i - 1] + 0.0001);
    }
  });

  it("throws on invalid anchor", () => {
    expect(() => generateColorScale("bogus")).toThrow();
  });
});

describe("generateStatusScale", () => {
  it("produces the compact ramp, including the dark-mode 050 step", () => {
    const scale = generateStatusScale("#d33232");
    expect(Object.keys(scale).sort()).toEqual([...STATUS_SHADE_KEYS].sort());
    expect(scale["050"]).toBeDefined();
    const luminances = STATUS_SHADE_KEYS.map((shade) => relativeLuminance(scale[shade]));
    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]).toBeLessThanOrEqual(luminances[i - 1] + 0.0001);
    }
  });
});

describe("generatePrimitivesFromAnchors", () => {
  const anchors: PaletteAnchors = {
    accent: "#d69c0e",
    error: "#d33232",
    neutral: "#9a9a9a",
    primary: "#0086b3",
    secondary: "#2b6072",
    success: "#3ea45c",
    warning: "#f36719",
  };

  it("emits every expected primitive key", () => {
    const primitives = generatePrimitivesFromAnchors(anchors);
    expect(primitives.primary500).toBe("#0086b3");
    expect(primitives.neutral000).toBeDefined();
    expect(primitives.accent900).toBeDefined();
    expect(primitives.error100).toBeDefined();
    expect(primitives.warning200).toBeDefined();
    expect(primitives.success000).toBeDefined();
    expect(primitives.error050).toBeDefined();
    expect(primitives.success050).toBeDefined();
    expect(primitives.warning050).toBeDefined();
    // 4 families * 11 shades + 3 status families * 4 shades = 56 keys
    expect(Object.keys(primitives).length).toBe(56);
  });
});

describe("clampHueToBand", () => {
  it("leaves an in-band hue unchanged", () => {
    expect(clampHueToBand(130, 130, 45)).toBe(130);
    expect(clampHueToBand(100, 130, 45)).toBe(100);
  });

  it("snaps an out-of-band hue to the nearest edge", () => {
    expect(clampHueToBand(240, 130, 45)).toBe(175);
    expect(clampHueToBand(60, 130, 45)).toBe(85);
  });

  it("wraps correctly around 0/360 for red", () => {
    expect(clampHueToBand(350, 0, 18)).toBe(350);
    expect(clampHueToBand(10, 0, 18)).toBe(10);
    // Blue is far from red on both sides; snaps to the nearer edge (342).
    expect(clampHueToBand(220, 0, 18)).toBe(342);
    // Just past the warm edge snaps down to +18.
    expect(clampHueToBand(90, 0, 18)).toBe(18);
  });
});

describe("constrainAnchorToFamilyTone", () => {
  // Circular distance (degrees) between two hues, tolerant of ±1° hex round-trip rounding.
  const hueDistance = (hue: number, center: number): number => {
    const diff = Math.abs((((hue - center) % 360) + 360) % 360);
    return Math.min(diff, 360 - diff);
  };
  const hueOf = (hex: string): number => hexToHsl(hex)!.h;

  it("keeps unlocked families (primary/secondary/accent) unchanged", () => {
    expect(constrainAnchorToFamilyTone("primary", "#0000ff")).toBe("#0000ff");
    expect(constrainAnchorToFamilyTone("accent", "#00ff00")).toBe("#00ff00");
  });

  it("returns an in-tone anchor verbatim", () => {
    expect(constrainAnchorToFamilyTone("error", "#d33232")).toBe("#d33232");
    expect(constrainAnchorToFamilyTone("success", "#3ea45c")).toBe("#3ea45c");
    expect(constrainAnchorToFamilyTone("warning", "#f36719")).toBe("#f36719");
  });

  it("snaps a blue 'error' back into the red band", () => {
    const result = constrainAnchorToFamilyTone("error", "#2b6cff");
    // Red band is centered on 0 with an 18° tolerance (plus rounding slack).
    expect(hueDistance(hueOf(result), 0)).toBeLessThanOrEqual(20);
  });

  it("snaps a purple 'success' back into the green band", () => {
    const result = constrainAnchorToFamilyTone("success", "#8a2be2");
    expect(hueDistance(hueOf(result), 130)).toBeLessThanOrEqual(47);
  });

  it("snaps a magenta 'warning' back into the amber band", () => {
    const result = constrainAnchorToFamilyTone("warning", "#ff00ff");
    expect(hueDistance(hueOf(result), 35)).toBeLessThanOrEqual(22);
  });

  it("caps neutral saturation to keep it gray", () => {
    const result = constrainAnchorToFamilyTone("neutral", "#1e90ff");
    expect(hexToHsl(result)!.s).toBeLessThanOrEqual(0.12 + 1e-6);
  });

  it("preserves lightness when snapping the hue", () => {
    const result = constrainAnchorToFamilyTone("error", "#2b6cff");
    expect(Math.abs(hexToHsl(result)!.l - hexToHsl("#2b6cff")!.l)).toBeLessThanOrEqual(0.01);
  });

  it("returns invalid input as-is", () => {
    expect(constrainAnchorToFamilyTone("error", "nope")).toBe("nope");
  });
});

describe("constrainAnchorsToFamilyTones", () => {
  const hueDistance = (hue: number, center: number): number => {
    const diff = Math.abs((((hue - center) % 360) + 360) % 360);
    return Math.min(diff, 360 - diff);
  };

  it("locks status/neutral families but preserves brand families", () => {
    const anchors: PaletteAnchors = {
      accent: "#123456",
      error: "#3355ff",
      neutral: "#1e90ff",
      primary: "#8a2be2",
      secondary: "#00ffcc",
      success: "#ff00ff",
      warning: "#0000ff",
    };
    const locked = constrainAnchorsToFamilyTones(anchors);
    // Brand families are untouched.
    expect(locked.primary).toBe("#8a2be2");
    expect(locked.secondary).toBe("#00ffcc");
    expect(locked.accent).toBe("#123456");
    // Neutral is desaturated toward gray.
    expect(hexToHsl(locked.neutral)!.s).toBeLessThanOrEqual(0.12 + 1e-6);
    // Success is forced into the green band.
    expect(hueDistance(hexToHsl(locked.success)!.h, 130)).toBeLessThanOrEqual(47);
  });

  it("leaves the default anchors unchanged", () => {
    const defaults: PaletteAnchors = {
      accent: "#d69c0e",
      error: "#d33232",
      neutral: "#9a9a9a",
      primary: "#0086b3",
      secondary: "#2b6072",
      success: "#3ea45c",
      warning: "#f36719",
    };
    expect(constrainAnchorsToFamilyTones(defaults)).toEqual(defaults);
  });
});

describe("WCAG contrast", () => {
  it("computes the canonical black/white ratio as 21", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });

  it("computes identical colors as 1", () => {
    expect(contrastRatio("#123456", "#123456")).toBe(1);
  });

  it("flags a failing low-contrast pair", () => {
    const assessment = assessContrast("#cccccc", "#ffffff");
    expect(assessment.aa).toBe(false);
    expect(assessment.aaLarge).toBe(false);
  });

  it("passes AA and AAA for strong contrast", () => {
    const assessment = assessContrast("#1c1c1c", "#ffffff");
    expect(assessment.aa).toBe(true);
    expect(assessment.aaa).toBe(true);
  });

  it("picks a readable text color for a background", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#013749")).toBe("#ffffff");
  });
});
