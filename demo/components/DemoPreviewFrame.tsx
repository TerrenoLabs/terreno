import {useEmbedMode} from "@contexts/EmbedModeContext";
import {Box, ThemeProvider} from "@terreno/ui";
import {router, useGlobalSearchParams, useNavigation, usePathname} from "expo-router";
import type React from "react";
import {useCallback, useEffect} from "react";

import {DemoPreviewContext} from "../previewContext";
import {
  type DemoPreviewState,
  previewParamsFromState,
  previewQueryFromState,
  previewStateFromQuery,
} from "../previewState";
import {DemoPreviewBar} from "./DemoPreviewBar";
import {HeaderModeLink} from "./HeaderModeLink";

export const DemoPreviewFrame: React.FC<{children: React.ReactNode}> = ({children}) => {
  const params = useGlobalSearchParams();
  const {isEmbedMode} = useEmbedMode();
  const state = previewStateFromQuery(params);
  const shareQuery = previewQueryFromState(state);
  const navigation = useNavigation();
  const isDevRoute = usePathname().startsWith("/dev");

  const handleChange = useCallback((next: DemoPreviewState): void => {
    router.setParams(previewParamsFromState(next));
  }, []);

  // Mount the preview controls in the navigation header, keeping the demo/dev mode switch beside them.
  useEffect(() => {
    if (isEmbedMode) {
      return;
    }
    // Rebuild from the query string so the effect only re-runs when the preview actually changes.
    const headerState = previewStateFromQuery(Object.fromEntries(new URLSearchParams(shareQuery)));
    navigation.setOptions({
      headerRight: () => (
        <Box alignItems="center" direction="row">
          <DemoPreviewBar onChange={handleChange} shareQuery={shareQuery} state={headerState} />
          <HeaderModeLink target={isDevRoute ? "demo" : "dev"} />
        </Box>
      ),
    });
  }, [handleChange, isDevRoute, isEmbedMode, navigation, shareQuery]);

  const frameWidth = state.viewport === "full" ? "100%" : Number(state.viewport);
  const background = state.background === "inverse" ? "primary" : "base";

  // Reflect direction and motion on web, and restore document defaults when leaving the preview.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dir = state.rtl ? "rtl" : "ltr";
    document.documentElement.dataset.reducedMotion = state.reducedMotion ? "1" : "0";
    return () => {
      document.documentElement.dir = "ltr";
      delete document.documentElement.dataset.reducedMotion;
    };
  }, [state.reducedMotion, state.rtl]);

  return (
    <DemoPreviewContext.Provider value={state}>
      <ThemeProvider colorScheme={state.theme}>
        <Box flex="grow" height="100%" testID="demo-preview-root" width="100%">
          <Box
            color={state.background === "transparent" ? undefined : background}
            flex="grow"
            height="100%"
            maxWidth={frameWidth}
            testID="demo-preview-frame"
            width={frameWidth}
          >
            {children}
          </Box>
        </Box>
      </ThemeProvider>
    </DemoPreviewContext.Provider>
  );
};
