import {AnnouncementEditor} from "@terreno/admin-frontend";
import {useRouter} from "expo-router";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const CreateAnnouncementScreen: React.FC = () => {
  const router = useRouter();
  return (
    <AnnouncementEditor
      baseUrl={ADMIN_BASE_URL}
      onCancel={() => router.back()}
      onSave={() => router.back()}
    />
  );
};

export default CreateAnnouncementScreen;
