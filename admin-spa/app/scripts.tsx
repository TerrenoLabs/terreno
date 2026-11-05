import {AdminScriptList} from "@terreno/admin-frontend";
import React from "react";
import {useAppConfig} from "../components/AppConfigGate";
import {RouteSeed} from "../components/RouteSeed";
import {createRpcRouteLoader} from "../server/rpcRoutes";

/** Server loader: the screen's reads, fetched so its data is in the first HTML. */
export const loader = createRpcRouteLoader("/scripts");

const ScriptsRoute: React.FC = () => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";

  return (
    <RouteSeed>
      <AdminScriptList apiBase={apiBase} isAdmin routeBase="" />
    </RouteSeed>
  );
};

export default ScriptsRoute;
