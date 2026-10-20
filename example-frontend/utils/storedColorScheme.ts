import type {ThemeColorScheme} from "@terreno/ui";

export const DEFAULT_COLOR_SCHEME: ThemeColorScheme = "light";

// The profile offers only Light or Dark, so an older stored "system" choice falls back to light.
export const resolveStoredColorScheme = (
  storedColorScheme: ThemeColorScheme | undefined
): ThemeColorScheme => (storedColorScheme === "dark" ? "dark" : DEFAULT_COLOR_SCHEME);
