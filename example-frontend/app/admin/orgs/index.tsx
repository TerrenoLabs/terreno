import {type OrganizationSummary, OrgDirectoryScreen, useOrgContext} from "@terreno/admin-frontend";
import {router} from "expo-router";
import React, {useCallback} from "react";
import {adminApi, useGetMeQuery} from "@/store/sdk";

const OrgDirectoryRoute: React.FC = () => {
  const {data: profile} = useGetMeQuery();
  const {selectOrganization} = useOrgContext();
  const roles = profile?.roles ?? [];
  const isOperator = roles.includes("operator") || roles.includes("superadmin");
  const handleEnter = useCallback(
    (organization: OrganizationSummary): void => {
      selectOrganization(organization);
      router.push(`/admin/orgs/${organization._id}`);
    },
    [selectOrganization]
  );
  return (
    <OrgDirectoryScreen
      api={adminApi}
      isOperator={isOperator}
      onEnterOrganization={handleEnter}
      routeBase="/admin"
    />
  );
};

export default OrgDirectoryRoute;
