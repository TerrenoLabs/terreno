import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";
import {useColorScheme} from "react-native";

import type {TerrenoTheme, TerrenoThemeConfig, ThemePrimitives} from "./Common";
import {TerrenoFontProvider} from "./TerrenoFontProvider";

export const defaultThemePrimitives: ThemePrimitives = {
  accent000: "#FFFDF7",
  accent050: "#FCECC2",
  accent100: "#F9E0A1",
  accent200: "#F7D582",
  accent300: "#F2CB62",
  accent400: "#E5B132",
  accent500: "#D69C0E",
  accent600: "#B58201",
  accent700: "#956A00",
  accent800: "#543C00",
  accent900: "#332400",

  error000: "#FDD7D7",
  error050: "#EDA1A1",
  error100: "#D33232",
  error200: "#BD1111",
  neutral000: "#FFFFFF",
  neutral050: "#F2F2F2",
  neutral100: "#E6E6E6",
  neutral200: "#D9D9D9",
  neutral300: "#CDCDCD",
  neutral400: "#B3B3B3",
  neutral500: "#949494",
  neutral600: "#686868",
  neutral700: "#4E4E4E",
  neutral800: "#353535",
  neutral900: "#1C1C1C",

  primary000: "#EBFAFF",
  primary050: "#BCE9F7",
  primary100: "#90D8F0",
  primary200: "#73CAE8",
  primary300: "#40B8E0",
  primary400: "#0E9DCD",
  primary500: "#0086B3",
  primary600: "#0A7092",
  primary700: "#035D7E",
  primary800: "#004B64",
  primary900: "#013749",
  radius2xl: 128,
  radius3xl: 360,
  radiusLg: 16,
  radiusMd: 4,

  radiusSm: 2,
  radiusXl: 32,

  secondary000: "#F2F9FA",
  secondary050: "#D7E5EA",
  secondary100: "#B6CDD5",
  secondary200: "#9EB7BF",
  secondary300: "#87A1AA",
  secondary400: "#608997",
  secondary500: "#2B6072",
  secondary600: "#1C4E5F",
  secondary700: "#0F3D4D",
  secondary800: "#092E3A",
  secondary900: "#041E27",

  spacing0: 0,
  spacing1: 4,
  spacing2: 8,
  spacing3: 12,
  spacing4: 16,
  spacing5: 24,
  spacing6: 32,
  spacing7: 40,
  spacing8: 48,
  spacing9: 56,
  spacing10: 64,
  spacing11: 72,
  spacing12: 80,

  success000: "#DCF2E2",
  success050: "#9BE7B2",
  success100: "#3EA45C",
  success200: "#1A7F36",

  warning000: "#FFE3C6",
  warning050: "#FAA372",
  warning100: "#F36719",
  warning200: "#B14202",
};

export const lightThemeConfig: TerrenoThemeConfig = {
  border: {
    activeAccent: "accent500",
    activeNeutral: "neutral700",
    ai: "primary100",
    dark: "neutral500",
    default: "neutral300",
    error: "error100",
    focus: "primary200",
    hover: "neutral200",
    success: "success100",
    warning: "warning100",
  },

  // These will continue to throw errors until we have a proper font system in place.
  // TODO: currently to use these, you need to set fontFamily to "text" or "heading",
  // not theme.font.primary or theme.font.title.
  font: {
    primary: "Nunito",
    title: "Titillium Web",
  },
  primitives: defaultThemePrimitives,
  radius: {
    default: "radiusMd",
    full: "radiusLg",
    minimal: "radiusSm",
    rounded: "radius3xl",
  },
  spacing: {
    "2xl": "spacing8",
    "3xl": "spacing12",
    lg: "spacing5",
    md: "spacing4",
    none: "spacing0",
    sm: "spacing2",
    xl: "spacing6",
    xs: "spacing1",
  },
  status: {
    active: "success100",
    away: "neutral500",
    doNotDisturb: "error100",
  },
  surface: {
    ai: "primary000",
    base: "neutral000",
    baseAlternate: "neutral050",
    baseHover: "secondary000",
    disabled: "neutral500",
    error: "error200",
    errorLight: "error000",
    neutral: "neutral600",
    neutralDark: "neutral800",
    neutralExtraLight: "neutral200",
    neutralLight: "neutral300",
    primary: "primary400",
    secondaryDark: "secondary500",
    secondaryExtraDark: "secondary800",
    secondaryExtraLight: "secondary000",
    secondaryLight: "secondary100",
    success: "success200",
    successLight: "success000",
    warning: "warning100",
    warningLight: "warning000",
  },
  text: {
    accent: "accent700",
    error: "error200",
    extraLight: "neutral500",
    inverted: "neutral000",
    link: "primary600",
    linkLight: "primary400",
    primary: "neutral900",
    secondaryDark: "secondary800",
    // TODO: ask jo about the naming here, secondaryDark is a blue, secondaryLight is a gray.
    secondaryLight: "neutral600",
    success: "success200",
    warning: "warning200",
  },
};

