import React from "react";
import {AdminMigrationsView} from "./AdminMigrationsView";
import {AdminScreenPage} from "./AdminScreenPage";
import type {AdminScreenProps} from "./types";
import {resolveAdminBases} from "./types";
import {useAdminConfig} from "./useAdminConfig";

export const AdminMigrations: React.FC<AdminScreenProps> = ({apiBase, baseUrl, routeBase}) => {
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const {config, error: configError, isLoading: isConfigLoading} = useAdminConfig(resolvedApiBase);

  const view = (
    <AdminMigrationsView
      apiBase={resolvedApiBase}
      config={config}
      configError={configError}
      isConfigLoading={isConfigLoading}
    />
  );

  if (isConfigLoading || configError || !config) {
    return view;
  }

  return (
    <AdminScreenPage
      backHref={resolvedRouteBase}
      color="transparent"
      maxWidth="100%"
      padding={4}
      title="Migrations"
    >
      {view}
    </AdminScreenPage>
  );
};
