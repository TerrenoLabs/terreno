import {AdminModelForm, useAdminConfig} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import React, {useMemo} from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {useAppConfig} from "../../components/AppConfigGate";

const ModelCreateScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {config} = useAdminConfig(apiBase);

  const breadcrumbs = useMemo(() => {
    const trail: {href?: string; label: string}[] = [{href: "/", label: "Admin"}];
    const meta = config?.models.find((m) => m.name === model);
    const listLabel = meta?.displayName ?? model ?? "Model";
    trail.push({href: `/${model}`, label: listLabel});
    trail.push({label: "Create"});
    return trail;
  }, [config?.models, model]);

  return (
    <AdminSpaShell breadcrumbs={breadcrumbs}>
      <AdminModelForm apiBase={apiBase} mode="create" modelName={model} routeBase="" />
    </AdminSpaShell>
  );
};

export default ModelCreateScreen;
