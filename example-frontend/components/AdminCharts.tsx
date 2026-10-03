import {
  AreaChart,
  BarChart,
  Box,
  DashboardGrid,
  DashboardGridItem,
  DonutChart,
  Heading,
  LineChart,
  Scorecard,
  Text,
} from "@terreno/ui";
import type React from "react";

interface ChartPoint {
  label: string;
  value: number;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const CREATED_VALUES = [4, 6, 5, 8, 7, 3, 2];
const COMPLETED_VALUES = [3, 5, 4, 6, 8, 2, 1];
const PREVIOUS_COMPLETED_VALUES = [2, 3, 3, 4, 5, 2, 1];
const OPEN_VALUES = [8, 9, 10, 12, 11, 7, 6];

const PERIOD_LABEL = "Sample week";

const toPoints = (values: number[]): ChartPoint[] => {
  return WEEKDAY_LABELS.map((label, index) => {
    return {label, value: values[index] ?? 0};
  });
};

const CREATED_POINTS = toPoints(CREATED_VALUES);
const COMPLETED_POINTS = toPoints(COMPLETED_VALUES);
const PREVIOUS_COMPLETED_POINTS = toPoints(PREVIOUS_COMPLETED_VALUES);
const OPEN_POINTS = toPoints(OPEN_VALUES);

const STATUS_POINTS: ChartPoint[] = [
  {label: "Open", value: 6},
  {label: "Done", value: 29},
  {label: "Overdue", value: 2},
];

const ACTIVITY_SERIES = [
  {data: CREATED_POINTS, id: "created", label: "Created"},
  {data: COMPLETED_POINTS, id: "completed", label: "Completed"},
];

const formatCount = (value: number): string => {
  return String(Math.round(value));
};

const formatPercent = (value: number): string => {
  return `${value.toFixed(0)}%`;
};

export const AdminCharts: React.FC = () => {
  return (
    <Box gap={3} testID="admin-charts" width="100%">
      <Box gap={1}>
        <Heading size="md">How's it going</Heading>
        <Text color="secondaryLight" size="sm">
          Sample charts from @terreno/ui with static demo data.
        </Text>
      </Box>
      <DashboardGrid columns={{lg: 3, md: 2, sm: 1}} gap={3} testID="admin-charts-grid">
        <Scorecard
          comparisonData={PREVIOUS_COMPLETED_POINTS}
          formatValue={formatCount}
          periodLabel={PERIOD_LABEL}
          sparklineData={COMPLETED_POINTS}
          testID="admin-charts-completed"
          title="Completed"
          value={29}
        />
        <Scorecard
          formatValue={formatCount}
          periodLabel={PERIOD_LABEL}
          sparklineData={OPEN_POINTS}
          testID="admin-charts-open"
          title="Still open"
          value={6}
        />
        <Scorecard
          formatValue={formatPercent}
          periodLabel={PERIOD_LABEL}
          sparklineData={COMPLETED_POINTS}
          testID="admin-charts-rate"
          title="Done rate"
          value={83}
        />
        <DashboardGridItem span={{lg: 2, md: 2, sm: 1}} testID="admin-charts-activity">
          <LineChart
            data={[]}
            formatValue={formatCount}
            height={240}
            periodLabel={PERIOD_LABEL}
            series={ACTIVITY_SERIES}
            testID="admin-charts-line"
            title="Created vs completed"
          />
        </DashboardGridItem>
        <DonutChart
          centerTitle="Todos"
          centerValue="37"
          data={STATUS_POINTS}
          formatValue={formatCount}
          height={240}
          periodLabel={PERIOD_LABEL}
          testID="admin-charts-donut"
          title="Status mix"
        />
        <BarChart
          comparisonData={PREVIOUS_COMPLETED_POINTS}
          data={COMPLETED_POINTS}
          formatValue={formatCount}
          height={220}
          legendLabel="Completed"
          periodLabel={PERIOD_LABEL}
          testID="admin-charts-bar"
          title="Completed by day"
        />
        <DashboardGridItem span={{lg: 2, md: 2, sm: 1}}>
          <AreaChart
            data={OPEN_POINTS}
            formatValue={formatCount}
            height={220}
            legendLabel="Open"
            periodLabel={PERIOD_LABEL}
            testID="admin-charts-area"
            title="Open todos"
          />
        </DashboardGridItem>
      </DashboardGrid>
    </Box>
  );
};
