import {Box, ThemeProvider} from "@terreno/ui";
import {useGlobalSearchParams} from "expo-router";
import type React from "react";
import {useEffect} from "react";

import {DemoPreviewContext} from "../previewContext";
import {previewStateFromQuery} from "../previewState";

export const DemoPreviewFrame: React.FC<{children: React.ReactNode}> = ({children}) => {
  const params = useGlobalSearchParams();
  const state = previewStateFromQuery(params);

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
