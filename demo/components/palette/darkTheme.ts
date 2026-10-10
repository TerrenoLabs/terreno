import {darkThemeConfig} from "@terreno/ui";

import type {RoleMap} from "./paletteTypes";

/**
 * Dark-mode role → primitive map used by the WCAG audit, derived from the Figma-backed
 * `darkThemeConfig` so contrast checks evaluate the same primitives the preview renders.
 */
export const DARK_ROLE_MAP: RoleMap = {
  border: {default: darkThemeConfig.border?.default as string},
  surface: {
    base: darkThemeConfig.surface?.base as string,
    error: darkThemeConfig.surface?.error as string,
    primary: darkThemeConfig.surface?.primary as string,
    secondaryDark: darkThemeConfig.surface?.secondaryDark as string,
    success: darkThemeConfig.surface?.success as string,
    warning: darkThemeConfig.surface?.warning as string,
  },
  text: {
    accent: darkThemeConfig.text?.accent as string,
    error: darkThemeConfig.text?.error as string,
    inverted: darkThemeConfig.text?.inverted as string,
    link: darkThemeConfig.text?.link as string,
    primary: darkThemeConfig.text?.primary as string,
    secondaryLight: darkThemeConfig.text?.secondaryLight as string,
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
      "The action pill uses surface.base with text.primary, so the label follows the active theme.",
    status: "adapts",
  },
];
