import {Box, Button} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";
import type {DemoPreviewState} from "../previewState";

const VIEWPORTS: DemoPreviewState["viewport"][] = ["full", "320", "375", "1024", "1280"];
const BACKGROUNDS: DemoPreviewState["background"][] = ["default", "inverse", "transparent"];

export const DemoPreviewBar: React.FC<{
  onChange: (state: DemoPreviewState) => void;
  state: DemoPreviewState;
}> = ({onChange, state}) => {
  const update = useCallback(
    (patch: Partial<DemoPreviewState>): void => {
      onChange({...state, ...patch});
    },
    [onChange, state]
  );

  return (
    <Box gap={2} marginBottom={4} testID="demo-preview-bar">
      <Box direction="row" gap={2} wrap>
        <Button
          onClick={() => {
            update({theme: state.theme === "dark" ? "light" : "dark"});
          }}
          testID="preview-theme"
          text={state.theme === "dark" ? "Dark" : "Light"}
          variant="outline"
        />
        {VIEWPORTS.map((viewport) => (
          <Button
            key={viewport}
            onClick={() => {
              update({viewport});
            }}
            testID={`preview-viewport-${viewport}`}
            text={viewport}
            variant={state.viewport === viewport ? "primary" : "outline"}
          />
        ))}
      </Box>
      <Box direction="row" gap={2} wrap>
        {BACKGROUNDS.map((background) => (
          <Button
            key={background}
            onClick={() => {
              update({background});
            }}
            testID={`preview-background-${background}`}
            text={background}
            variant={state.background === background ? "primary" : "outline"}
          />
        ))}
        <Button
          onClick={() => {
            update({rtl: !state.rtl});
          }}
          testID="preview-rtl"
          text={state.rtl ? "RTL" : "LTR"}
          variant="outline"
        />
        <Button
          onClick={() => {
            update({reducedMotion: !state.reducedMotion});
          }}
          testID="preview-motion"
          text={state.reducedMotion ? "Reduced motion" : "Motion"}
          variant="outline"
        />
        <Button
          onClick={() => {
            update({locale: state.locale === "en" ? "en-US" : "en"});
          }}
          testID="preview-locale"
          text={state.locale}
          variant="outline"
        />
      </Box>
    </Box>
  );
};
