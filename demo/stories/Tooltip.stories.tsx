import {
  Box,
  Heading,
  IconButton,
  isSupportedDesktopWidth,
  Text,
  Tooltip,
  type TooltipProps,
} from "@terreno/ui";
import type React from "react";
import {useWindowDimensions} from "react-native";

const useDemoIsMobile = (): boolean => {
  const {width} = useWindowDimensions();
  return !isSupportedDesktopWidth({width});
};
export const TooltipDemo = (props: Partial<TooltipProps>) => {
  return (
    <Box alignItems="center" justifyContent="center">
      <Tooltip idealPosition="top" text="Demo Tooltip" {...props}>
        <IconButton accessibilityLabel="" iconName="hippo" onClick={() => {}} />
      </Tooltip>
    </Box>
  );
};

const ChevronTooltip = ({
  idealPosition,
  text = "Short Tooltip Text",
  includeArrow,
}: {
  idealPosition: "left" | "right" | "top" | "bottom" | "none";
  text?: string;
  includeArrow?: boolean;
}): React.ReactElement => (
  <IconButton
    accessibilityLabel="info"
    iconName={
      idealPosition === "none"
        ? "question"
        : idealPosition === "bottom"
          ? "chevron-down"
          : idealPosition === "top"
            ? "chevron-up"
            : `chevron-${idealPosition}`
    }
    onClick={() => {}}
    tooltipIdealPosition={idealPosition === "none" ? undefined : idealPosition}
    tooltipIncludeArrow={includeArrow}
    tooltipText={text}
  />
);

const FiveTooltips = ({
  text,
  includeArrow = false,
}: {
  text?: string;
  includeArrow?: boolean;
}): React.ReactElement => (
  <Box direction="row" marginTop={1}>
    <ChevronTooltip idealPosition="left" includeArrow={includeArrow} text={text} />
    <ChevronTooltip idealPosition="top" includeArrow={includeArrow} text={text} />
    <ChevronTooltip idealPosition="bottom" includeArrow={includeArrow} text={text} />
    <ChevronTooltip idealPosition="right" includeArrow={includeArrow} text={text} />
  </Box>
);

export const ToolTipPositions = (): React.ReactElement => {
  const isMobile = useDemoIsMobile();
  return (
    <Box direction="column" display="flex" padding={4}>
      <Box
        alignItems="center"
        height={!isMobile ? "100%" : undefined}
        justifyContent="center"
        width={!isMobile ? "100%" : undefined}
      >
        <Box>
          <Box paddingY={2}>
            <Heading size="sm">Different Positions - Web Demo</Heading>
            <FiveTooltips />
          </Box>
          <Box paddingY={2}>
            <Heading size="sm">Different Positions With Overflow</Heading>
            <FiveTooltips
              text={
                "Here's a much longer tooltip, to test overflows, works very well with multiple lines too!"
              }
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export const IncludesArrow = (): React.ReactElement => {
  const isMobile = useDemoIsMobile();
  return (
    <Box direction="column" display="flex" padding={4}>
      <Box
        alignItems="center"
        height={!isMobile ? "100%" : undefined}
        justifyContent="center"
        width={!isMobile ? "100%" : undefined}
      >
        <Box paddingY={2}>
          <Heading size="sm">
            Includes an Arrow - to be used when tooltip areas are crowded together - Web Demo
          </Heading>
          <FiveTooltips includeArrow />
        </Box>
      </Box>
    </Box>
  );
};

export const TooltipOverText = (): React.ReactElement => {
  const isMobile = useDemoIsMobile();
  return (
    <Box direction="column" display="flex" padding={4}>
      <Box
        alignItems="center"
        height={!isMobile ? "100%" : undefined}
        justifyContent="center"
        width={!isMobile ? "100%" : undefined}
      >
        <Box direction="row" paddingY={2}>
          <Tooltip text="Text Tooltip">
            <Text>This text has a tooltip. Works on Mobile</Text>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
};
