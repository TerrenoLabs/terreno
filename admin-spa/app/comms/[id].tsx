import {CommsMessageDetail} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";

const CommsMessageAdminRoute: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const messageId = Array.isArray(id) ? id[0] : (id ?? "");

  return (
    <AdminSpaShell
      breadcrumbs={[
        {href: "/", label: "Admin"},
        {href: "/comms", label: "Comms"},
        {label: "Message"},
      ]}
    >
      <CommsMessageDetail messageId={messageId} routeBase="" />
    </AdminSpaShell>
  );
};

export default CommsMessageAdminRoute;
