import {OrgSettingsScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {AdminSpaShell} from "../../../components/AdminSpaShell";

const OrgSettingsRoute: React.FC = () => {
  const {orgId} = useLocalSearchParams<{orgId: string}>();
  return (
    <AdminSpaShell
      breadcrumbs={[
        {href: "/", label: "Admin"},
        {href: "/orgs", label: "Organizations"},
        {label: "Settings"},
      ]}
    >
      <OrgSettingsScreen organizationId={orgId} routeBase="" />
    </AdminSpaShell>
  );
};

export default OrgSettingsRoute;
