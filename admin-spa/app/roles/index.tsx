import {AdminRolesList} from "@terreno/admin-frontend";
import React from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {useAppConfig} from "../../components/AppConfigGate";
import {RouteSeed} from "../../components/RouteSeed";
import {createRpcRouteLoader} from "../../server/rpcRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createRpcRouteLoader("/roles");

const RolesRoute: React.FC = () => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";

  return (
    <AdminSpaShell breadcrumbs={[{href: "/", label: "Admin"}, {label: "Roles"}]}>
      <RouteSeed>
        <AdminRolesList apiBase={apiBase} routeBase="" />
      </RouteSeed>
    </AdminSpaShell>
  );
};

export default RolesRoute;
