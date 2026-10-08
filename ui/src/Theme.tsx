import React, {createContext, useCallback, useMemo, useState} from "react";

import type {TerrenoTheme, TerrenoThemeConfig, ThemePrimitives} from "./Common";
import {TerrenoFontProvider} from "./TerrenoFontProvider";

const defaultPrimitives = {
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
  success100: "#3EA45C",
  success200: "#1A7F36",

  warning000: "#FFE3C6",
  warning100: "#F36719",
  warning200: "#B14202",
};

const defaultTheme: TerrenoThemeConfig = {
  border: {
    activeAccent: "accent500",
    activeNeutral: "neutral700",
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
  primitives: defaultPrimitives,
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
    base: "neutral000",
    baseAlternate: "neutral050",
    baseHover: "secondary000",
    disabled: "neutral500",
    error: "error200",
    errorLight: "error000",
    neutral: "neutral600",
    neutralDark: "neutral800",
    neutralLight: "neutral200",
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

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
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

const defaultComputedTheme = computeTheme(defaultTheme, defaultPrimitives);

export const ThemeContext = createContext({
  resetTheme: () => {},
  setPrimitives: (_primitives: DeepPartial<typeof defaultPrimitives>) => {},
  setTheme: (_theme: DeepPartial<TerrenoThemeConfig>) => {},
  theme: defaultComputedTheme,
});

interface ThemeProviderProps {
  children: React.ReactNode;
  initialPrimitives?: DeepPartial<ThemePrimitives>;
}

export const ThemeProvider = ({children, initialPrimitives}: ThemeProviderProps) => {
  const [providerTheme, setProviderTheme] = useState<DeepPartial<TerrenoThemeConfig>>(defaultTheme);
  const [providerPrimitives, setProviderPrimitives] = useState<ThemePrimitives>(
    initialPrimitives ? {...defaultPrimitives, ...initialPrimitives} : defaultPrimitives
  );

  const computedTheme = useMemo(
    () => computeTheme(providerTheme, providerPrimitives),
    [providerTheme, providerPrimitives]
  );

  const setPrimitives = useCallback((newPrimitives: Partial<ThemePrimitives>): void => {
    setProviderPrimitives((prev) => ({...prev, ...newPrimitives}));
  }, []);

  const setTheme = useCallback((newTheme: DeepPartial<TerrenoThemeConfig>): void => {
    setProviderTheme((prev) => {
      const mergedTheme = {...prev};

      for (const key in newTheme) {
        if (Object.hasOwn(newTheme, key)) {
          const newSubTheme = newTheme[key as keyof TerrenoThemeConfig];
          const prevSubTheme = prev[key as keyof TerrenoThemeConfig];

          if (newSubTheme && typeof newSubTheme === "object") {
            (mergedTheme as Record<string, unknown>)[key] = {
              ...prevSubTheme,
              ...newSubTheme,
            };
          } else {
            (mergedTheme as Record<string, unknown>)[key] = newSubTheme;
          }
        }
      }

      return mergedTheme;
    });
  }, []);

  const resetTheme = useCallback((): void => {
    setProviderTheme(defaultTheme);
    setProviderPrimitives(defaultPrimitives);
  }, []);
  const contextValue = useMemo(
    () => ({resetTheme, setPrimitives, setTheme, theme: computedTheme}),
    [computedTheme, resetTheme, setPrimitives, setTheme]
  );

  return (
    <TerrenoFontProvider>
      <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
    </TerrenoFontProvider>
  );
};

export const useTheme = () => React.useContext(ThemeContext);
