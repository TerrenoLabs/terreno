import {HeaderModeLink} from "@components/HeaderModeLink";
import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isNarrowViewport, useTheme} from "@terreno/ui";
import {Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";

const Layout = () => {
  const {embed} = useGlobalSearchParams<{embed?: string}>();
  const isEmbedMode = embed === "1" || embed === "true";
  const {colorScheme, theme} = useTheme();

  return (
    <EmbedModeProvider isEmbedMode={isEmbedMode}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: {backgroundColor: theme.surface.base},
          headerBackTitle: "Back",
          headerBackVisible: !isEmbedMode && isNarrowViewport(),
          headerRight: isEmbedMode ? undefined : () => <HeaderModeLink target="dev" />,
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
