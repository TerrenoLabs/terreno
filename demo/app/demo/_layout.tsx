import {DemoHeaderControls} from "@components/DemoHeaderControls";
import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isNarrowViewport, useTheme} from "@terreno/ui";
import {Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {type ReactElement, useEffect, useState} from "react";

const DemoStackHeaderRight = (): ReactElement => <DemoHeaderControls modeTarget="dev" />;

const Layout = (): ReactElement => {
  const {embed} = useGlobalSearchParams<{embed?: string}>();
  const [isEmbedMode, setIsEmbedMode] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const {colorScheme, theme} = useTheme();

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
          headerBackVisible: hasMounted && !isEmbedMode && isNarrowViewport(),
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
