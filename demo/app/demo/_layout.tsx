import {DemoHeaderControls} from "@components/DemoHeaderControls";
import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isSupportedDesktopWidth, useTheme} from "@terreno/ui";
import {Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {type ReactElement, useCallback, useEffect, useState} from "react";
import {useWindowDimensions} from "react-native";

const DemoStackHeaderRight = (): ReactElement => <DemoHeaderControls modeTarget="dev" />;

const Layout = (): ReactElement => {
  const {embed} = useGlobalSearchParams<{embed?: string}>();
  const [isEmbedMode, setIsEmbedMode] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const {colorScheme, theme} = useTheme();
  const {width} = useWindowDimensions();
  const isDesktopLayout = isSupportedDesktopWidth({width});
  const showHeaderBack = hasMounted && !isEmbedMode && !isDesktopLayout;
  const hideHeaderBack = useCallback((): null => null, []);

  // Static export SSR cannot see ?embed=1, so defer embed chrome until after hydration.
  useEffect(() => {
    setHasMounted(true);
    setIsEmbedMode(embed === "1" || embed === "true");
  }, [embed]);

  return (
    <EmbedModeProvider isEmbedMode={isEmbedMode}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: {backgroundColor: theme.surface.base},
          headerBackTitle: "Back",
          headerBackVisible: showHeaderBack,
          headerLeft: showHeaderBack ? undefined : hideHeaderBack,
          headerRight: isEmbedMode ? undefined : DemoStackHeaderRight,
          headerShown: !isEmbedMode,
          headerStyle: {backgroundColor: theme.surface.base},
          headerTintColor: theme.text.primary,
        }}
      >
        <Stack.Screen name="sidebar-navigation" options={{headerShown: false}} />
      </Stack>
    </EmbedModeProvider>
  );
};

export default Layout;
