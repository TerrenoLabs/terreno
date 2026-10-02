import {Accordion, Box, Heading, isSupportedDesktopWidth, Text} from "@terreno/ui";
import React from "react";
import {useWindowDimensions, View} from "react-native";

const useDemoIsMobile = (): boolean => {
  const {width} = useWindowDimensions();
  return !isSupportedDesktopWidth({width});
};

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

export const AccordionDevDemo = (): React.ReactElement => {
  const isMobile = useDemoIsMobile();
  const InfoChild = () => {
    return (
      <Box>
        <Text>Some children content</Text>
      </Box>
    );
  };
  return (
    <View style={{backgroundColor: "white", width: isMobile ? "100%" : "50%"}}>
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
    </View>
  );
};

export const AccordionOnToggleDemo = (): React.ReactElement => {
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const [title, setTitle] = React.useState("Sm Title");
  const isMobile = useDemoIsMobile();

  return (
    <View style={{backgroundColor: "white", width: isMobile ? "100%" : isCollapsed ? 150 : 450}}>
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
    </View>
  );
};
