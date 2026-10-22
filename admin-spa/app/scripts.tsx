import {AdminScriptList} from "@terreno/admin-frontend";
import React from "react";
import {useAppConfig} from "../components/AppConfigGate";

const ScriptsRoute: React.FC = () => {
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";

  return <AdminScriptList apiBase={apiBase} isAdmin routeBase="" />;
};

export default ScriptsRoute;
