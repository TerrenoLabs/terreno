import {AdminVersionConfig} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../components/AdminSpaShell";
import {useAppConfig} from "../components/AppConfigGate";

const VersionConfigRoute: React.FC = () => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";

  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Version configuration"}]}>
      <AdminVersionConfig apiBase={apiBase} routeBase="" />
    </AdminSpaShell>
  );
};

export default VersionConfigRoute;
