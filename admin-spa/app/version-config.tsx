import {AdminVersionConfig} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../components/AdminSpaShell";
import {useAppConfig} from "../components/AppConfigGate";
import {RouteSeed} from "../components/RouteSeed";
import {createRpcRouteLoader} from "../server/rpcRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createRpcRouteLoader("/version-config");

const VersionConfigRoute: React.FC = () => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";

  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Version configuration"}]}>
      <RouteSeed>
        <AdminVersionConfig apiBase={apiBase} routeBase="" />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default VersionConfigRoute;
