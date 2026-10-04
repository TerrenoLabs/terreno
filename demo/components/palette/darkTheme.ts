import {darkThemeConfig} from "@terreno/ui";

import type {RoleMap} from "./paletteTypes";

/**
 * The preview and its WCAG audit use the same Figma-backed dark theme exported by @terreno/ui.
 */

export const DARK_THEME_CONFIG = darkThemeConfig;

/**
 * Dark-mode role → primitive map used by the WCAG audit, DERIVED from `DARK_THEME_CONFIG` so the
 * contrast checks always evaluate the same primitives the preview renders.
 */
export const DARK_ROLE_MAP: RoleMap = {
  border: {default: DARK_THEME_CONFIG.border?.default as string},
  surface: {
    base: DARK_THEME_CONFIG.surface?.base as string,
    error: DARK_THEME_CONFIG.surface?.error as string,
    primary: DARK_THEME_CONFIG.surface?.primary as string,
    secondaryDark: DARK_THEME_CONFIG.surface?.secondaryDark as string,
    success: DARK_THEME_CONFIG.surface?.success as string,
    warning: DARK_THEME_CONFIG.surface?.warning as string,
  },
  text: {
    accent: DARK_THEME_CONFIG.text?.accent as string,
    error: DARK_THEME_CONFIG.text?.error as string,
    inverted: DARK_THEME_CONFIG.text?.inverted as string,
    link: DARK_THEME_CONFIG.text?.link as string,
    primary: DARK_THEME_CONFIG.text?.primary as string,
    secondaryLight: DARK_THEME_CONFIG.text?.secondaryLight as string,
  },
};

export type DarkModeStatus = "adapts" | "partial" | "breaks";

export interface DarkModeAuditItem {
  area: string;
  status: DarkModeStatus;
  detail: string;
}

/**
 * Findings from auditing `@terreno/ui` for dark-mode readiness. Most components read semantic theme
 * tokens and adapt when roles are remapped; the entries below call out where a naive dark theme
 * still breaks because of hardcoded colors or light-surface assumptions in the library source.
 */
export const DARK_MODE_AUDIT: DarkModeAuditItem[] = [
  {
    area: "Layout, typography & forms",
    detail:
      "Box, Card, Page, Text, Heading, TextField, SelectField, DataTable, Accordion and most components read theme.surface / theme.text and re-theme correctly.",
    status: "adapts",
  },
  {
    area: "text.inverted role",
    detail:
      "Uses the Figma dark-mode value (#353535). Components place it on the lighter primary and status surfaces, so those pairings must remain in the WCAG scan.",
    status: "partial",
  },
  {
    area: "Button / Badge / Banner text",
    detail:
      "Labels use text.inverted on Figma's dark-mode fills. Keep these semantic pairings in the WCAG scan when tokens change.",
    status: "partial",
  },
  {
    area: "Spinner",
    detail:
      'color="light"/"dark" read raw neutral primitives, not semantic roles, so the variant names assume a light background. Pass an explicit color on dark surfaces.',
    status: "partial",
  },
  {
    area: "Modal / ActionSheet / mobile pickers",
    detail:
      "Overlays and iOS picker chrome hardcode white backgrounds and rgba(0,0,0,…) scrims/shadows (Modal.tsx, ActionSheet.tsx, PickerSelect.tsx). These stay light in dark mode.",
    status: "breaks",
  },
  {
    area: "Box/Card shadow & Slider thumb",
    detail:
      "Box shadow uses a fixed gray and the web Slider thumb is hardcoded white with a black shadow, so elevation reads oddly on dark surfaces.",
    status: "breaks",
  },
  {
    area: "IconButton muted/navigation/destructive",
    detail:
      "These variants use theme.text.inverted as a background. The Figma dark token is #353535, so the pills now follow the dark canvas but still require per-variant contrast checks.",
    status: "partial",
  },
  {
    area: "Banner inner action button text",
    detail:
      "Renders a raw React Native Text with no theme color on a surface.base pill, so the label can disappear when surface.base is dark.",
    status: "breaks",
  },
];
