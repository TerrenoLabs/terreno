import {
  AdminModelForm,
  AdminRpcSeed,
  adminRpcSeedKey,
  useAdminConfig,
} from "@terreno/admin-frontend";
import {useLoaderData, useLocalSearchParams} from "expo-router";
import type {LoaderFunction} from "expo-server";
import React, {useMemo} from "react";
import {AdminSpaShell} from "../../components/AdminSpaShell";
import {useAppConfig} from "../../components/AppConfigGate";
import {RecordNotFound} from "../../components/RecordNotFound";
import {loadSsrPayload} from "../../server/loadSsrPayload";
import {decodeRouteParam, resolveModelReadUrl} from "../../server/modelRoutes";
import {getAdminSpaRequest} from "../../src/serverContext";

/** The sibling static route Expo prefers over `[id]`; never read as a document id. */
const CREATE_SEGMENT = "create";

interface ModelDetailLoaderData {
  /** Read bodies keyed by `adminRpcSeedKey`, for `AdminRpcSeed`. */
  rpc: Record<string, unknown>;
  /** The backend answered 404 for this document. */
  notFound?: boolean;
}

/**
 * Server loader: the document, fetched with the visitor's session so the edit form renders its
 * values in the first HTML. A 404 renders the not-found state with HTTP 200: expo-server 58 can
 * set another status only by throwing, which replaces the page with an error body.
 */
export const loader: LoaderFunction<ModelDetailLoaderData> = async (
  request,
  params
): Promise<ModelDetailLoaderData> => {
  const modelName = decodeRouteParam(params.model) ?? "";
  const id = decodeRouteParam(params.id) ?? "";
  if (id === CREATE_SEGMENT) {
    return {rpc: {}};
  }
  const url = resolveModelReadUrl(getAdminSpaRequest()?.adminConfig, modelName, id);
  if (!request || !url) {
    return {rpc: {}};
  }
  try {
    // expo-server hands loaders a read-only Request; loadSsrPayload only reads its headers.
    const {rpc, status} = await loadSsrPayload(request as unknown as Request, {
      requests: [{url}],
    });
    if (status[adminRpcSeedKey(url)] === 404) {
      return {notFound: true, rpc: {}};
    }
    return {rpc};
  } catch (error) {
    // A URL outside the SSR allowlist or a failed read: the form loads on the client.
    console.warn(`Admin SPA /${modelName}/[id] rendered without its data`, {
      reason: error instanceof Error ? error.message : String(error),
    });
    return {rpc: {}};
  }
};

const ModelEditScreen: React.FC = () => {
  const {model, id} = useLocalSearchParams<{model: string; id: string}>();
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {config} = useAdminConfig(apiBase);
  const loaderData = useLoaderData<typeof loader>();
  const rpc = loaderData?.rpc;
  const seed = useMemo((): Record<string, unknown> => rpc ?? {}, [rpc]);

  const breadcrumbs = useMemo(() => {
    const trail: {href?: string; label: string}[] = [{href: "/", label: "Admin"}];
    const meta = config?.models.find((m) => m.name === model);
    const listLabel = meta?.displayName ?? model ?? "Model";
    trail.push({href: `/${model}`, label: listLabel});
    trail.push({label: "Edit"});
    return trail;
  }, [config?.models, model]);

  return (
    <AdminSpaShell breadcrumbs={breadcrumbs}>
      {loaderData?.notFound ? (
        <RecordNotFound
          backHref={`/${model}`}
          message={`No ${model ?? "record"} with id "${id ?? ""}".`}
        />
      ) : (
        <AdminRpcSeed data={seed}>
          <AdminModelForm
            apiBase={apiBase}
            itemId={id}
            mode="edit"
            modelName={model}
            routeBase=""
          />
        </AdminRpcSeed>
      )}
    </AdminSpaShell>
  );
};

export default ModelEditScreen;
