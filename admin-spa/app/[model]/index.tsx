import {AdminScreenRouter, useAdminConfig} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React, {useMemo} from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {useAppConfig} from "../../components/AppConfigGate";

const ModelTableScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {config} = useAdminConfig(apiBase);

  const breadcrumbs = useMemo(() => {
    const trail: {href?: string; label: string}[] = [{href: "/", label: "Admin"}];
    if (model === "__scripts") {
      trail.push({label: "Scripts"});
      return trail;
    }
    if (model === "__migrations") {
      trail.push({label: "Migrations"});
      return trail;
    }
    if (model === "version-config") {
      trail.push({label: "Version configuration"});
      return trail;
    }
    const meta = config?.models?.find((m) => m.name === model);
    trail.push({label: meta?.displayName ?? model ?? "Model"});
    return trail;
  }, [config?.models, model]);

  return (
    <AdminSpaShell breadcrumbs={breadcrumbs}>
      <AdminScreenRouter apiBase={apiBase} name={model} routeBase="" />
    </AdminSpaShell>
  );
};

export default ModelTableScreen;
