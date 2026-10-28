import {DemoHeaderControls} from "@components/DemoHeaderControls";
import {isSupportedDesktopWidth, useTheme} from "@terreno/ui";
import {Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import {type ReactElement, useCallback} from "react";
import {useWindowDimensions} from "react-native";

const DevStackHeaderRight = (): ReactElement => <DemoHeaderControls modeTarget="demo" />;

const Layout = (): ReactElement => {
  const {colorScheme, theme} = useTheme();
  const {width} = useWindowDimensions();
  const isDesktopLayout = isSupportedDesktopWidth({width});
  const hideHeaderBack = useCallback((): null => null, []);

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: {backgroundColor: theme.surface.base, flex: 1},
          headerBackTitle: "Back",
          headerBackVisible: !isDesktopLayout,
          headerLeft: isDesktopLayout ? hideHeaderBack : undefined,
          headerRight: DevStackHeaderRight,
          headerStyle: {backgroundColor: theme.surface.base},
          headerTintColor: theme.text.primary,
        }}
      />
    </>
  );
};

export default Layout;
