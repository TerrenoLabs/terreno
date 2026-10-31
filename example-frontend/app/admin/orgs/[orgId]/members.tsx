import {OrgMembersScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const OrgMembersRoute: React.FC = () => {
  const {orgId} = useLocalSearchParams<{orgId: string}>();
  return <OrgMembersScreen api={adminApi} organizationId={orgId} routeBase="/admin" />;
};

export default OrgMembersRoute;
