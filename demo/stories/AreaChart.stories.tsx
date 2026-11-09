import {AreaChart, type AreaChartProps, Box} from "@terreno/ui";
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

export const AreaChartDemo = ({
  preview,
  ...props
}: Partial<AreaChartProps> & {preview?: boolean}): React.ReactElement => {
  return (
    <Box width="100%">
      <AreaChart
        data={SAMPLE_POINTS}
        height={preview ? PREVIEW_HEIGHT : undefined}
        legendLabel="Signups"
        testID="area-chart-demo"
        {...props}
      />
    </Box>
  );
};

export const AreaChartDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <AreaChart data={SAMPLE_POINTS} legendLabel="Signups" testID="area-chart-default" />
    </StorybookContainer>
  );
};

export const AreaChartEmptyStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <AreaChart data={[]} emptyText="No signups yet" testID="area-chart-empty" />
    </StorybookContainer>
  );
};
