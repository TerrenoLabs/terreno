import type {TerrenoTheme} from "@terreno/ui";
import {DarkTheme, DefaultTheme, type Theme} from "expo-router";

interface NavigationThemeOptions {
  background?: string;
  colorScheme: "light" | "dark";
  theme: TerrenoTheme;
}

// React Navigation paints every screen container with its own theme, so it must follow the
// Terreno color scheme or light containers cover dark screens.
export const buildNavigationTheme = ({
  background,
  colorScheme,
  theme,
}: NavigationThemeOptions): Theme => {
  const baseTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: background ?? theme.surface.base,
      border: theme.border.default,
      card: theme.surface.base,
      primary: theme.text.link,
      text: theme.text.primary,
    },
    dark: colorScheme === "dark",
  };
};
