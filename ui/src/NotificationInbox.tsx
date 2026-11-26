import {DateTime} from "luxon";
import {type FC, memo, useCallback} from "react";
import {Pressable} from "react-native";

import {Box} from "./Box";
import {Heading} from "./Heading";
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {useStableCallback} from "./useStableCallback";

export interface NotificationInboxItem {
  archived?: boolean;
  body: string;
  created?: string;
  href?: string;
  id: string;
  kind?: string;
  readAt?: string | null;
  title: string;
}

export interface NotificationInboxProps {
  isLoading?: boolean;
  items: NotificationInboxItem[];
  onDismiss: (item: NotificationInboxItem) => void;
  onMarkRead: (item: NotificationInboxItem) => void;
  onMarkUnread: (item: NotificationInboxItem) => void;
  onOpen: (item: NotificationInboxItem) => void;
  testID?: string;
}

const formatTimestamp = (created?: string): string => {
  if (!created) {
    return "";
  }
  const parsed = DateTime.fromISO(created);
  if (!parsed.isValid) {
    return "";
  }
  return parsed.toRelative() ?? parsed.toLocaleString(DateTime.DATETIME_MED);
};

const isUnread = (item: NotificationInboxItem): boolean => !item.readAt;

interface NotificationInboxRowProps {
  item: NotificationInboxItem;
  onDismiss: (item: NotificationInboxItem) => void;
  onMarkRead: (item: NotificationInboxItem) => void;
  onMarkUnread: (item: NotificationInboxItem) => void;
  onOpen: (item: NotificationInboxItem) => void;
  testID: string;
}

// Memoized so a change to one notification re-renders that row, not the whole inbox.
const NotificationInboxRow: FC<NotificationInboxRowProps> = memo(
  ({item, onDismiss, onMarkRead, onMarkUnread, onOpen, testID}) => {
    const unread = isUnread(item);
    const isArchived = item.archived === true;

    const handleDismiss = useCallback((): void => {
      onDismiss(item);
    }, [item, onDismiss]);
    const handleOpen = useCallback((): void => {
      onOpen(item);
    }, [item, onOpen]);
    const handleMarkRead = useCallback((): void => {
      onMarkRead(item);
    }, [item, onMarkRead]);
    const handleMarkUnread = useCallback((): void => {
      onMarkUnread(item);
    }, [item, onMarkUnread]);

    return (
      <Box
        border="default"
        color={unread ? "secondaryLight" : "base"}
        gap={2}
        padding={3}
        rounding="md"
        testID={`${testID}-item-${item.id}`}
      >
        <Box alignItems="start" direction="row" justifyContent="between">
          <Box flex="grow" gap={1}>
            <Box alignItems="center" direction="row" gap={2}>
              <Heading size="sm">{item.title}</Heading>
              {isArchived ? <Text color="secondaryLight">Archived</Text> : null}
            </Box>
            {item.created ? (
              <Text color="secondaryLight" size="sm">
                {formatTimestamp(item.created)}
              </Text>
            ) : null}
          </Box>
          {!isArchived ? (
            <Pressable
              accessibilityLabel="Dismiss notification"
              onPress={handleDismiss}
              testID={`${testID}-dismiss-${item.id}`}
            >
              <Text color="secondaryLight">Dismiss</Text>
            </Pressable>
          ) : null}
        </Box>
        <Pressable onPress={handleOpen} testID={`${testID}-open-${item.id}`}>
          <Text>{item.body}</Text>
        </Pressable>
        {!isArchived ? (
          <Box direction="row" gap={2} wrap>
            {unread ? (
              <Pressable onPress={handleMarkRead} testID={`${testID}-mark-read-${item.id}`}>
                <Text color="link">Mark read</Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleMarkUnread} testID={`${testID}-mark-unread-${item.id}`}>
                <Text color="link">Mark unread</Text>
              </Pressable>
            )}
          </Box>
        ) : null}
      </Box>
    );
  }
);
NotificationInboxRow.displayName = "NotificationInboxRow";

export const NotificationInbox: FC<NotificationInboxProps> = ({
  isLoading = false,
  items,
  onDismiss,
  onMarkRead,
  onMarkUnread,
  onOpen,
  testID = "notification-inbox",
}) => {
  const handleDismiss = useStableCallback(onDismiss);
  const handleMarkRead = useStableCallback(onMarkRead);
  const handleMarkUnread = useStableCallback(onMarkUnread);
  const handleOpen = useStableCallback(onOpen);

  if (isLoading) {
    return (
      <Box alignItems="center" paddingY={6} testID={`${testID}-loading`}>
        <Spinner />
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box paddingY={4} testID={`${testID}-empty`}>
        <Text color="secondaryLight">You are all caught up.</Text>
      </Box>
    );
  }

  return (
    <Box gap={3} testID={`${testID}-list`}>
      {items.map((item) => (
        <NotificationInboxRow
          item={item}
          key={item.id}
          onDismiss={handleDismiss}
          onMarkRead={handleMarkRead}
          onMarkUnread={handleMarkUnread}
          onOpen={handleOpen}
          testID={testID}
        />
      ))}
    </Box>
  );
};
