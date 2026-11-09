import {BarChart, ChartCard, type ChartCardProps} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

const POINTS = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
  {label: "Thu", value: 22},
  {label: "Fri", value: 15},
];

export const ChartCardDemo = (props: Partial<ChartCardProps>): React.ReactElement => {
  return (
    <ChartCard periodLabel="Last 14 days" title="Conversions by day" {...props}>
      <BarChart data={POINTS} height={180} legendLabel="Conversions" />
    </ChartCard>
  );
};

export const ChartCardDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <ChartCardDemo testID="chart-card-default-story" />
    </StorybookContainer>
  );
};

export const ChartCardFilterStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <ChartCard
        filterSummary="Report filters: status is Eligible"
        periodLabel="Previous period"
        testID="chart-card-filter-story"
        title="Keywords (monthly)"
      >
        <BarChart data={POINTS} height={180} />
      </ChartCard>
    </StorybookContainer>
  );
};
