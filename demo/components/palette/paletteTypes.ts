import type {PaletteAnchors} from "./colorUtils";
import {
  assessContrast,
  MAIN_FAMILIES,
  type MainFamily,
  STATUS_FAMILIES,
  type StatusFamily,
} from "./colorUtils";
// DARK_ROLE_MAP is derived from DARK_THEME_CONFIG (the source applied to the live preview) so the
// dark-mode WCAG audit always evaluates the same primitives the preview renders. `import type` in
// darkTheme keeps this from being a runtime import cycle.
import {DARK_ROLE_MAP} from "./darkTheme";

/**
 * Shared types and constants for the palette generator: chat messages, the anchor set the LLM and
 * the color pickers both drive, and the curated WCAG contrast checks that run against the generated
 * theme primitives.
 */

type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** ISO timestamp (Luxon) for ordering/display. */
  createdAt: string;
}

/** Human-friendly labels for each anchor family, shown next to the color pickers. */
export const FAMILY_LABELS: Record<MainFamily | StatusFamily, string> = {
  accent: "Accent",
  error: "Error",
  neutral: "Neutral",
  primary: "Primary",
  secondary: "Secondary",
  success: "Success",
  warning: "Warning",
};

/** Ordered list of every anchor family the UI exposes as a color input. */
export const ANCHOR_FAMILIES: (MainFamily | StatusFamily)[] = [
  ...MAIN_FAMILIES,
  ...STATUS_FAMILIES,
];

/**
 * Short helper copy shown under the picker for the families whose tone is locked (see
 * `FAMILY_TONE_LOCKS`), so users understand why an out-of-tone color snaps back.
 */
export const TONE_LOCK_HINTS: Partial<Record<MainFamily | StatusFamily, string>> = {
  error: "Locked to red tones so error states stay recognizable.",
  neutral: "Locked to low-saturation gray for text, borders, and backgrounds.",
  success: "Locked to green tones so success states stay recognizable.",
  warning: "Locked to orange/amber tones so warnings stay recognizable.",
};

/** The default anchor set, matching the stock Terreno theme so the tool opens on a known-good palette. */
export const DEFAULT_ANCHORS: PaletteAnchors = {
  accent: "#d69c0e",
  error: "#d33232",
  neutral: "#949494",
  primary: "#0086b3",
  secondary: "#2b6072",
  success: "#3ea45c",
  warning: "#f36719",
};

export type ThemeMode = "light" | "dark";

/** A semantic theme role, resolved to a concrete primitive via the active light/dark role map. */
interface RoleRef {
  group: "text" | "surface" | "border";
  key: string;
}

/**
 * A single foreground/background contrast pairing to evaluate, expressed in semantic theme roles so
 * the same check can be resolved against either the light or the dark role map.
 */
/** @internal */
export interface ContrastCheckDef {
  label: string;
  fg: RoleRef;
  bg: RoleRef;
  /**
   * Large text and UI component boundaries only need 3:1 (AA). Normal body text needs 4.5:1.
   */
  largeText?: boolean;
}

/** Nested role → primitive-key map (a subset of a `TerrenoThemeConfig`). */
export type RoleMap = Record<RoleRef["group"], Record<string, string>>;

/**
 * The stock Terreno light theme mapping (subset used by the audit + preview), mirroring
 * `defaultTheme` in `ui/src/Theme.tsx`.
 */
/** @internal */
export const LIGHT_ROLE_MAP: RoleMap = {
  border: {default: "neutral300"},
  surface: {
    base: "neutral000",
    error: "error200",
    primary: "primary400",
    secondaryDark: "secondary500",
    success: "success200",
    warning: "warning100",
  },
  text: {
    accent: "accent700",
    error: "error200",
    inverted: "neutral000",
    link: "primary600",
    primary: "neutral900",
    secondaryLight: "neutral600",
  },
};

/**
 * Curated set of the most important text/surface pairings. Flagging one here flags a real
 * accessibility risk in an app using the generated palette in that mode.
 */
/** @internal */
export const CONTRAST_CHECKS: ContrastCheckDef[] = [
  {
    bg: {group: "surface", key: "base"},
    fg: {group: "text", key: "primary"},
    label: "Body text on page",
  },
  {
    bg: {group: "surface", key: "base"},
    fg: {group: "text", key: "secondaryLight"},
    label: "Secondary text on page",
  },
  {
    bg: {group: "surface", key: "base"},
    fg: {group: "text", key: "link"},
    label: "Link text on page",
  },
  {
    bg: {group: "surface", key: "base"},
    fg: {group: "text", key: "accent"},
    label: "Accent text on page",
  },
  {
    bg: {group: "surface", key: "primary"},
    fg: {group: "text", key: "inverted"},
    label: "Inverted text on primary surface",
  },
  {
    bg: {group: "surface", key: "secondaryDark"},
    fg: {group: "text", key: "inverted"},
    label: "Inverted text on secondary surface",
  },
  {
    bg: {group: "surface", key: "error"},
    fg: {group: "text", key: "inverted"},
    label: "Inverted text on error surface",
  },
  {
    bg: {group: "surface", key: "success"},
    fg: {group: "text", key: "inverted"},
    label: "Inverted text on success surface",
  },
  {
    bg: {group: "surface", key: "warning"},
    fg: {group: "text", key: "inverted"},
    label: "Inverted text on warning surface",
  },
  {
    bg: {group: "surface", key: "base"},
    fg: {group: "text", key: "error"},
    label: "Error text on page",
  },
  {
    bg: {group: "surface", key: "base"},
    fg: {group: "border", key: "default"},
    label: "Default border on page (UI)",
    largeText: true,
  },
];

export interface ContrastResult extends ContrastCheckDef {
  ratio: number;
  foregroundHex: string;
  backgroundHex: string;
  /** True when the pairing meets its required WCAG AA threshold (4.5:1, or 3:1 for large/UI). */
  passes: boolean;
  /** True when the pairing also meets AAA (7:1, or 4.5:1 for large/UI). */
  passesAaa: boolean;
}

const resolveRole = (
  ref: RoleRef,
  roleMap: RoleMap,
  primitives: Record<string, string>,
  fallback: string
): string => {
  const primitiveKey = roleMap[ref.group]?.[ref.key];
  return (primitiveKey && primitives[primitiveKey]) || fallback;
};

/**
 * Run every curated contrast check against a flat map of generated primitives, using the light or
 * dark role mapping depending on `mode`.
 */
export const runContrastChecks = (
  primitives: Record<string, string>,
  mode: ThemeMode = "light"
): ContrastResult[] => {
  const roleMap = mode === "dark" ? DARK_ROLE_MAP : LIGHT_ROLE_MAP;
  return CONTRAST_CHECKS.map((check) => {
    const foregroundHex = resolveRole(check.fg, roleMap, primitives, "#000000");
    const backgroundHex = resolveRole(check.bg, roleMap, primitives, "#ffffff");
    const assessment = assessContrast(foregroundHex, backgroundHex);
    const passes = check.largeText ? assessment.aaLarge : assessment.aa;
    const passesAaa = check.largeText ? assessment.aaaLarge : assessment.aaa;
    return {
      ...check,
      backgroundHex,
      foregroundHex,
      passes,
      passesAaa,
      ratio: assessment.ratio,
    };
  });
};

export type {MainFamily, StatusFamily};
