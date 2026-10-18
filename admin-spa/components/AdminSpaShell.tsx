import {AdminShellLayout, OrgSwitcher} from "@terreno/admin-frontend";
import React from "react";
import {useGetAdminSpaProfileQuery} from "../store/sdk";
import {useAppConfig} from "./AppConfigGate";

interface AdminSpaShellProps {
  breadcrumbs?: {href?: string; label: string}[];
  children: React.ReactNode;
}

export const AdminSpaShell: React.FC<AdminSpaShellProps> = ({breadcrumbs, children}) => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {data: profile} = useGetAdminSpaProfileQuery();
  const roles = profile?.roles ?? [];
  const isOrganizationOperator = roles.includes("operator") || roles.includes("superadmin");
  return (
    <AdminShellLayout
      apiBase={apiBase}
      breadcrumbs={breadcrumbs}
      configurationPath="/configuration"
      isOrganizationOperator={isOrganizationOperator}
      organizationDirectoryPath="/orgs"
      organizationSwitcher={<OrgSwitcher routeBase="" />}
      rolesPath="/roles"
      routeBase=""
    >
      {children}
    </AdminShellLayout>
  );
};
