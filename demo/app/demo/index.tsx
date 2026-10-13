import {DemoHomePage} from "@components/DemoHomePage";
import {Host, useTheme} from "@terreno/ui";
import {router, useGlobalSearchParams} from "expo-router";
import {StyleSheet, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {activePreviewParams} from "../../previewState";

const App = () => {
  const insets = useSafeAreaInsets();
  const {theme} = useTheme();
  const searchParams = useGlobalSearchParams();
  const previewParams = activePreviewParams(searchParams);

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
                params: {component, ...previewParams},
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
