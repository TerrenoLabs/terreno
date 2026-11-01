import {Accordion, Box, Heading, isSupportedDesktopWidth, Text} from "@terreno/ui";
import React from "react";
import {useWindowDimensions} from "react-native";

const useDemoIsMobile = (): boolean => {
  const {width} = useWindowDimensions();
  return !isSupportedDesktopWidth({width});
};

export const AccordionDemo = (): React.ReactElement => {
  return (
    <>
      <Accordion isCollapsed title="Accordion Title 1">
        <Box>
          <Text>Some children content</Text>
        </Box>
      </Accordion>
      <Accordion isCollapsed title="Accordion Title 2">
        <Box>
          <Text>Some more children content</Text>
        </Box>
      </Accordion>
    </>
  );
};

export const AccordionDevDemo = (): React.ReactElement => {
  const isMobile = useDemoIsMobile();
  const InfoChild = (): React.ReactElement => {
    return (
      <Box>
        <Text>Some children content</Text>
      </Box>
    );
  };
  return (
    <Box color="base" width={isMobile ? "100%" : "50%"}>
      <Box padding={4} width="100%">
        <Accordion
          includeInfoModal
          infoModalChildren={<InfoChild />}
          infoModalSubtitle="Info Modal Subtitle"
          infoModalTitle="Info Modal Title"
          title="Accordion Title"
        >
          <Box>
            <Heading size="sm">Some children content</Heading>
            <Text>Some more children content</Text>
          </Box>
        </Accordion>
      </Box>
    </Box>
  );
};

export const AccordionOnToggleDemo = (): React.ReactElement => {
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const [title, setTitle] = React.useState("Sm Title");
  const isMobile = useDemoIsMobile();
  const [containerWidth, setContainerWidth] = React.useState<number | "100%">("100%");

  // Width animation is client-only so static export SSR matches the first paint.
  React.useEffect(() => {
    if (isMobile) {
      setContainerWidth("100%");
      return;
    }
    setContainerWidth(isCollapsed ? 150 : 450);
  }, [isCollapsed, isMobile]);

  return (
    <Box color="base" width={containerWidth}>
      <Box padding={4} width="100%">
        <Accordion
          isCollapsed={isCollapsed}
          onToggle={(isCollapse: boolean): void => {
            setIsCollapsed(isCollapse);
            setTitle(isCollapse ? "Sm T" : "Longer Title With On Toggle");
          }}
          title={title}
        >
          <Box>
            <Heading size="sm">Custom Width setting set by onToggle Callback</Heading>
            <Text>Allows dynamic width adjustment</Text>
          </Box>
        </Accordion>
      </Box>
    </Box>
  );
};
