import {BarChart, Box, Card, DashboardGrid, LineChart} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

/** The home screen preview tile is only 300x176, so it shows two compact cards instead of three. */
const PREVIEW_CHART_HEIGHT = 104;

const SAMPLE_POINTS = [
  {label: "Mon", value: 12},
  {label: "Tue", value: 18},
  {label: "Wed", value: 9},
];

export const DashboardGridDemo = ({preview}: {preview?: boolean}): React.ReactElement => {
  if (preview) {
    return (
      <DashboardGrid columns={{lg: 2, md: 2, sm: 1}} gap={2} testID="dashboard-grid-preview">
        <Card padding={2}>
          <LineChart data={SAMPLE_POINTS} height={PREVIEW_CHART_HEIGHT} />
        </Card>
        <Card padding={2}>
          <BarChart data={SAMPLE_POINTS} height={PREVIEW_CHART_HEIGHT} />
        </Card>
      </DashboardGrid>
    );
  }

  return (
    <DashboardGrid testID="dashboard-grid-demo">
      <Card>
        <Box padding={3}>
          <LineChart data={SAMPLE_POINTS} height={160} legendLabel="Signups" />
        </Box>
      </Card>
      <Card>
        <Box padding={3}>
          <LineChart data={SAMPLE_POINTS} height={160} legendLabel="Sessions" />
        </Box>
      </Card>
      <Card>
        <Box padding={3}>
          <LineChart data={SAMPLE_POINTS} height={160} legendLabel="Errors" />
        </Box>
      </Card>
    </DashboardGrid>
  );
};

export const DashboardGridDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <DashboardGridDemo />
    </StorybookContainer>
  );
};
