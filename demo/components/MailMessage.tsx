import {Box, Heading, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type {FC} from "react";

import {findMailMessage, formatReceivedAt} from "./mailFixtures";

/**
 * The open message, read from the route's `[id]` param.
 */
export const MailMessage: FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const message = findMailMessage(id);

  if (!message) {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center" padding={6}>
        <Text testID="mail-message-missing">This message does not exist.</Text>
      </Box>
    );
  }

  return (
    <Box color="base" flex="grow" gap={3} padding={6} scroll testID={`mail-message-${message.id}`}>
      <Heading size="lg">{message.subject}</Heading>
      <Text color="secondaryLight" size="sm">
        {message.sender} · {formatReceivedAt(message.receivedAt)}
      </Text>
      <Text>{message.body}</Text>
    </Box>
  );
};

/**
 * Shown in the detail pane on a wide layout before a message is opened.
 */
export const MailEmptyState: FC = () => (
  <Box alignItems="center" color="baseAlternate" flex="grow" justifyContent="center" padding={6}>
    <Text color="secondaryLight">Select a message to read it.</Text>
  </Box>
);
