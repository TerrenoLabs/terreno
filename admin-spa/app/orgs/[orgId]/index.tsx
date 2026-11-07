import {OrgSettingsScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {AdminSpaShell} from "../../../components/AdminSpaShell";
import {RouteSeed} from "../../../components/RouteSeed";
import {createOrgsLoader} from "../../../server/orgsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createOrgsLoader("/orgs/[orgId]");

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
      <RouteSeed>
        <OrgSettingsScreen organizationId={orgId} routeBase="" />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default OrgSettingsRoute;
