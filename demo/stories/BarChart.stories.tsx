import {BarChart, type BarChartProps, Box} from "@terreno/ui";
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

export const BarChartDemo = ({
  preview,
  ...props
}: Partial<BarChartProps> & {preview?: boolean}): React.ReactElement => {
  return (
    <Box width="100%">
      <BarChart
        data={SAMPLE_POINTS}
        height={preview ? PREVIEW_HEIGHT : undefined}
        legendLabel="Signups"
        testID="bar-chart-demo"
        {...props}
      />
    </Box>
  );
};

export const BarChartDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <BarChart data={SAMPLE_POINTS} legendLabel="Signups" testID="bar-chart-default" />
    </StorybookContainer>
  );
};

export const BarChartEmptyStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <BarChart data={[]} emptyText="No signups yet" testID="bar-chart-empty" />
    </StorybookContainer>
  );
};

export const BarChartZeroNegativeStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <BarChart
        data={[
          {label: "Mon", value: -8},
          {label: "Tue", value: 0},
          {label: "Wed", value: 14},
        ]}
        legendLabel="Delta"
        testID="bar-chart-zero-negative"
      />
    </StorybookContainer>
  );
};
