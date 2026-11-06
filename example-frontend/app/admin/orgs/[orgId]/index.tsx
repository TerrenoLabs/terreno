import {OrgSettingsScreen} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React from "react";

const OrgSettingsRoute: React.FC = () => {
  const {orgId} = useLocalSearchParams<{orgId: string}>();
  return <OrgSettingsScreen organizationId={orgId} routeBase="/admin" />;
};

export default OrgSettingsRoute;
