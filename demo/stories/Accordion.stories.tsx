import {Accordion, Box, Heading, isNarrowViewport, Text} from "@terreno/ui";
import React from "react";
import {View} from "react-native";

export const AccordionDemo = () => {
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

export const AccordionDevDemo = () => {
  const isMobile = isNarrowViewport();
  const InfoChild = () => {
    return (
      <Box>
        <Text>Some children content</Text>
      </Box>
    );
  };
  return (
    <Box color="base" width={isMobile ? "100%" : "50%"}>
      <View style={{padding: 15, width: "100%"}}>
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
      </View>
    </Box>
  );
};

export const AccordionOnToggleDemo = () => {
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const [title, setTitle] = React.useState("Sm Title");
  const isMobile = isNarrowViewport();

  return (
    <Box color="base" width={isMobile ? "100%" : isCollapsed ? 150 : 450}>
      <View style={{padding: 15, width: "100%"}}>
        <Accordion
          isCollapsed={isCollapsed}
          onToggle={(isCollapse: boolean) => {
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
      </View>
    </Box>
  );
};
