import {
  AreaChart,
  BarChart,
  Box,
  Card,
  ChartCard,
  DashboardGrid,
  DashboardGridItem,
  DonutChart,
  Heading,
  LineChart,
  Scorecard,
  Text,
} from "@terreno/ui";
import type {FC, ReactElement} from "react";

import {
  CHART_VISUAL_FIXTURES,
  type ChartVisualFixtureId,
  type ChartVisualFixtureMeta,
  chartVisualFixtureTestId,
} from "./fixtureCatalog";

const WEEKDAY_POINTS = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
];

const DAY_OF_WEEK_POINTS = [
  {label: "Monday", value: 6},
  {label: "Tuesday", value: 9},
  {label: "Wednesday", value: 5},
  {label: "Thursday", value: 6},
  {label: "Friday", value: 4},
  {label: "Saturday", value: 6},
  {label: "Sunday", value: 5},
];

const DATE_POINTS = Array.from({length: 14}, (_, index) => ({
  label: `Sep ${index + 1}, 2026`,
  value: [0, 0, 0, 20, 0, 35, 45, 48, 0, 35, 0, 33, 0, 0][index] ?? 0,
}));

const SIGNUP_POINTS = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
  {label: "Thu", value: 22},
  {label: "Fri", value: 15},
];

const PREVIOUS_POINTS = [
  {label: "Mon", value: 10},
  {label: "Tue", value: 11},
  {label: "Wed", value: 14},
  {label: "Thu", value: 13},
  {label: "Fri", value: 16},
];

const SHARE_SERIES = [
  {
    data: DATE_POINTS.map((point, index) => ({
      ...point,
      value:
        [0.55, 0.72, 0.25, 0.62, 0.68, 0.64, 0.69, 0.76, 0.66, 0.66, 0.65, 0.56, 0.61, 0.42][
          index
        ] ?? 0,
    })),
    id: "rank",
    label: "Search lost IS (rank)",
  },
  {
    data: DATE_POINTS.map((point, index) => ({
      ...point,
      value:
        [0.18, 0.09, 0.2, 0.12, 0.16, 0.14, 0.14, 0.15, 0.2, 0.15, 0.16, 0.16, 0.1, 0.14][index] ??
        0,
    })),
    id: "share",
    label: "Search impr. share",
  },
  {
    data: DATE_POINTS.map((point, index) => ({
      ...point,
      value:
        [0.24, 0.2, 0.45, 0.2, 0.15, 0.22, 0.12, 0.04, 0.14, 0.15, 0.15, 0.26, 0.23, 0.41][index] ??
        0,
    })),
    id: "budget",
    label: "Search lost IS (budget)",
  },
];

const SIGNUP_WITH_GAPS = [
  {label: "Mon", value: -4},
  {label: "Tue", value: 0},
  {label: "Wed", value: 8},
  {label: "Thu", value: -2},
  {label: "Fri", value: 5},
];

const DONUT_POINTS = [
  {label: "Open", value: 12},
  {label: "In progress", value: 8},
  {label: "Done", value: 20},
];

const DONUT_HEX_POINTS = [
  {label: "Open", value: 12},
  {label: "In progress", value: 8},
  {color: "#543C00", label: "Done", value: 20},
];

const DEVICE_COST_POINTS = [
  {label: "Mobile phones", value: 79},
  {label: "Computers", value: 20},
];

const DEVICE_CONVERSION_POINTS = [{label: "Mobile phones", value: 7}];

const DENSE_POINTS = [
  {label: "Week of Aug 04", value: 4},
  {label: "Week of Aug 11", value: 9},
  {label: "Week of Aug 18", value: 6},
  {label: "Week of Aug 25", value: 14},
  {label: "Week of Sep 01", value: 11},
  {label: "Week of Sep 08", value: 18},
  {label: "Week of Sep 15", value: 7},
];

const formatUsd = (value: number): string => {
  return `$${value}`;
};

const formatFixed = (value: number): string => {
  return value.toFixed(2);
};

const formatPercent = (value: number): string => {
  return `${value.toFixed(2)}%`;
};

const FixtureFrame: FC<{fixture: ChartVisualFixtureMeta; children: ReactElement}> = ({
  children,
  fixture,
}) => {
  return (
    <Box color="base" padding={3} testID={chartVisualFixtureTestId(fixture.id)} width="100%">
      <Box marginBottom={2}>
        <Text bold size="sm">
          {fixture.difficulty}: {fixture.title}
        </Text>
      </Box>
      {children}
    </Box>
  );
};

