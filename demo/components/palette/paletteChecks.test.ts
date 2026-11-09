import {describe, expect, it} from "bun:test";
import {darkThemeConfig} from "@terreno/ui";

import {buildFontConfigCode} from "./codeExport";
import {generatePrimitivesFromAnchors} from "./colorUtils";
import {DARK_ROLE_MAP} from "./darkTheme";
import {DEFAULT_FONTS} from "./fonts";
import {CONTRAST_CHECKS, DEFAULT_ANCHORS, LIGHT_ROLE_MAP, runContrastChecks} from "./paletteTypes";

/**
 * Tests for the mode-aware WCAG audit and font export. In particular, guards that the dark role map
 * used by the audit stays derived from `darkThemeConfig` (the source used by the preview
 * provider), so the two cannot drift.
 */

const primitives = generatePrimitivesFromAnchors(DEFAULT_ANCHORS) as Record<string, string>;

describe("runContrastChecks", () => {
  it("produces a result per curated check", () => {
    expect(runContrastChecks(primitives, "light")).toHaveLength(CONTRAST_CHECKS.length);
  });

  it("resolves the same check to different colors in light vs dark", () => {
    const light = runContrastChecks(primitives, "light");
    const dark = runContrastChecks(primitives, "dark");
    const bodyLight = light.find((r) => r.label === "Body text on page");
    const bodyDark = dark.find((r) => r.label === "Body text on page");
    // Body text on page: dark background differs from light background.
    expect(bodyLight?.backgroundHex).not.toBe(bodyDark?.backgroundHex);
    expect(bodyLight?.foregroundHex).toBe(primitives.neutral900);
    expect(bodyDark?.foregroundHex).toBe(primitives.neutral000);
  });

  it("flags a failing pairing", () => {
    const light = runContrastChecks(primitives, "light");
    const invertedOnPrimary = light.find((r) => r.label === "Inverted text on primary surface");
    // The stock primary surface fails white-text AA — the audit must flag it.
    expect(invertedOnPrimary?.passes).toBe(false);
  });
});

describe("dark role map / preview config consistency", () => {
  it("resolves error and success surfaces to the same primitive the preview renders", () => {
    // Regression guard for the reviewer finding that the dark audit and preview diverged.
    expect(DARK_ROLE_MAP.surface.error).toBe(darkThemeConfig.surface?.error as string);
    expect(DARK_ROLE_MAP.surface.success).toBe(darkThemeConfig.surface?.success as string);
    expect(DARK_ROLE_MAP.surface.base).toBe(darkThemeConfig.surface?.base as string);
    expect(DARK_ROLE_MAP.text.primary).toBe(darkThemeConfig.text?.primary as string);
  });

  it("uses the Figma inverted text token in dark mode", () => {
    expect(DARK_ROLE_MAP.text.inverted).toBe("neutral800");
  });

  it("differs from the light role map on the base surface", () => {
    expect(LIGHT_ROLE_MAP.surface.base).not.toBe(DARK_ROLE_MAP.surface.base);
  });
});

describe("buildFontConfigCode", () => {
  it("emits a theme.font config with the selected families", () => {
    const code = buildFontConfigCode(DEFAULT_FONTS);
    expect(code).toContain(`primary: "${DEFAULT_FONTS.bodyFont}"`);
    expect(code).toContain(`title: "${DEFAULT_FONTS.headingFont}"`);
    expect(code).toContain("font: {");
  });
});
