import {AdminRpcSeed, AdminScreenRouter, useAdminConfig} from "@terreno/admin-frontend";
import {useLoaderData, useLocalSearchParams} from "expo-router";
import type {LoaderFunction} from "expo-server";
import React, {useMemo} from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {useAppConfig} from "../../components/AppConfigGate";
import {loadSsrPayload} from "../../server/loadSsrPayload";
import {resolveModelListUrl} from "../../server/modelRoutes";
import {getAdminSpaRequest} from "../../src/serverContext";

interface ModelListLoaderData {
  /** List bodies keyed by `adminRpcSeedKey`, for `AdminRpcSeed`. */
  rpc: Record<string, unknown>;
}

/**
 * Server loader: the model's first list page, fetched with the visitor's session so the table
 * renders its rows in the first HTML. Screens that are not a model list (scripts, migrations,
 * an unknown name) load nothing and fetch on the client as before.
 */
export const loader: LoaderFunction<ModelListLoaderData> = async (
  request,
  params
): Promise<ModelListLoaderData> => {
  const modelName = typeof params.model === "string" ? params.model : "";
  const url = resolveModelListUrl(getAdminSpaRequest()?.adminConfig, modelName);
  if (!request || !url) {
    return {rpc: {}};
  }
  // expo-server hands loaders a read-only Request; loadSsrPayload only reads its headers.
  const {rpc} = await loadSsrPayload(request as unknown as Request, {requests: [{url}]});
  return {rpc};
};

const ModelTableScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {config} = useAdminConfig(apiBase);
  const rpc = useLoaderData<typeof loader>()?.rpc;
  const seed = useMemo((): Record<string, unknown> => rpc ?? {}, [rpc]);

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
      <AdminRpcSeed data={seed}>
        <AdminScreenRouter apiBase={apiBase} name={model} routeBase="" />
      </AdminRpcSeed>
    </AdminSpaShell>
  );
};

export default ModelTableScreen;
