import type {FC} from "react";

import {Box} from "./Box";
import {ChartCard} from "./ChartCard";
import type {ScorecardProps} from "./Common";
import {Heading} from "./Heading";
import {SparklineChart} from "./SparklineChart";
import {resolveTestID} from "./testing/resolveTestId";

export const Scorecard: FC<ScorecardProps> = ({
  comparisonData,
  formatValue = String,
  onPeriodPress,
  periodLabel,
  sparklineData,
  testID,
  title,
  value,
}) => {
  const displayValue = typeof value === "number" ? formatValue(value) : value;

  return (
    <ChartCard
      onPeriodPress={onPeriodPress}
      periodLabel={periodLabel}
      testID={testID}
      title={title}
    >
      <Box gap={2} minWidth={0} width="100%">
        <Heading size="xl" testID={resolveTestID(testID, "value")}>
          {displayValue}
        </Heading>
        {sparklineData && sparklineData.length > 0 ? (
          <SparklineChart
            comparisonData={comparisonData}
            data={sparklineData}
            testID={resolveTestID(testID, "sparkline")}
          />
        ) : null}
      </Box>
    </ChartCard>
  );
};

export type {ScorecardProps} from "./Common";
