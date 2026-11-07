import {OrgMembersScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {AdminSpaShell} from "../../../components/AdminSpaShell";
import {RouteSeed} from "../../../components/RouteSeed";
import {createOrgsLoader} from "../../../server/orgsRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createOrgsLoader("/orgs/[orgId]/members");

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
      <RouteSeed>
        <OrgMembersScreen organizationId={orgId} routeBase="" />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default OrgMembersRoute;
