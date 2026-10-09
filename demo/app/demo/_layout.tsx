import {HeaderModeLink} from "@components/HeaderModeLink";
import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isNarrowViewport} from "@terreno/ui";
import {Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {useEffect, useState} from "react";

const Layout = () => {
  const {embed} = useGlobalSearchParams<{embed?: string}>();
  const [isEmbedMode, setIsEmbedMode] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Static export SSR cannot see ?embed=1, so defer embed chrome until after hydration.
  useEffect(() => {
    setHasMounted(true);
    setIsEmbedMode(embed === "1" || embed === "true");
  }, [embed]);

  return (
    <EmbedModeProvider isEmbedMode={isEmbedMode}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackVisible: hasMounted && !isEmbedMode && isNarrowViewport(),
          headerRight: isEmbedMode ? undefined : () => <HeaderModeLink target="dev" />,
          headerShown: !isEmbedMode,
        }}
      >
        <Stack.Screen name="sidebar-navigation" options={{headerShown: false}} />
      </Stack>
    </EmbedModeProvider>
  );
};

export default Layout;
