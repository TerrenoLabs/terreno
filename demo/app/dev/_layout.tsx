import {HeaderModeLink} from "@components/HeaderModeLink";
import {isNarrowViewport, useTheme} from "@terreno/ui";
import {Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";

const Layout = () => {
  const {colorScheme, theme} = useTheme();

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: {backgroundColor: theme.surface.base, flex: 1},
          headerBackTitle: "Back",
          headerBackVisible: isNarrowViewport(),
          headerRight: () => <HeaderModeLink target="demo" />,
          headerStyle: {backgroundColor: theme.surface.base},
          headerTintColor: theme.text.primary,
        }}
      />
    </>
  );
};

export default Layout;
