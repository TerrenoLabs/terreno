import {Banner, Box} from "@terreno/ui";
import React from "react";
import {type EvalPipelineStepNumber, formatStepReminder} from "./evalPipeline";

export interface EvalStepBannerProps {
  activity: string;
  detail: string;
  step: EvalPipelineStepNumber;
  testID?: string;
}

/** One-line reminder of where this screen sits in the four-step eval plan. */
export const EvalStepBanner: React.FC<EvalStepBannerProps> = ({
  activity,
  detail,
  step,
  testID = "ai-eval-step-banner",
}) => {
  return (
    <Box testID={testID}>
      <Banner hasIcon status="info" text={formatStepReminder({activity, detail, step})} />
    </Box>
  );
};
