import {Box, FlatList, Text, useListDetail} from "@terreno/ui";
import {type FC, memo, useCallback} from "react";

import {formatReceivedAt, MAIL_MESSAGES, type MailMessageFixture} from "./mailFixtures";

const MailRow: FC<{
  message: MailMessageFixture;
  isSelected: boolean;
  onSelect: (id: string) => void;
}> = memo(({message, isSelected, onSelect}) => {
  const handleSelect = useCallback((): void => {
    onSelect(message.id);
  }, [message.id, onSelect]);

  return (
    <Box
      accessibilityHint="Opens the message"
      accessibilityLabel={`${message.sender}: ${message.subject}`}
      accessibilityState={{selected: isSelected}}
      border="default"
      color={isSelected ? "secondaryExtraLight" : "base"}
      gap={1}
      onClick={handleSelect}
      paddingX={4}
      paddingY={3}
      testID={`mail-row-${message.id}`}
    >
      <Box direction="row" justifyContent="between">
        <Text bold>{message.sender}</Text>
        <Text color="secondaryLight" size="sm">
          {formatReceivedAt(message.receivedAt)}
        </Text>
      </Box>
      <Text>{message.subject}</Text>
      <Text color="secondaryLight" numberOfLines={1} size="sm">
        {message.preview}
      </Text>
    </Box>
  );
});

/**
 * The demo inbox. Reads and changes the open message through the surrounding
 * ListDetailLayout, so it works stacked on a phone and in the left pane on a tablet.
 */
export const MailList: FC = () => {
  const {select, selectedId} = useListDetail();

  const renderItem = useCallback(
    ({item}: {item: MailMessageFixture}) => (
      <MailRow isSelected={item.id === selectedId} message={item} onSelect={select} />
    ),
    [select, selectedId]
  );

  return (
    <Box color="base" flex="grow" testID="mail-list">
      <FlatList
        data={MAIL_MESSAGES}
        extraData={selectedId}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
      />
    </Box>
  );
};
