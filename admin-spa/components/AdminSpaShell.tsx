import {AdminShellLayout, OrgSwitcher} from "@terreno/admin-frontend";
import React from "react";
import {useAppConfig} from "./AppConfigGate";
import {isOrganizationOperatorProfile, useAdminSpaProfile} from "./adminSpaProfile";

interface AdminSpaShellProps {
  breadcrumbs?: {href?: string; label: string}[];
  children: React.ReactNode;
}

export const AdminSpaShell: React.FC<AdminSpaShellProps> = ({breadcrumbs, children}) => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {data: profile} = useAdminSpaProfile();
  const isOrganizationOperator = isOrganizationOperatorProfile(profile);
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
