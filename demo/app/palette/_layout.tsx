import {isSupportedDesktopWidth} from "@terreno/ui";
import {router, Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {type ReactElement, useCallback} from "react";
import {Pressable, Text, useWindowDimensions} from "react-native";

const Layout = (): ReactElement => {
  const {width} = useWindowDimensions();
  const isDesktopLayout = isSupportedDesktopWidth({width});
  const hideHeaderBack = useCallback((): null => null, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackVisible: !isDesktopLayout,
          headerLeft: isDesktopLayout ? hideHeaderBack : undefined,
          headerRight: () => (
            <Pressable
              onPress={async () => {
                router.navigate("demo");
              }}
              style={{
                alignItems: "center",
                height: "100%",
                justifyContent: "center",
                marginRight: isDesktopLayout ? 16 : 0,
              }}
            >
              <Text style={{fontWeight: "bold"}}>Demo Mode</Text>
            </Pressable>
          ),
          title: "Palette Generator",
        }}
      />
    </>
  );
};

export default Layout;
