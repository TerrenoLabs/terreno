import {useRouter} from "expo-router";
import React, {useCallback} from "react";
import {AnnouncementOverview} from "./AnnouncementOverview";
import type {AdminScreenWidgetProps, ScreenWidgetComponent} from "./types";

export const AnnouncementOverviewScreenWidget: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  const router = useRouter();
  const announcementsBase = `${routeBase}/announcements`;

  const handleCreate = useCallback((): void => {
    router.push(`${announcementsBase}/create` as never);
  }, [announcementsBase, router]);

  const handleEdit = useCallback(
    (id: string): void => {
      router.push(`${announcementsBase}/${id}` as never);
    },
    [announcementsBase, router]
  );

  const handleOpenAcknowledgements = useCallback((): void => {
    router.push(`${routeBase}/AnnouncementAcknowledgement` as never);
  }, [routeBase, router]);

  const handleOpenImpressions = useCallback((): void => {
    router.push(`${routeBase}/AnnouncementImpression` as never);
  }, [routeBase, router]);

  const handleOpenClickEvents = useCallback((): void => {
    router.push(`${routeBase}/AnnouncementClickEvent` as never);
  }, [routeBase, router]);

  return (
    <AnnouncementOverview
      onCreate={handleCreate}
      onEdit={handleEdit}
      onOpenAcknowledgements={handleOpenAcknowledgements}
      onOpenClickEvents={handleOpenClickEvents}
      onOpenImpressions={handleOpenImpressions}
      routeBase={routeBase}
    />
  );
};

export const ANNOUNCEMENTS_ADMIN_WIDGETS: Record<string, ScreenWidgetComponent> = {
  announcements: AnnouncementOverviewScreenWidget,
};
