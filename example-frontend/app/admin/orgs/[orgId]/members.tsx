import {OrgMembersScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";

const OrgMembersRoute: React.FC = () => {
  const {orgId} = useLocalSearchParams<{orgId: string}>();
  return <OrgMembersScreen organizationId={orgId} routeBase="/admin" />;
};

export default OrgMembersRoute;
