import FontAwesome from "@expo/vector-icons/FontAwesome";
import {DarkTheme, DefaultTheme, ThemeProvider} from "expo-router/react-navigation";
import {useFonts} from "expo-font";
import {Stack} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import {useEffect} from "react";
import "react-native-reanimated";
import {baseUrl, selectBetterAuthUserId} from "@terreno/rtk";
import {installTerrenoDevConsoleLogger} from "@terreno/syncdb";
import {TerrenoProvider} from "@terreno/ui";
import {Provider, useSelector} from "react-redux";
import {PersistGate} from "redux-persist/integration/react";
import {useColorScheme} from "@/components/useColorScheme";
import store, {persistor} from "@/store/index";

installTerrenoDevConsoleLogger({baseUrl});

export {ErrorBoundary} from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout(): React.ReactElement | null {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <TerrenoProvider openAPISpecUrl={`${baseUrl}/openapi.json`}>
          <RootLayoutNav />
        </TerrenoProvider>
      </PersistGate>
    </Provider>
  );
}

function RootLayoutNav(): React.ReactElement {
  const colorScheme = useColorScheme();
  const userId = useSelector(selectBetterAuthUserId);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        {!userId ? (
          <Stack.Screen name="login" options={{headerShown: false}} />
        ) : (
          <Stack.Screen name="(tabs)" options={{headerShown: false}} />
        )}
      </Stack>
    </ThemeProvider>
  );
}
