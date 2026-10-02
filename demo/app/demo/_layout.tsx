import {EmbedModeProvider} from "@contexts/EmbedModeContext";
import {isNarrowViewport} from "@terreno/ui";
import {router, Stack, useGlobalSearchParams} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {Pressable, StyleSheet, Text} from "react-native";

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
          headerRight: isEmbedMode
            ? undefined
            : () => (
                <Pressable
                  onPress={async () => {
                    router.navigate("dev");
                  }}
                  style={styles.header}
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

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    marginRight: isNarrowViewport() ? 0 : 16,
  },
});