export const darkThemeConfig: TerrenoThemeConfig = {
  ...lightThemeConfig,
  border: {
    activeAccent: "accent200",
    activeNeutral: "neutral100",
    ai: "primary500",
    dark: "neutral300",
    default: "neutral400",
    error: "error050",
    focus: "primary200",
    hover: "neutral600",
    success: "success050",
    warning: "warning050",
  },
  status: {
    active: "success050",
    away: "neutral300",
    doNotDisturb: "error050",
  },
  surface: {
    ai: "primary700",
    base: "neutral800",
    baseAlternate: "neutral800",
    baseHover: "secondary600",
    disabled: "neutral300",
    error: "error050",
    errorLight: "error200",
    neutral: "neutral200",
    neutralDark: "neutral050",
    neutralExtraLight: "neutral600",
    neutralLight: "neutral600",
    primary: "primary300",
    secondaryDark: "secondary300",
    secondaryExtraDark: "secondary050",
    secondaryExtraLight: "secondary600",
    secondaryLight: "secondary600",
    success: "success050",
    successLight: "success200",
    warning: "warning050",
    // warning200 is the darkest warning fill. warning100 (#F36719) is 2.52:1
    // against warning text (#FFE3C6), below the 4.5:1 AA bar.
    warningLight: "warning200",
  },
  text: {
    accent: "accent400",
    error: "error000",
    extraLight: "neutral300",
    inverted: "neutral800",
    link: "primary200",
    linkLight: "primary300",
    primary: "neutral000",
    secondaryDark: "secondary050",
    secondaryLight: "neutral200",
    success: "success000",
    warning: "warning000",
  },
};

export type ThemeColorScheme = "light" | "dark" | "system";
export type ResolvedThemeColorScheme = Exclude<ThemeColorScheme, "system">;

export const themeColorSchemeOptions: {label: string; value: ThemeColorScheme}[] = [
  {label: "Light", value: "light"},
  {label: "Dark", value: "dark"},
  {label: "Follow system", value: "system"},
];

export const resolveThemeColorScheme = (
  colorScheme: ThemeColorScheme,
  systemColorScheme: string | null | undefined
): ResolvedThemeColorScheme => {
  if (colorScheme === "dark") {
    return "dark";
  }
  if (colorScheme === "light") {
    return "light";
  }
  if (systemColorScheme === "dark") {
    return "dark";
  }
  return "light";
};

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const mergeThemeConfig = (
  baseTheme: DeepPartial<TerrenoThemeConfig>,
  overrideTheme: DeepPartial<TerrenoThemeConfig>
): DeepPartial<TerrenoThemeConfig> => {
  const mergedTheme = {...baseTheme};

  for (const key in overrideTheme) {
    if (!Object.hasOwn(overrideTheme, key)) {
      continue;
    }
    const overrideSubTheme = overrideTheme[key as keyof TerrenoThemeConfig];
    const baseSubTheme = baseTheme[key as keyof TerrenoThemeConfig];

    if (overrideSubTheme && typeof overrideSubTheme === "object") {
      (mergedTheme as Record<string, unknown>)[key] = {
        ...baseSubTheme,
        ...overrideSubTheme,
      };
      continue;
    }
    (mergedTheme as Record<string, unknown>)[key] = overrideSubTheme;
  }

  return mergedTheme;
};

