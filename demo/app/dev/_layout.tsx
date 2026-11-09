import {DemoHeaderControls} from "@components/DemoHeaderControls";
import {isSupportedDesktopWidth, useTheme} from "@terreno/ui";
import {Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {type ReactElement, useCallback, useEffect, useState} from "react";
import {useWindowDimensions} from "react-native";

const DevStackHeaderRight = (): ReactElement => <DemoHeaderControls modeTarget="demo" />;

const Layout = (): ReactElement => {
  const {colorScheme, theme} = useTheme();
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
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: {backgroundColor: theme.surface.base, flex: 1},
          headerBackTitle: "Back",
          headerBackVisible: showHeaderBack,
          headerLeft: showHeaderBack ? undefined : hideHeaderBack,
          headerRight: DevStackHeaderRight,
          headerStyle: {backgroundColor: theme.surface.base},
          headerTintColor: theme.text.primary,
        }}
      />
    </>
  );
};

export default Layout;
