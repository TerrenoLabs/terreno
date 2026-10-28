import {isSupportedDesktopWidth} from "@terreno/ui";
import {router, Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {type ReactElement, useCallback, useEffect, useState} from "react";
import {Pressable, Text, useWindowDimensions} from "react-native";

const Layout = (): ReactElement => {
  const {width} = useWindowDimensions();
  const [hasMounted, setHasMounted] = useState(false);
  const isDesktopLayout = isSupportedDesktopWidth({width});
  const showHeaderBack = hasMounted && !isDesktopLayout;
  const hideHeaderBack = useCallback((): null => null, []);

  // Static export SSR has no reliable window width, so keep header chrome stable until mount.
  useEffect(() => {
    setHasMounted(true);
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackVisible: showHeaderBack,
          headerLeft: showHeaderBack ? undefined : hideHeaderBack,
          headerRight: () => (
            <Pressable
              onPress={async () => {
                router.navigate("demo");
              }}
              style={{
                alignItems: "center",
                height: "100%",
                justifyContent: "center",
                marginRight: hasMounted && isDesktopLayout ? 16 : 0,
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
