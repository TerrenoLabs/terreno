import {type OrganizationSummary, OrgDirectoryScreen, useOrgContext} from "@terreno/admin-frontend";
import {router} from "expo-router";
import React, {useCallback} from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {useGetAdminSpaProfileQuery} from "../../store/sdk";

const OrgDirectoryRoute: React.FC = () => {
  const {data: profile} = useGetAdminSpaProfileQuery();
  const {selectOrganization} = useOrgContext();
  const roles = profile?.roles ?? [];
  const isOperator = roles.includes("operator") || roles.includes("superadmin");
  const handleEnter = useCallback(
    (organization: OrganizationSummary): void => {
      selectOrganization(organization);
      router.push(`/orgs/${organization._id}`);
    },
    [selectOrganization]
  );
  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Organizations"}]}>
      <OrgDirectoryScreen isOperator={isOperator} onEnterOrganization={handleEnter} routeBase="" />
    </AdminSpaShell>
  );
};

export default OrgDirectoryRoute;
