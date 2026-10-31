import {CommsMessageDetail} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const CommsMessageAdminScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  return (
    <CommsMessageDetail
      api={adminApi}
      messageId={Array.isArray(id) ? id[0] : (id ?? "")}
      routeBase={ADMIN_BASE_URL}
    />
  );
};

export default CommsMessageAdminScreen;
