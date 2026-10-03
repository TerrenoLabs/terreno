import {Box, Scorecard, type ScorecardProps} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

const CURRENT = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
  {label: "Thu", value: 22},
  {label: "Fri", value: 15},
];

const PREVIOUS = [
  {label: "Mon", value: 10},
  {label: "Tue", value: 11},
  {label: "Wed", value: 14},
  {label: "Thu", value: 13},
  {label: "Fri", value: 16},
];

const formatUsd = (value: number): string => {
  return `$${value}`;
};

export const ScorecardDemo = (props: Partial<ScorecardProps>): React.ReactElement => {
  return (
    <Box maxWidth={360} width="100%">
      <Scorecard
        comparisonData={PREVIOUS}
        formatValue={formatUsd}
        sparklineData={CURRENT}
        title="Cost"
        value={569}
        {...props}
      />
    </Box>
  );
};

export const ScorecardComparisonStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <ScorecardDemo testID="scorecard-comparison-story" />
    </StorybookContainer>
  );
};

export const ScorecardStringStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Scorecard testID="scorecard-string-story" title="Status" value="Healthy" />
    </StorybookContainer>
  );
};
