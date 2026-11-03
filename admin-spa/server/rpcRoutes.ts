import {type AdminConfigResponse, homeWidgetUrls} from "@terreno/admin-frontend";
import {logger} from "@terreno/api";
import type {LoaderFunction} from "expo-server";
import {getAdminSpaRequest} from "../src/serverContext";
import {loadSsrPayload} from "./loadSsrPayload";

/** Admin SPA routes whose screens read their data through `useAdminRpcQuery`. */
export type AdminSpaRpcRoute = "/" | "/configuration" | "/roles" | "/scripts" | "/version-config";

/** Script runs the scripts screen lists per page (`useAdminScripts` history page). */
const SCRIPT_RUNS_PAGE_SIZE = 25;

/** RBAC routes mount at the API root, not under the admin base (`useAdminRoles`). */
const rbacBaseOf = (apiBase: string): string => apiBase.replace(/\/admin\/?$/, "");

/**
 * @public Also the test seam that pins these URLs against the screens' hooks.
 *
 * The URLs a route's screen requests on mount, for its loader to fetch and seed. They mirror the
 * screens' hooks (`useConfigurationApi`, `useAdminRoles`, `useAdminScripts`,
 * `AdminVersionConfig`, the home widgets); admin-frontend's route seed tests render each screen
 * under a seed built from these and fail if any URL differs from the hook's request.
 */
export const rpcUrlsForRoute = (
  route: AdminSpaRpcRoute,
  {adminConfig, apiBase}: {adminConfig: AdminConfigResponse; apiBase: string}
): string[] => {
  switch (route) {
    case "/":
      return homeWidgetUrls({adminConfig, apiBase});
    case "/configuration":
      return ["/configuration/meta", "/configuration"];
    case "/roles": {
      const rbacBase = rbacBaseOf(apiBase);
      return [`${rbacBase}/rbac/roles`, `${rbacBase}/rbac/statements`];
    }
    case "/scripts":
      return [`${apiBase}/scripts/runs?page=1&limit=${SCRIPT_RUNS_PAGE_SIZE}`];
    case "/version-config":
      return [`${apiBase}/version-config`];
    default:
      return [];
  }
};

/** What an RPC route's loader returns: bodies keyed by `adminRpcSeedKey`, for `AdminRpcSeed`. */
export interface RpcRouteLoaderData {
  rpc: Record<string, unknown>;
}

/**
 * The loader for an RPC route: fetches `rpcUrlsForRoute(route)` with the visitor's session, so
 * the screen renders its data in the first HTML. A read that fails is left out, and the screen
 * loads it on the client as before.
 */
export const createRpcRouteLoader = (
  route: AdminSpaRpcRoute
): LoaderFunction<RpcRouteLoaderData> => {
  return async (request): Promise<RpcRouteLoaderData> => {
    const scope = getAdminSpaRequest();
    const apiBase = scope?.appConfig.adminApiBasePath ?? "/admin";
    const adminConfig = scope?.adminConfig as AdminConfigResponse | null | undefined;
    if (!request || (route === "/" && !adminConfig)) {
      return {rpc: {}};
    }
    const urls = rpcUrlsForRoute(route, {
      adminConfig: adminConfig ?? ({models: []} as unknown as AdminConfigResponse),
      apiBase,
    });
    if (urls.length === 0) {
      return {rpc: {}};
    }
    try {
      // expo-server hands loaders a read-only Request; loadSsrPayload only reads its headers.
      const {rpc} = await loadSsrPayload(request as unknown as Request, {
        requests: urls.map((url) => ({url})),
      });
      return {rpc};
    } catch (error) {
      // A URL outside the SSR allowlist (an `ssrApiPrefixes` override) or a failed read: the
      // screen renders without a seed and loads its data on the client, as it did before SSR.
      logger.warn(`Admin SPA ${route} rendered without its data`, {
        reason: error instanceof Error ? error.message : String(error),
      });
      return {rpc: {}};
    }
  };
};
