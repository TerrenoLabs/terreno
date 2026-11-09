import {Box, LineChart, type LineChartProps, Text} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

/** Fits the home screen preview tile, which is a fixed-height box. */
const PREVIEW_HEIGHT = 140;

const SAMPLE_POINTS = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
  {label: "Thu", value: 22},
  {label: "Fri", value: 15},
];

export const LineChartDemo = ({
  preview,
  ...props
}: Partial<LineChartProps> & {preview?: boolean}): React.ReactElement => {
  return (
    <Box width="100%">
      <LineChart
        data={SAMPLE_POINTS}
        height={preview ? PREVIEW_HEIGHT : undefined}
        legendLabel="Signups"
        testID="line-chart-demo"
        {...props}
      />
    </Box>
  );
};

export const LineChartDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <LineChart data={SAMPLE_POINTS} legendLabel="Signups" testID="line-chart-default" />
    </StorybookContainer>
  );
};

export const LineChartEmptyStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <LineChart data={[]} emptyText="No signups yet" testID="line-chart-empty" />
    </StorybookContainer>
  );
};

export const LineChartLoadingStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <LineChart data={SAMPLE_POINTS} loading testID="line-chart-loading" />
    </StorybookContainer>
  );
};

export const LineChartTooltipStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Text>Press or hover a point to show the tooltip as label: value.</Text>
      <LineChart data={SAMPLE_POINTS} legendLabel="Signups" testID="line-chart-tooltip" />
    </StorybookContainer>
  );
};
