import {Box, Text} from "@terreno/ui";
import React from "react";
import {type EvalPipelineStepNumber, formatStepReminder} from "./evalPipeline";

export interface EvalStepBannerProps {
  activity: string;
  detail: string;
  step: EvalPipelineStepNumber;
  testID?: string;
}

/** One-line reminder of where this screen sits in the four-step experiment plan. */
export const EvalStepBanner: React.FC<EvalStepBannerProps> = ({
  activity,
  detail,
  step,
  testID = "ai-eval-step-banner",
}) => {
  return (
    <Box
      border="default"
      color="secondaryExtraLight"
      paddingX={3}
      paddingY={2}
      rounding="md"
      testID={testID}
    >
      <Text size="sm" testID={`${testID}-text`}>
        {formatStepReminder({activity, detail, step})}
      </Text>
    </Box>
  );
};
