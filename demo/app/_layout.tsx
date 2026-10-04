import {customIcons} from "@components/customIcons";
import {TerrenoProvider} from "@terreno/ui";
import {Slot} from "expo-router";
import type React from "react";
import {useEffect} from "react";
import {GestureHandlerRootView} from "react-native-gesture-handler";

const RootLayout: React.FC = () => {
  // Give the web demo a stable document name for browser and assistive-technology navigation.
  useEffect((): void => {
    if (typeof document === "undefined") {
      return;
    }
    document.title = "Terreno UI Demo";
  }, []);

  // TODO: Store dev/demo in AsyncStorage to persist.
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <TerrenoProvider icons={customIcons}>
        <Slot initialRouteName={process.env.NODE_ENV === "development" ? "dev" : "demo"} />
      </TerrenoProvider>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
