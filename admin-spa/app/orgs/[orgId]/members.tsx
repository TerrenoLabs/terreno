import {OrgMembersScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {AdminSpaShell} from "../../../components/AdminSpaShell";

const OrgMembersRoute: React.FC = () => {
  const {orgId} = useLocalSearchParams<{orgId: string}>();
  return (
    <AdminSpaShell
      breadcrumbs={[
        {href: "/", label: "Admin"},
        {href: `/orgs/${orgId}`, label: "Organization"},
        {label: "Members"},
      ]}
    >
      <OrgMembersScreen organizationId={orgId} routeBase="" />
    </AdminSpaShell>
  );
};

export default OrgMembersRoute;
