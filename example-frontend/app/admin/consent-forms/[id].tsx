import {ConsentFormEditor} from "@terreno/admin-frontend";
import {useLocalSearchParams, useRouter} from "expo-router";
import React from "react";

const ADMIN_BASE_URL = "/admin";

const EditConsentFormScreen: React.FC = () => {
  const router = useRouter();
  const {id} = useLocalSearchParams<{id: string}>();
  return (
    <ConsentFormEditor
      baseUrl={ADMIN_BASE_URL}
      id={id}
      onCancel={() => router.back()}
      onSave={() => router.back()}
    />
  );
};

export default EditConsentFormScreen;
