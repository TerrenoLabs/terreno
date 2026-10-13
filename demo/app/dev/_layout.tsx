import {DemoHeaderControls} from "@components/DemoHeaderControls";
import {isNarrowViewport, useTheme} from "@terreno/ui";
import {Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";
import type {ReactElement} from "react";

const DevStackHeaderRight = (): ReactElement => <DemoHeaderControls modeTarget="demo" />;

const Layout = (): ReactElement => {
  const {colorScheme, theme} = useTheme();

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: {backgroundColor: theme.surface.base, flex: 1},
          headerBackTitle: "Back",
          headerBackVisible: isNarrowViewport(),
          headerRight: DevStackHeaderRight,
          headerStyle: {backgroundColor: theme.surface.base},
          headerTintColor: theme.text.primary,
        }}
      />
    </>
  );
};

export default Layout;
