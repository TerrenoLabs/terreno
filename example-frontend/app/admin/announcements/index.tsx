import {AnnouncementOverview} from "@terreno/admin-frontend";
import {useRouter} from "expo-router";
import React, {useCallback} from "react";

const ADMIN_BASE_URL = "/admin";

const AnnouncementsScreen: React.FC = () => {
  const router = useRouter();

  const handleCreate = useCallback((): void => {
    router.push("/admin/announcements/create");
  }, [router]);

  const handleEdit = useCallback(
    (id: string): void => {
      router.push(`/admin/announcements/${id}`);
    },
    [router]
  );

  const handleOpenAcknowledgements = useCallback((): void => {
    router.push("/admin/AnnouncementAcknowledgement");
  }, [router]);

  const handleOpenImpressions = useCallback((): void => {
    router.push("/admin/AnnouncementImpression");
  }, [router]);

  const handleOpenClickEvents = useCallback((): void => {
    router.push("/admin/AnnouncementClickEvent");
  }, [router]);

  return (
    <AnnouncementOverview
      baseUrl={ADMIN_BASE_URL}
      onCreate={handleCreate}
      onEdit={handleEdit}
      onOpenAcknowledgements={handleOpenAcknowledgements}
      onOpenClickEvents={handleOpenClickEvents}
      onOpenImpressions={handleOpenImpressions}
    />
  );
};

export default AnnouncementsScreen;
