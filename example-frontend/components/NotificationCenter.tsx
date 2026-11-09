import {useQuery} from "@terreno/syncdb/react";
import {
  Box,
  Button,
  Heading,
  NotificationBell,
  NotificationInbox,
  type NotificationInboxItem,
  SideDrawer,
} from "@terreno/ui";
import {type Href, useRouter} from "expo-router";
import {DateTime} from "luxon";
import React, {useCallback, useContext, useMemo, useState} from "react";
import {useSyncDbReady} from "@/hooks/useSyncDbReady";
import {usePostNotificationsDevNotifyMutation} from "@/store/apiSdk";
import type {Notification} from "@/store/syncDbSdk";
import {syncDb} from "@/store/syncdb";

interface NotificationCenterContextValue {
  toggleDrawer: () => void;
  unreadCount: number;
}

const NotificationCenterContext = React.createContext<NotificationCenterContextValue | null>(null);

export const isNotificationArchived = (
  notification: Pick<Notification, "archivedAt" | "deleted">
): boolean => Boolean(notification.archivedAt) || notification.deleted === true;

const isActiveNotification = (notification: Notification): boolean =>
  !isNotificationArchived(notification);

export const sortNotificationsByCreatedDesc = (left: Notification, right: Notification): number => {
  const leftMillis = left.created ? DateTime.fromISO(left.created).toMillis() : 0;
  const rightMillis = right.created ? DateTime.fromISO(right.created).toMillis() : 0;
  return rightMillis - leftMillis;
};

export const toInboxItem = (notification: Notification): NotificationInboxItem => ({
  archived: isNotificationArchived(notification),
  body: notification.body,
  created: notification.created,
  href: notification.href,
  id: notification._id,
  kind: notification.kind,
  readAt: notification.readAt ?? null,
  title: notification.title,
});

export const NotificationCenterBell: React.FC = () => {
  const notificationCenter = useContext(NotificationCenterContext);
  if (!notificationCenter) {
    throw new Error("NotificationCenterBell must be rendered inside NotificationCenter");
  }
  return (
    <NotificationBell
      onPress={notificationCenter.toggleDrawer}
      unreadCount={notificationCenter.unreadCount}
    />
  );
};

export const NotificationCenter: React.FC<React.PropsWithChildren> = ({children}) => {
  const router = useRouter();
  const isSyncDbReady = useSyncDbReady();
  const [inboxVisible, setInboxVisible] = useState<boolean>(false);
  const [sendTestNotification, {isLoading: isSendingTest}] =
    usePostNotificationsDevNotifyMutation();

  const notifications = useQuery<Notification>("notifications", {
    filter: isActiveNotification,
    sort: sortNotificationsByCreatedDesc,
  });

  const inboxItems = useMemo(
    (): NotificationInboxItem[] => notifications.map(toInboxItem),
    [notifications]
  );

  const unreadCount = useMemo(
    (): number => inboxItems.filter((item) => !item.readAt).length,
    [inboxItems]
  );

  const handleToggleDrawer = useCallback((): void => {
    setInboxVisible((isVisible) => !isVisible);
  }, []);

  const handleDismissInbox = useCallback((): void => {
    setInboxVisible(false);
  }, []);

  const handleMarkRead = useCallback(
    (item: NotificationInboxItem): void => {
      if (!isSyncDbReady) {
        return;
      }
      syncDb.mutate({
        collection: "notifications",
        data: {readAt: DateTime.now().toISO()},
        id: item.id,
        operation: "update",
      });
    },
    [isSyncDbReady]
  );

  const handleMarkUnread = useCallback(
    (item: NotificationInboxItem): void => {
      if (!isSyncDbReady) {
        return;
      }
      syncDb.mutate({
        collection: "notifications",
        data: {readAt: null},
        id: item.id,
        operation: "update",
      });
    },
    [isSyncDbReady]
  );

  const handleDismiss = useCallback(
    (item: NotificationInboxItem): void => {
      if (!isSyncDbReady) {
        return;
      }
      syncDb.mutate({
        collection: "notifications",
        data: {archivedAt: DateTime.now().toISO()},
        id: item.id,
        operation: "update",
      });
    },
    [isSyncDbReady]
  );

  const handleOpen = useCallback(
    (item: NotificationInboxItem): void => {
      setInboxVisible(false);
      if (!item.href) {
        return;
      }
      if (item.href.startsWith("/")) {
        router.push(item.href as Href);
        return;
      }
    },
    [router]
  );

  const handleViewAll = useCallback(async (): Promise<void> => {
    setInboxVisible(false);
    if (isSyncDbReady) {
      try {
        await syncDb.reconcile();
      } catch (error: unknown) {
        console.warn("Notification history reconcile failed", error);
      }
    }
    router.push("/notifications");
  }, [isSyncDbReady, router]);

  const handleSendTest = useCallback(async (): Promise<void> => {
    try {
      await sendTestNotification({
        body: "Sent from the example todos screen.",
        href: "/",
        title: "Terreno test notification",
      }).unwrap();
      // Dev notify writes over HTTP; nudge sync to close the subscribe/reconcile gap so
      // the new row stays visible without waiting for a periodic reconcile or refresh.
      if (isSyncDbReady) {
        void syncDb.reconcile().catch((error: unknown) => {
          console.warn("Notification test reconcile failed", error);
        });
      }
    } catch (error: unknown) {
      console.error("Failed to send test notification", error);
    }
  }, [isSyncDbReady, sendTestNotification]);

  const contextValue = useMemo(
    (): NotificationCenterContextValue => ({
      toggleDrawer: handleToggleDrawer,
      unreadCount,
    }),
    [handleToggleDrawer, unreadCount]
  );

  const renderDrawerContent = useCallback(
    (): React.ReactElement => (
      <Box gap={4} padding={4} testID="notification-drawer">
        <Box alignItems="center" direction="row" justifyContent="between">
          <Heading size="lg">Notifications</Heading>
          <NotificationBell
            onPress={handleToggleDrawer}
            testID="notification-drawer-bell"
            unreadCount={unreadCount}
          />
        </Box>
        <Box maxHeight={520} scroll testID="notification-inbox-scroll">
          <NotificationInbox
            isLoading={!isSyncDbReady}
            items={inboxItems}
            onDismiss={handleDismiss}
            onMarkRead={handleMarkRead}
            onMarkUnread={handleMarkUnread}
            onOpen={handleOpen}
          />
        </Box>
        <Button
          fullWidth
          onClick={handleViewAll}
          testID="notification-view-all-button"
          text="View all notifications"
          variant="outline"
        />
        <Button
          fullWidth
          loading={isSendingTest}
          onClick={handleSendTest}
          testID="notification-send-test-button"
          text="Send test notification"
          variant="ghost"
        />
      </Box>
    ),
    [
      handleDismiss,
      handleMarkRead,
      handleMarkUnread,
      handleOpen,
      handleSendTest,
      handleToggleDrawer,
      handleViewAll,
      inboxItems,
      isSendingTest,
      isSyncDbReady,
      unreadCount,
    ]
  );

  return (
    <NotificationCenterContext.Provider value={contextValue}>
      <SideDrawer
        isOpen={inboxVisible}
        onClose={handleDismissInbox}
        position="right"
        renderContent={renderDrawerContent}
      >
        {children as React.ReactElement}
      </SideDrawer>
    </NotificationCenterContext.Provider>
  );
};
