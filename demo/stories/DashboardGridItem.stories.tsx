import {Box, Card, DashboardGrid, DashboardGridItem, Text} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

const Tile: React.FC<{label: string}> = ({label}) => {
  return (
    <Card padding={3}>
      <Text>{label}</Text>
    </Card>
  );
};

export const DashboardGridItemDemo = (): React.ReactElement => {
  return (
    <DashboardGrid columns={{lg: 4, md: 2, sm: 1}} gap={3} testID="dashboard-grid-item-demo">
      <DashboardGridItem span={{lg: 2, md: 2, sm: 1}} testID="dashboard-grid-item-wide">
        <Tile label="Spans two columns" />
      </DashboardGridItem>
      <DashboardGridItem testID="dashboard-grid-item-narrow">
        <Tile label="One column" />
      </DashboardGridItem>
      <Box>
        <Tile label="Plain child stays one column" />
      </Box>
    </DashboardGrid>
  );
};

export const DashboardGridItemDefaultStory = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <DashboardGridItemDemo />
    </StorybookContainer>
  );
};
