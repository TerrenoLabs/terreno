import {customIcons} from "@components/customIcons";
import {TerrenoProvider, type ThemeColorScheme} from "@terreno/ui";
import {Slot, useGlobalSearchParams} from "expo-router";
import type React from "react";
import {useEffect} from "react";
import {GestureHandlerRootView} from "react-native-gesture-handler";

export const unstable_settings = {
  initialRouteName: process.env.NODE_ENV === "development" ? "dev" : "demo",
};

const RootLayout: React.FC = () => {
  const {theme} = useGlobalSearchParams<{theme?: string | string[]}>();
  const requestedTheme = Array.isArray(theme) ? theme[0] : theme;
  const colorScheme: ThemeColorScheme =
    requestedTheme === "dark" || requestedTheme === "system" ? requestedTheme : "light";

  // Give the web demo a stable document name for browser and assistive-technology navigation.
  useEffect((): void => {
    if (typeof document === "undefined") {
      return;
    }
    document.title = "Terreno UI Demo";
  }, []);

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <TerrenoProvider colorScheme={colorScheme} icons={customIcons}>
        <Slot />
      </TerrenoProvider>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