const DashboardTablePlaceholder: FC<{
  height: number;
  periodLabel: string;
  title: string;
}> = ({height, periodLabel, title}) => {
  return (
    <ChartCard periodLabel={periodLabel} title={title}>
      <Box alignItems="center" height={height} justifyContent="center">
        <Text color="secondaryDark" size="sm">
          DataTable lands in Task 5.2
        </Text>
      </Box>
    </ChartCard>
  );
};

const renderFixture = (fixture: (typeof CHART_VISUAL_FIXTURES)[number]): ReactElement => {
  switch (fixture.id) {
    case "line-three-points":
      return (
        <FixtureFrame fixture={fixture}>
          <LineChart data={WEEKDAY_POINTS} height={220} testID={fixture.id} />
        </FixtureFrame>
      );
    case "bar-three-points":
      return (
        <FixtureFrame fixture={fixture}>
          <BarChart data={WEEKDAY_POINTS} height={220} testID={fixture.id} />
        </FixtureFrame>
      );
    case "area-three-points":
      return (
        <FixtureFrame fixture={fixture}>
          <AreaChart data={WEEKDAY_POINTS} height={220} testID={fixture.id} />
        </FixtureFrame>
      );
    case "donut-three-slices":
      return (
        <FixtureFrame fixture={fixture}>
          <DonutChart data={DONUT_POINTS} height={220} testID={fixture.id} />
        </FixtureFrame>
      );
    case "line-empty":
      return (
        <FixtureFrame fixture={fixture}>
          <LineChart data={[]} emptyText="No signups yet" height={220} testID={fixture.id} />
        </FixtureFrame>
      );
    case "line-legend-currency":
      return (
        <FixtureFrame fixture={fixture}>
          <LineChart
            data={SIGNUP_POINTS}
            formatValue={formatUsd}
            height={240}
            legendLabel="Revenue"
            testID={fixture.id}
          />
        </FixtureFrame>
      );
    case "bar-negatives-and-zero":
      return (
        <FixtureFrame fixture={fixture}>
          <BarChart data={SIGNUP_WITH_GAPS} height={240} legendLabel="Delta" testID={fixture.id} />
        </FixtureFrame>
      );
    case "donut-hex-override":
      return (
        <FixtureFrame fixture={fixture}>
          <DonutChart data={DONUT_HEX_POINTS} height={240} testID={fixture.id} />
        </FixtureFrame>
      );
    case "line-dense-labels":
      return (
        <FixtureFrame fixture={fixture}>
          <LineChart
            data={DENSE_POINTS}
            height={240}
            legendLabel="Weekly active"
            testID={fixture.id}
          />
        </FixtureFrame>
      );
    case "line-fixed-slot-140":
      return (
        <FixtureFrame fixture={fixture}>
          <Box height={140} overflow="hidden" width="100%">
            <LineChart
              data={SIGNUP_POINTS}
              height={140}
              legendLabel="Signups"
              testID={fixture.id}
            />
          </Box>
        </FixtureFrame>
      );
    case "bar-time-rotated-ticks":
      return (
        <FixtureFrame fixture={fixture}>
          <BarChart
            data={DATE_POINTS}
            formatValue={formatUsd}
            height={300}
            legendLabel="Cost / conv."
            periodLabel="Last 14 days"
            testID={fixture.id}
            title="Cost / conv. over time"
          />
        </FixtureFrame>
      );
    case "bar-day-of-week":
      return (
        <FixtureFrame fixture={fixture}>
          <BarChart
            data={DAY_OF_WEEK_POINTS}
            height={260}
            legendLabel="Conversions"
            periodLabel="Jun 25, 2026 – Sep 23, 2026"
            testID={fixture.id}
            title="Conv. by day of week"
          />
        </FixtureFrame>
      );
    case "donut-center-and-share":
      return (
        <FixtureFrame fixture={fixture}>
          <DonutChart
            centerTitle="Cost"
            centerValue="$1.15K"
            data={DEVICE_COST_POINTS}
            height={280}
            periodLabel="Last 30 days"
            testID={fixture.id}
            title="Cost by Device"
          />
        </FixtureFrame>
      );
    case "donut-single-slice":
      return (
        <FixtureFrame fixture={fixture}>
          <DonutChart
            centerTitle="Conversions"
            centerValue="7.00"
            data={DEVICE_CONVERSION_POINTS}
            height={260}
            periodLabel="Last 14 days"
            testID={fixture.id}
            title="Conversions by Device"
          />
        </FixtureFrame>
      );
    case "scorecard-sparkline-comparison":
      return (
        <FixtureFrame fixture={fixture}>
          <DashboardGrid columns={{lg: 5, md: 2, sm: 1}} gap={2}>
            <Scorecard
              comparisonData={PREVIOUS_POINTS}
              formatValue={formatUsd}
              sparklineData={SIGNUP_POINTS}
              testID="scorecard-fixture.0"
              title="Cost"
              value={569}
            />
            <Scorecard
              comparisonData={PREVIOUS_POINTS}
              formatValue={formatFixed}
              sparklineData={SIGNUP_POINTS}
              testID="scorecard-fixture.1"
              title="Conversions"
              value={7}
            />
            <Scorecard
              comparisonData={PREVIOUS_POINTS}
              formatValue={formatUsd}
              sparklineData={SIGNUP_POINTS}
              testID="scorecard-fixture.2"
              title="Cost / conv."
              value={81.32}
            />
            <Scorecard
              comparisonData={PREVIOUS_POINTS}
              formatValue={formatPercent}
              sparklineData={SIGNUP_POINTS}
              testID="scorecard-fixture.3"
              title="Conv. rate"
              value={4.35}
            />
            <Scorecard
              comparisonData={PREVIOUS_POINTS}
              formatValue={formatPercent}
              sparklineData={SIGNUP_POINTS}
              testID="scorecard-fixture.4"
              title="Search lost IS (rank)"
              value={57.75}
            />
          </DashboardGrid>
        </FixtureFrame>
      );
    case "line-three-series":
      return (
        <FixtureFrame fixture={fixture}>
          <LineChart
            data={[]}
            formatValue={(value): string => value.toFixed(1)}
            height={320}
            periodLabel="Jun 25, 2026 – Sep 23, 2026"
            series={SHARE_SERIES}
            testID={fixture.id}
            title="Imp. share over time"
          />
        </FixtureFrame>
      );
    case "hows-it-going-dashboard":
      return (
        <FixtureFrame fixture={fixture}>
          <DashboardGrid columns={{lg: 6, md: 2, sm: 1}} gap={3} testID="hows-it-going-dashboard">
            <DashboardGridItem span={{lg: 6, md: 2, sm: 1}} testID="hows-it-going-dashboard.kpis">
              <DashboardGrid columns={{lg: 5, md: 2, sm: 1}} gap={2}>
                <Scorecard
                  comparisonData={PREVIOUS_POINTS}
                  formatValue={formatUsd}
                  sparklineData={SIGNUP_POINTS}
                  title="Cost"
                  value={569}
                />
                <Scorecard
                  comparisonData={PREVIOUS_POINTS}
                  formatValue={formatFixed}
                  sparklineData={SIGNUP_POINTS}
                  title="Conversions"
                  value={7}
                />
                <Scorecard
                  comparisonData={PREVIOUS_POINTS}
                  formatValue={formatUsd}
                  sparklineData={SIGNUP_POINTS}
                  title="Cost / conv."
                  value={81.32}
                />
                <Scorecard
                  comparisonData={PREVIOUS_POINTS}
                  formatValue={formatPercent}
                  sparklineData={SIGNUP_POINTS}
                  title="Conv. rate"
                  value={4.35}
                />
                <Scorecard
                  comparisonData={PREVIOUS_POINTS}
                  formatValue={formatPercent}
                  sparklineData={SIGNUP_POINTS}
                  title="Search lost IS (rank)"
                  value={57.75}
                />
              </DashboardGrid>
            </DashboardGridItem>
            <DashboardGridItem
              span={{lg: 3, md: 2, sm: 1}}
              testID="hows-it-going-dashboard.table-placeholder"
            >
              <DashboardTablePlaceholder
                height={590}
                periodLabel="Last 14 days"
                title="Top search terms by cost"
              />
            </DashboardGridItem>
            <DashboardGridItem
              span={{lg: 3, md: 2, sm: 1}}
              testID="hows-it-going-dashboard.time-charts"
            >
              <Box gap={3}>
                <BarChart
                  data={DATE_POINTS}
                  formatValue={formatUsd}
                  height={300}
                  legendLabel="Cost / conv."
                  periodLabel="Last 14 days"
                  title="Cost / conv. over time"
                />
                <LineChart
                  data={[]}
                  formatValue={(value): string => value.toFixed(1)}
                  height={320}
                  periodLabel="Jun 25, 2026 – Sep 23, 2026"
                  series={SHARE_SERIES}
                  title="Imp. share over time"
                />
              </Box>
            </DashboardGridItem>
            <DashboardGridItem
              span={{lg: 3, md: 2, sm: 1}}
              testID="hows-it-going-dashboard.bottom-table-placeholder"
            >
              <DashboardTablePlaceholder
                height={250}
                periodLabel="Last 14 days"
                title="Ad Group Check-in"
              />
            </DashboardGridItem>
            <DashboardGridItem span={{lg: 1, md: 1, sm: 1}}>
              <BarChart
                data={DAY_OF_WEEK_POINTS}
                height={280}
                periodLabel="Jun 25 – Sep 23"
                title="Conv. by day"
              />
            </DashboardGridItem>
            <DashboardGridItem span={{lg: 1, md: 1, sm: 1}}>
              <DonutChart
                centerTitle="Cost"
                centerValue="$1.15K"
                data={DEVICE_COST_POINTS}
                height={280}
                periodLabel="Last 30 days"
                title="Cost by Device"
              />
            </DashboardGridItem>
            <DashboardGridItem span={{lg: 1, md: 1, sm: 1}}>
              <DonutChart
                centerTitle="Conversions"
                centerValue="7.00"
                data={DEVICE_CONVERSION_POINTS}
                height={280}
                periodLabel="Last 14 days"
                title="Conversions by Device"
              />
            </DashboardGridItem>
          </DashboardGrid>
        </FixtureFrame>
      );
    case "dashboard-mixed-cards":
      return (
        <FixtureFrame fixture={fixture}>
          <DashboardGrid columns={{lg: 2, md: 2, sm: 1}} gap={3} testID={fixture.id}>
            <Card>
              <LineChart data={SIGNUP_POINTS} height={180} legendLabel="Signups" />
            </Card>
            <Card>
              <BarChart data={SIGNUP_POINTS} height={180} legendLabel="Sessions" />
            </Card>
            <Card>
              <AreaChart data={SIGNUP_POINTS} height={180} legendLabel="Errors" />
            </Card>
            <Card>
              <DonutChart data={DONUT_HEX_POINTS} height={180} />
            </Card>
          </DashboardGrid>
        </FixtureFrame>
      );
    case "composed-product-card":
      return (
        <FixtureFrame fixture={fixture}>
          <Card>
            <Box gap={2} padding={2}>
              <Heading size="sm">North star</Heading>
              <Text color="secondaryDark" size="sm">
                Weekly signups with currency tooltips. Long axis labels must truncate in-band.
              </Text>
              <LineChart
                data={DENSE_POINTS}
                formatValue={formatUsd}
                height={220}
                legendLabel="Signups"
                testID={fixture.id}
              />
              <Text color="secondaryDark" size="sm">
                Caption: owned SVG, container width, height is the whole chart.
              </Text>
            </Box>
          </Card>
        </FixtureFrame>
      );
    case "ops-row-line-bar-donut":
      return (
        <FixtureFrame fixture={fixture}>
          <Box direction="column" gap={3} width="100%">
            <Heading size="sm">Ops</Heading>
            <Box direction="row" gap={3} width="100%" wrap>
              <Box flex="grow" minWidth={0} width="32%">
                <Card>
                  <LineChart data={SIGNUP_POINTS} height={200} legendLabel="Signups" />
                </Card>
              </Box>
              <Box flex="grow" minWidth={0} width="32%">
                <Card>
                  <BarChart data={SIGNUP_WITH_GAPS} height={200} legendLabel="Delta" />
                </Card>
              </Box>
              <Box flex="grow" minWidth={0} width="32%">
                <Card>
                  <DonutChart data={DONUT_POINTS} height={200} />
                </Card>
              </Box>
            </Box>
          </Box>
        </FixtureFrame>
      );
  }
};

export const renderChartVisualFixture = (id: ChartVisualFixtureId): ReactElement => {
  const fixture = CHART_VISUAL_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) {
    throw new Error(`Unknown chart visual fixture: ${id}`);
  }
  return renderFixture(fixture);
};
