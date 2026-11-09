import {Box, Heading, Text} from "@terreno/ui";
import type {FC} from "react";

import {CHART_VISUAL_FIXTURES, CHART_VISUAL_GALLERY_TEST_ID} from "./fixtureCatalog";
import {renderChartVisualFixture} from "./fixtures";

export const ChartVisualGallery: FC = () => {
  return (
    <Box color="baseAlternate" padding={4} testID={CHART_VISUAL_GALLERY_TEST_ID} width="100%">
      <Box marginBottom={4}>
        <Heading size="md">Chart visual gallery</Heading>
        <Text>
          Easy through hard fixtures for rendered snapshot comparison. Opened by bun run
          ui:charts:compare.
        </Text>
      </Box>
      {CHART_VISUAL_FIXTURES.map((fixture) => (
        <Box key={fixture.id} marginBottom={6} width="100%">
          {renderChartVisualFixture(fixture.id)}
        </Box>
      ))}
    </Box>
  );
};
