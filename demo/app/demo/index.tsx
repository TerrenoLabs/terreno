import {DemoHomePage} from "@components/DemoHomePage";
import {Host, useTheme} from "@terreno/ui";
import {router, useGlobalSearchParams} from "expo-router";
import {StyleSheet, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";

const App = () => {
  const insets = useSafeAreaInsets();
  const {theme} = useTheme();
  const {theme: themeParam} = useGlobalSearchParams<{theme?: string | string[]}>();
  const selectedTheme = Array.isArray(themeParam) ? themeParam[0] : themeParam;

  // Update when we have new fonts picked, these look baaad.
  // const [loaded] = useFonts({
  //   "Comfortaa-Light": require("../../assets/Comfortaa-Light.ttf"),
  //   "Comfortaa-Bold": require("../../assets/Comfortaa-Bold.ttf"),
  //   IMFellEnglishSC: require("../../assets/IMFellEnglishSC-Regular.ttf"),
  //   "DancingScript-Regular": require("../../assets/DancingScript-Regular.ttf"),
  //   Cochin: require("../../assets/Cochin.ttf"),
  // });

  // if (!loaded) {
  //   return null;
  // }

  return (
    <Host>
      <View
        style={{
          ...styles.container,
          backgroundColor: theme.surface.base,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingTop: insets.top,
          width: "100%",
        }}
      >
        <View
          style={[styles.body, {backgroundColor: theme.surface.baseAlternate}]}
          testID="demo-home-screen"
        >
          <DemoHomePage
            onPress={(component: string) => {
              router.push({
                params: {component, ...(selectedTheme ? {theme: selectedTheme} : {})},
                pathname: "/demo/[component]",
              });
            }}
          />
        </View>
      </View>
    </Host>
  );
};

const styles = StyleSheet.create({
  body: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    maxHeight: "100%",
    overflow: "scroll",
    width: "100%",
  },
  container: {
    height: "100%",
    maxHeight: "100%",
    overflow: "hidden",
    position: "absolute",
    width: "100%",
  },
});

export default App;
