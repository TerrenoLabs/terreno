import {HeaderModeLink} from "@components/HeaderModeLink";
import {isNarrowViewport} from "@terreno/ui";
import {Stack} from "expo-router";
import {StatusBar} from "expo-status-bar";

const Layout = () => {
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          contentStyle: {flex: 1},
          headerBackTitle: "Back",
          headerBackVisible: isNarrowViewport(),
          headerRight: () => <HeaderModeLink target="demo" />,
        }}
      />
    </>
  );
};

export default Layout;
