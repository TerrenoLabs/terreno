import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isSupportedDesktopWidth} from "@terreno/ui";
import {router, Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";
import type {ReactElement} from "react";
import {Pressable, Text, useWindowDimensions} from "react-native";

const Layout = (): ReactElement => {
  const {embed} = useGlobalSearchParams<{embed?: string}>();
  const isEmbedMode = embed === "1" || embed === "true";
  const {width} = useWindowDimensions();
  const isDesktopLayout = isSupportedDesktopWidth({width});

  return (
    <EmbedModeProvider isEmbedMode={isEmbedMode}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackVisible: !isEmbedMode && !isDesktopLayout,
          headerRight: isEmbedMode
            ? undefined
            : () => (
                <Pressable
                  onPress={async () => {
                    router.navigate("dev");
                  }}
                  style={{
                    alignItems: "center",
                    height: "100%",
                    justifyContent: "center",
                    marginRight: isDesktopLayout ? 16 : 0,
                  }}
                >
                  <Text style={{fontWeight: "bold"}}>Dev Mode</Text>
                </Pressable>
              ),
          headerShown: !isEmbedMode,
        }}
      >
        <Stack.Screen name="sidebar-navigation" options={{headerShown: false}} />
      </Stack>
    </EmbedModeProvider>
  );
};

export default Layout;
