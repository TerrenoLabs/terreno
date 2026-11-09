import {Box, SparklineChart, type SparklineChartProps} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

const CURRENT = [
  {label: "Mon", value: 100},
  {label: "Tue", value: 112},
  {label: "Wed", value: 104},
  {label: "Thu", value: 118},
  {label: "Fri", value: 109},
];

const PREVIOUS = [
  {label: "Mon", value: 101},
  {label: "Tue", value: 103},
  {label: "Wed", value: 108},
  {label: "Thu", value: 106},
  {label: "Fri", value: 111},
];

export const SparklineChartDemo = (props: Partial<SparklineChartProps>): React.ReactElement => {
  return (
    <Box maxWidth={240} width="100%">
      <SparklineChart comparisonData={PREVIOUS} data={CURRENT} {...props} />
    </Box>
  );
};

export const SparklineChartComparisonStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <SparklineChartDemo testID="sparkline-comparison-story" />
    </StorybookContainer>
  );
};

export const SparklineChartEmptyStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <SparklineChart data={[]} testID="sparkline-empty-story" />
    </StorybookContainer>
  );
};
