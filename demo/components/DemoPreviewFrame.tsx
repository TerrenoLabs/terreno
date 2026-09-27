import {useEmbedMode} from "@contexts/EmbedModeContext";
import {Box, useTheme} from "@terreno/ui";
import {router, useGlobalSearchParams} from "expo-router";
import type React from "react";
import {useCallback, useEffect} from "react";

import {DemoPreviewContext} from "../previewContext";
import {type DemoPreviewState, previewQueryFromState, previewStateFromQuery} from "../previewState";
import {DemoPreviewBar} from "./DemoPreviewBar";
import {DARK_THEME_CONFIG} from "./palette/darkTheme";

export const DemoPreviewFrame: React.FC<{children: React.ReactNode}> = ({children}) => {
  const params = useGlobalSearchParams();
  const {isEmbedMode} = useEmbedMode();
  const state = previewStateFromQuery(params);
  const {resetTheme, setTheme} = useTheme();

  // Keep the live theme aligned with the shareable preview query.
  useEffect(() => {
    if (state.theme === "dark") {
      setTheme(DARK_THEME_CONFIG);
      return;
    }
    resetTheme();
  }, [resetTheme, setTheme, state.theme]);

  const handleChange = useCallback((next: DemoPreviewState): void => {
    const query = previewQueryFromState(next);
    router.setParams(Object.fromEntries(new URLSearchParams(query)));
  }, []);

  const frameWidth = state.viewport === "full" ? "100%" : Number(state.viewport);
  const background = state.background === "inverse" ? "primary" : "base";

  // Reflect direction and motion on web so the query is visible outside React state.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dir = state.rtl ? "rtl" : "ltr";
    document.documentElement.dataset.reducedMotion = state.reducedMotion ? "1" : "0";
  }, [state.reducedMotion, state.rtl]);

  return (
    <DemoPreviewContext.Provider value={state}>
      <Box testID="demo-preview-root">
        {isEmbedMode ? null : <DemoPreviewBar onChange={handleChange} state={state} />}
        <Box
          color={state.background === "transparent" ? undefined : background}
          maxWidth={frameWidth}
          testID="demo-preview-frame"
          width={frameWidth}
        >
          {children}
        </Box>
      </Box>
    </DemoPreviewContext.Provider>
  );
};
