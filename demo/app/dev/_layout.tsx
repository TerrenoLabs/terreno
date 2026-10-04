import {isSupportedDesktopWidth} from "@terreno/ui";
import {router, Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import type {ReactElement} from "react";
import {Pressable, Text, useWindowDimensions} from "react-native";

const Layout = (): ReactElement => {
  const {width} = useWindowDimensions();
  const isDesktopLayout = isSupportedDesktopWidth({width});

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          contentStyle: {flex: 1},
          headerBackTitle: "Back",
          headerBackVisible: !isDesktopLayout,
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
        }}
      />
    </>
  );
};

export default Layout;
