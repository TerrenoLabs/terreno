import {HeaderModeLink} from "@components/HeaderModeLink";
import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isNarrowViewport} from "@terreno/ui";
import {Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";

const Layout = () => {
  const {embed} = useGlobalSearchParams<{embed?: string}>();
  const isEmbedMode = embed === "1" || embed === "true";

  return (
    <EmbedModeProvider isEmbedMode={isEmbedMode}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackVisible: !isEmbedMode && isNarrowViewport(),
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
