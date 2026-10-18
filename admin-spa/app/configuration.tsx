import {ConfigurationScreen} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../components/AdminSpaShell";

const ConfigurationRoute: React.FC = () => {
  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Configuration"}]}>
      <ConfigurationScreen title="App Configuration" />
    </AdminSpaShell>
  );
};

export default ConfigurationRoute;
