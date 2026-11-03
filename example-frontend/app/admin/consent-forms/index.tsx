import {ConsentFormList} from "@terreno/admin-frontend";
import {useRouter} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const ConsentFormsScreen: React.FC = () => {
  const router = useRouter();
  return (
    <ConsentFormList
      api={adminApi}
      baseUrl={ADMIN_BASE_URL}
      onCreateNew={() => router.push("/admin/consent-forms/create")}
      onRowClick={(id) => router.push(`/admin/consent-forms/${id}`)}
    />
  );
};

export default ConsentFormsScreen;
