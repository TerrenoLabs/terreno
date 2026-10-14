import {TerrenoProvider, type ThemeColorScheme, useStoredState} from "@terreno/ui";
import {createContext, type FC, type ReactNode, useCallback, useContext, useMemo} from "react";

const STORAGE_KEY = "themeColorScheme";

interface ThemePreferenceContextValue {
  colorSchemeSetting: ThemeColorScheme;
  isLoading: boolean;
  setColorScheme: (colorScheme: ThemeColorScheme) => Promise<void>;
}

const DEFAULT_COLOR_SCHEME: ThemeColorScheme = "light";

const ThemePreferenceContext = createContext<ThemePreferenceContextValue>({
  colorSchemeSetting: DEFAULT_COLOR_SCHEME,
  isLoading: false,
  setColorScheme: async () => {},
});

export const AppThemeProvider: FC<{
  children: ReactNode;
  openAPISpecUrl: string;
}> = ({children, openAPISpecUrl}) => {
  const [storedColorScheme, setStoredColorScheme, isLoading] = useStoredState<ThemeColorScheme>(
    STORAGE_KEY,
    DEFAULT_COLOR_SCHEME
  );
  const colorSchemeSetting = storedColorScheme ?? DEFAULT_COLOR_SCHEME;

  const setColorScheme = useCallback(
    async (colorScheme: ThemeColorScheme): Promise<void> => {
      await setStoredColorScheme(colorScheme);
    },
    [setStoredColorScheme]
  );

  const contextValue = useMemo(
    () => ({colorSchemeSetting, isLoading, setColorScheme}),
    [colorSchemeSetting, isLoading, setColorScheme]
  );

  // Hold the themed tree until storage resolves so a saved Dark choice never flashes Light first.
  if (isLoading) {
    return <ThemePreferenceContext.Provider value={contextValue} />;
  }

  return (
    <ThemePreferenceContext.Provider value={contextValue}>
      <TerrenoProvider colorScheme={colorSchemeSetting} openAPISpecUrl={openAPISpecUrl}>
        {children}
      </TerrenoProvider>
    </ThemePreferenceContext.Provider>
  );
};

export const useThemePreference = (): ThemePreferenceContextValue => {
  return useContext(ThemePreferenceContext);
};