const computeTheme = (
  themeConfig: DeepPartial<TerrenoThemeConfig>,
  primitives: ThemePrimitives
): TerrenoTheme => {
  const theme = Object.keys(themeConfig).reduce((acc, key) => {
    if (key === "primitives") {
      return acc;
    }
    const value = themeConfig[key as keyof TerrenoThemeConfig] ?? {};
    (acc as unknown as Record<string, unknown>)[key] = Object.keys(value).reduce(
      (accKey, valueKey) => {
        const primitiveKey = value[valueKey as keyof typeof value] as keyof ThemePrimitives;
        if (key === "font") {
          accKey[valueKey] = primitiveKey;
        } else {
          if (primitives[primitiveKey] === undefined) {
            console.error(`Primitive ${primitiveKey} not found in theme.`);
          }
          accKey[valueKey] = primitives[primitiveKey];
        }
        return accKey;
      },
      {} as Record<string, string | number>
    );
    return acc;
  }, {} as TerrenoTheme);
  return {...theme, primitives};
};

const defaultComputedTheme = computeTheme(lightThemeConfig, defaultThemePrimitives);

export const ThemeContext = createContext({
  colorScheme: "light" as ResolvedThemeColorScheme,
  colorSchemeSetting: "light" as ThemeColorScheme,
  resetTheme: () => {},
  setColorScheme: (_colorScheme: ThemeColorScheme) => {},
  setPrimitives: (_primitives: DeepPartial<ThemePrimitives>) => {},
  setTheme: (_theme: DeepPartial<TerrenoThemeConfig>) => {},
  theme: defaultComputedTheme,
});

export interface ThemeProviderProps {
  children: React.ReactNode;
  colorScheme?: ThemeColorScheme;
  initialPrimitives?: DeepPartial<ThemePrimitives>;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  colorScheme,
  initialPrimitives,
}) => {
  const systemColorScheme = useColorScheme();
  const [colorSchemeSetting, setColorSchemeSetting] = useState<ThemeColorScheme>(
    colorScheme ?? "light"
  );

  // Keep an explicit parent selection in charge when that selection changes.
  useEffect(() => {
    if (colorScheme === undefined) {
      return;
    }
    setColorSchemeSetting(colorScheme);
  }, [colorScheme]);

  const setColorScheme = useCallback((nextColorScheme: ThemeColorScheme): void => {
    setColorSchemeSetting(nextColorScheme);
  }, []);

  const resolvedColorScheme = resolveThemeColorScheme(colorSchemeSetting, systemColorScheme);
  const baseTheme = resolvedColorScheme === "dark" ? darkThemeConfig : lightThemeConfig;
  const [providerThemeOverrides, setProviderThemeOverrides] = useState<
    DeepPartial<TerrenoThemeConfig>
  >({});
  const [providerPrimitives, setProviderPrimitives] = useState<ThemePrimitives>(
    initialPrimitives ? {...defaultThemePrimitives, ...initialPrimitives} : defaultThemePrimitives
  );
  const providerTheme = useMemo(
    (): DeepPartial<TerrenoThemeConfig> => mergeThemeConfig(baseTheme, providerThemeOverrides),
    [baseTheme, providerThemeOverrides]
  );

  const computedTheme = useMemo(
    () => computeTheme(providerTheme, providerPrimitives),
    [providerTheme, providerPrimitives]
  );

  const setPrimitives = useCallback((newPrimitives: Partial<ThemePrimitives>): void => {
    setProviderPrimitives((prev) => ({...prev, ...newPrimitives}));
  }, []);

  const setTheme = useCallback((newTheme: DeepPartial<TerrenoThemeConfig>): void => {
    setProviderThemeOverrides((previousTheme) => mergeThemeConfig(previousTheme, newTheme));
  }, []);

  const resetTheme = useCallback((): void => {
    setProviderThemeOverrides({});
    setProviderPrimitives(defaultThemePrimitives);
  }, []);
  const contextValue = useMemo(
    () => ({
      colorScheme: resolvedColorScheme,
      colorSchemeSetting,
      resetTheme,
      setColorScheme,
      setPrimitives,
      setTheme,
      theme: computedTheme,
    }),
    [
      colorSchemeSetting,
      computedTheme,
      resetTheme,
      resolvedColorScheme,
      setColorScheme,
      setPrimitives,
      setTheme,
    ]
  );

  return (
    <TerrenoFontProvider>
      <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
    </TerrenoFontProvider>
  );
};

export const useTheme = (): React.ContextType<typeof ThemeContext> => useContext(ThemeContext);
