import {DevHomePage} from "@components/DevHomePage";
import {DemoConfig} from "@config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {useTheme} from "@terreno/ui";
import {router, useGlobalSearchParams, useRootNavigationState} from "expo-router";
import {type ReactElement, useEffect, useRef} from "react";
import {StyleSheet, View} from "react-native";
import {activePreviewParams} from "../../previewState";

const ASYNC_STORAGE_KEY = "CURRENT_ROUTE";

const Dev = (): ReactElement => {
  // TODO create a shared hook for saving navigation state to AsyncStorage
  const navigationState = useRootNavigationState();
  const searchParams = useGlobalSearchParams();
  const previewParams = activePreviewParams(searchParams);
  const previewParamsRef = useRef(previewParams);
  previewParamsRef.current = previewParams;
  const {theme} = useTheme();
  // Save the current navigation state to AsyncStorage
  useEffect(() => {
    const saveCurrentRoute = async () => {
      // Don't save initial state
      if (navigationState.routes?.length <= 1) {
        return;
      }
      const params = (navigationState.routes[1]?.params ?? {}) as {
        component?: string;
        story?: string;
      };

      try {
        await AsyncStorage.setItem(
          ASYNC_STORAGE_KEY,
          JSON.stringify({component: params?.component, story: params?.story})
        );
      } catch (error) {
        console.error("Failed to save the current route", error);
      }
    };

    void saveCurrentRoute();
  }, [navigationState]);

  // Restore the saved story once. A later preview change must not navigate again,
  // or Expo Router drops the other preview params and remounts the story.
  useEffect(() => {
    const restoreRoute = async (): Promise<void> => {
      try {
        const savedRoute = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
        if (savedRoute) {
          const {component, story} = JSON.parse(savedRoute);
          if (component && story) {
            router.navigate({
              params: {component, story, ...previewParamsRef.current},
              pathname: "/dev/[component]",
            });
          }
        }
      } catch (error) {
        console.error("Failed to load the current route", error);
      }
    };

    void restoreRoute();
  }, []);

  return (
    <View
      style={{
        ...styles.container,
        backgroundColor: theme.surface.base,
        width: "100%",
      }}
    >
      <DevHomePage
        demoConfig={DemoConfig}
        onPress={(component: string, story: string) => {
          router.navigate({
            params: {component, story, ...previewParams},
            pathname: "/dev/[component]",
          });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: "100%",
    maxHeight: "100%",
    overflow: "hidden",
    position: "absolute",
    width: "100%",
  },
});

export default Dev;
