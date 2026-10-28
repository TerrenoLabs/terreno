import type {FC} from "react";

import {Badge} from "./Badge";
import {Box} from "./Box";
import {Card} from "./Card";
import type {ChartCardProps} from "./Common";
import {Heading} from "./Heading";
import {Skeleton} from "./Skeleton";
import {Text} from "./Text";
import {resolveTestID} from "./testing/resolveTestId";

const CHART_SKELETON_HEIGHT = 160;

interface PeriodBadgeProps {
  label: string;
  onPress?: () => void;
  testID?: string;
}

const PeriodBadge: FC<PeriodBadgeProps> = ({label, onPress, testID}) => {
  const badge = (
    <Badge
      secondary
      status="active"
      testID={onPress ? resolveTestID(testID, "badge") : testID}
      value={label}
    />
  );

  if (onPress) {
    return (
      <Box
        accessibilityHint="Change reporting period"
        accessibilityLabel={label}
        accessibilityRole="button"
        onClick={onPress}
        testID={testID}
      >
        {badge}
      </Box>
    );
  }

  return badge;
};

export const ChartCard: FC<ChartCardProps> = ({
  children,
  filterSummary,
  loading,
  loadingAnimation,
  loadingComponent,
  loadingLabel,
  onPeriodPress,
  periodLabel,
  testID,
  title,
}) => {
  return (
    <Card gap={3} padding={4} testID={testID}>
      <Box alignItems="start" direction="row" gap={2} justifyContent="between" width="100%">
        <Box flex="grow" minWidth={0}>
          <Heading size="sm" testID={resolveTestID(testID, "title")}>
            {title}
          </Heading>
        </Box>
        {periodLabel ? (
          <PeriodBadge
            label={periodLabel}
            onPress={onPeriodPress}
            testID={resolveTestID(testID, "period")}
          />
        ) : null}
      </Box>
      {filterSummary ? (
        <Text color="secondaryDark" size="sm" testID={resolveTestID(testID, "filter-summary")}>
          {filterSummary}
        </Text>
      ) : null}
      <Box
        loading={loading}
        loadingAnimation={loadingAnimation}
        loadingComponent={
          loadingComponent ?? <Skeleton height={CHART_SKELETON_HEIGHT} rounding="md" />
        }
        loadingLabel={loadingLabel}
        minWidth={0}
        testID={loading ? resolveTestID(testID, "loading") : undefined}
        width="100%"
      >
        {children}
      </Box>
    </Card>
  );
};

export type {ChartCardProps} from "./Common";
