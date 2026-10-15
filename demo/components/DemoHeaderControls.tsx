import {Box} from "@terreno/ui";
import {router, useGlobalSearchParams} from "expo-router";
import type React from "react";
import {useCallback} from "react";

import {
  type DemoPreviewState,
  previewParamsFromState,
  previewQueryFromState,
  previewStateFromQuery,
} from "../previewState";
import {DemoPreviewBar} from "./DemoPreviewBar";
import {HeaderModeLink} from "./HeaderModeLink";

interface DemoHeaderControlsProps {
  modeTarget: "demo" | "dev";
}

/** Stack-header preview controls. The layout owns them so a theme re-render cannot drop the switcher. */
export const DemoHeaderControls: React.FC<DemoHeaderControlsProps> = ({modeTarget}) => {
  const params = useGlobalSearchParams();
  const state = previewStateFromQuery(params);
  const shareQuery = previewQueryFromState(state);

  const handleChange = useCallback((next: DemoPreviewState): void => {
    router.setParams(previewParamsFromState(next));
  }, []);

  return (
    <Box alignItems="center" direction="row">
      <DemoPreviewBar onChange={handleChange} shareQuery={shareQuery} state={state} />
      <HeaderModeLink target={modeTarget} />
    </Box>
  );
};
