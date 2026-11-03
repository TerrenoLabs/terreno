import {ConfigurationScreen} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../components/AdminSpaShell";
import {RouteSeed} from "../components/RouteSeed";
import {createRpcRouteLoader} from "../server/rpcRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createRpcRouteLoader("/configuration");

const ConfigurationRoute: React.FC = () => {
  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Configuration"}]}>
      <RouteSeed>
        <ConfigurationScreen title="App Configuration" />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default ConfigurationRoute;
