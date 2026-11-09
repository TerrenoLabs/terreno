import {Box, DonutChart, type DonutChartProps} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

/** Fits the home screen preview tile, which is a fixed-height box. */
const PREVIEW_HEIGHT = 140;

const SAMPLE_POINTS = [
  {label: "Open", value: 12},
  {label: "In progress", value: 8},
  {color: "#543C00", label: "Done", value: 20},
];

export const DonutChartDemo = ({
  preview,
  ...props
}: Partial<DonutChartProps> & {preview?: boolean}): React.ReactElement => {
  return (
    <Box width="100%">
      <DonutChart
        data={SAMPLE_POINTS}
        height={preview ? PREVIEW_HEIGHT : undefined}
        testID="donut-chart-demo"
        {...props}
      />
    </Box>
  );
};

export const DonutChartDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <DonutChart data={SAMPLE_POINTS} testID="donut-chart-default" />
    </StorybookContainer>
  );
};

export const DonutChartEmptyStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <DonutChart data={[]} emptyText="No slices yet" testID="donut-chart-empty" />
    </StorybookContainer>
  );
};
