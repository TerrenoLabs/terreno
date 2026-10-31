import {OrgSettingsScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {adminApi} from "@/store/sdk";

const OrgSettingsRoute: React.FC = () => {
  const {orgId} = useLocalSearchParams<{orgId: string}>();
  return <OrgSettingsScreen api={adminApi} organizationId={orgId} routeBase="/admin" />;
};

export default OrgSettingsRoute;
