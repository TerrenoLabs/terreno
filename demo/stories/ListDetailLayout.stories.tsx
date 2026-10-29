import {Box, Button, Text} from "@terreno/ui";
import {router} from "expo-router";
import type {FC} from "react";

/**
 * ListDetailLayout is an expo-router layout, so the demo opens its live routes instead of
 * rendering it inline.
 */
export const ListDetailLayoutDemo: FC = () => (
  <Box gap={3} padding={4}>
    <Text color="secondaryDark" size="md">
      ListDetailLayout is a route group&apos;s _layout. On a phone the inbox pushes each message; on
      a tablet or wide browser the inbox stays on the left and the message opens on the right.
      Resize the window or rotate the device with a message open: it stays open.
    </Text>
    <Box direction="row" gap={2} wrap>
      <Button
        iconName="arrow-up-right-from-square"
        onClick={() => router.navigate("/demo/list-detail")}
        testID="list-detail-open-inbox"
        text="Open inbox"
        variant="primary"
      />
      <Button
        iconName="table-columns"
        onClick={() => router.navigate("/demo/sidebar-navigation/mail")}
        testID="list-detail-open-sidebar-inbox"
        text="Open inbox in a sidebar"
        variant="secondary"
      />
    </Box>
  </Box>
);
