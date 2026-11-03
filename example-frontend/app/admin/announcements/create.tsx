import {AnnouncementEditor} from "@terreno/admin-frontend";
import {useRouter} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const CreateAnnouncementScreen: React.FC = () => {
  const router = useRouter();
  return (
    <AnnouncementEditor
      api={adminApi}
      baseUrl={ADMIN_BASE_URL}
      onCancel={() => router.back()}
      onSave={() => router.back()}
    />
  );
};

export default CreateAnnouncementScreen;
