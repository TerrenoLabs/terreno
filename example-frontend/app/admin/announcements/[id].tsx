import {AnnouncementEditor} from "@terreno/admin-frontend";
import {useLocalSearchParams, useRouter} from "expo-router";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const EditAnnouncementScreen: React.FC = () => {
  const router = useRouter();
  const {id} = useLocalSearchParams<{id: string}>();
  return (
    <AnnouncementEditor
      baseUrl={ADMIN_BASE_URL}
      id={id}
      onCancel={() => router.back()}
      onSave={() => router.back()}
    />
  );
};

export default EditAnnouncementScreen;
