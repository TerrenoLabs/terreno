import type {FC} from "react";

import {Box} from "./Box";
import {ChartCard} from "./ChartCard";
import type {ScorecardProps} from "./Common";
import {Heading} from "./Heading";
import {Skeleton} from "./Skeleton";
import {SparklineChart} from "./SparklineChart";
import {resolveTestID} from "./testing/resolveTestId";

const SCORECARD_VALUE_SKELETON_HEIGHT = 32;
const SCORECARD_SPARKLINE_SKELETON_HEIGHT = 48;

export const Scorecard: FC<ScorecardProps> = ({
  comparisonData,
  formatValue = String,
  loading,
  loadingAnimation,
  loadingComponent,
  loadingLabel,
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
      loading={loading}
      loadingAnimation={loadingAnimation}
      loadingComponent={
        loadingComponent ?? (
          <Box gap={2} width="100%">
            <Skeleton height={SCORECARD_VALUE_SKELETON_HEIGHT} width="50%" />
            {sparklineData !== undefined && (
              <Skeleton height={SCORECARD_SPARKLINE_SKELETON_HEIGHT} />
            )}
          </Box>
        )
      }
      loadingLabel={loadingLabel}
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
