import {Box, type SurfaceColor, Text, useTheme} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

const colors: SurfaceColor[] = [
  "base",
  "primary",
  "secondaryLight",
  "secondaryDark",
  "secondaryExtraDark",
  "neutral",
  "neutralLight",
  "neutralDark",
  "disabled",
  "error",
  "errorLight",
  "warning",
  "warningLight",
  "success",
  "successLight",
];

export const BoxDemo = () => {
  return (
    <Box direction="row" justifyContent="between">
      <Box color="primary" height={50} rounding="full" width={50}>
        <Text size="lg" />
      </Box>
      <Box color="secondaryLight" height={50} width={50}>
        <Text size="lg" />
      </Box>
      <Box border="activeAccent" color="neutralLight" height={50} rounding="rounded" width={50}>
        <Text size="lg" />
      </Box>
    </Box>
  );
};

export const FlexBox = () => {
  const {colorScheme} = useTheme();
  // Dark primary is a light blue. Inverted text is the dark label that meets 4.5:1 on it.
  const initialsColor = colorScheme === "dark" ? "inverted" : "primary";

  return (
    <StorybookContainer>
      <Box
        alignItems="center"
        color="primary"
        display="flex"
        height={50}
        justifyContent="center"
        marginRight={2}
        rounding="circle"
        width={50}
      >
        <Text color={initialsColor} size="lg">
          JG
        </Text>
      </Box>
      <Box direction="column" paddingX={2}>
        <Text bold>Josh Gachnang</Text>
        <Text>joined 2 years ago</Text>
      </Box>
    </StorybookContainer>
  );
};

export const BoxColors = () => {
  return (
    <StorybookContainer>
      {colors.map((c) => (
        <Box direction="column" display="flex" key={c}>
          <Box alignSelf="start" marginBottom={2}>
            <Text align="center">{c}</Text>
          </Box>
          <Box
            alignSelf="start"
            color={c}
            height={50}
            key={c}
            marginBottom={2}
            rounding="circle"
            width={50}
          >
            <Text> </Text>
          </Box>
        </Box>
      ))}
    </StorybookContainer>
  );
};

export const ResponsiveBoxLayout: React.FC = () => {
  return (
    <StorybookContainer>
      <Box marginBottom={3}>
        <Text bold>Resize the viewport</Text>
        <Text>
          Native: sm 320pt, md 375pt, lg 600pt, xl 1024pt. Web: sm 320pt, md 375pt, lg 1024pt, xl
          1280pt.
        </Text>
      </Box>
      <Box
        direction="column"
        gap={2}
        lgDirection="row"
        mdDirection="column"
        smDirection="row"
        testID="responsive-box-story"
        xlDirection="column"
      >
        {["One", "Two", "Three"].map(
          (label): React.ReactElement => (
            <Box
              alignItems="center"
              color="secondaryLight"
              justifyContent="center"
              key={label}
              padding={4}
              rounding="rounded"
            >
              <Text bold>{label}</Text>
            </Box>
          )
        )}
      </Box>
    </StorybookContainer>
  );
};
