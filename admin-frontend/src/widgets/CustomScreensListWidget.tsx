import {Box, Card, Heading, Text} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {memo, useCallback} from "react";
import type {AdminCustomScreen, AdminHomeWidgetProps} from "../types";

interface CustomScreenCardProps {
  onPress: (screenName: string) => void;
  screen: AdminCustomScreen;
}

// Memoized so a home re-render does not re-render every screen card.
const CustomScreenCard: React.FC<CustomScreenCardProps> = memo(({onPress, screen}) => {
  const handlePress = useCallback((): void => {
    onPress(screen.name);
  }, [onPress, screen.name]);

  return (
    <Card padding={4} testID={`admin-custom-screen-card-${screen.name}`}>
      <Box
        accessibilityHint={`Navigate to ${screen.displayName}`}
        accessibilityLabel={screen.displayName}
        gap={2}
        onClick={handlePress}
        width={240}
      >
        <Heading size="md">{screen.displayName}</Heading>
        <Text color="secondaryDark" size="sm">
          {screen.description ?? "Custom screen"}
        </Text>
      </Box>
    </Card>
  );
});
CustomScreenCard.displayName = "CustomScreenCard";

/** Lists custom admin screens from config as navigable cards (tools section). */
export const CustomScreensListWidget: React.FC<AdminHomeWidgetProps> = ({config, routeBase}) => {
  const screens = config.customScreens ?? [];

  const onPress = useCallback(
    (screenName: string): void => {
      router.push(`${routeBase}/${screenName}` as Href);
    },
    [routeBase]
  );

  if (screens.length === 0) {
    return null;
  }

  return (
    <Box gap={2} testID="admin-home-widget-customScreens" width="100%">
      <Heading size="sm">Screens</Heading>
      <Box direction="row" gap={4} wrap>
        {screens.map((screen) => (
          <CustomScreenCard key={screen.name} onPress={onPress} screen={screen} />
        ))}
      </Box>
    </Box>
  );
};
