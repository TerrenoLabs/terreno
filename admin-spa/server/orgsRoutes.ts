import {adminOrganizationHeaders, unwrapAdminEnvelope} from "@terreno/admin-frontend";
import type {LoaderFunction} from "expo-server";
import {isOrganizationOperatorProfile} from "../components/adminSpaProfile";
import {getAdminSpaRequest, warnAdminSpaServer} from "../src/serverContext";
import {loadSsrPayload, type SsrPayloadRequest} from "./loadSsrPayload";
import {decodeRouteParam, isSinglePathSegment} from "./modelRoutes";

/** Organization routes whose screens read through `useOrganizationsApi`. */
export type OrgsSsrRoute = "/orgs" | "/orgs/[orgId]" | "/orgs/[orgId]/members";

/**
 * @public Also the test seam that pins these requests against the orgs screens' hooks.
 *
 * The requests the orgs screens make on mount: the directory (`GET /orgs`, operators only, as
 * `OrgDirectoryScreen` skips it otherwise), one organization, or its members. Org-scoped reads
 * carry the hooks' `X-Organization-Id`, which is part of the seed key. The id is used decoded,
 * as the hooks use it. Member security loads only when opened, so it is not seeded.
 */
export const orgsSsrRequests = (
  route: OrgsSsrRoute,
  {isOperator, orgId}: {isOperator: boolean; orgId?: string}
): SsrPayloadRequest[] => {
  if (route === "/orgs") {
    return isOperator ? [{url: "/orgs"}] : [];
  }
  // An id that is not one plain path segment seeds nothing (the screen loads on the client).
  if (!isSinglePathSegment(orgId)) {
    return [];
  }
  const headers = adminOrganizationHeaders(orgId) as Record<string, string>;
  const url = route === "/orgs/[orgId]" ? `/orgs/${orgId}` : `/orgs/${orgId}/members`;
  return [{headers, url}];
};

/** What an orgs loader returns: bodies keyed by `adminRpcSeedKey`, for `AdminRpcSeed`. */
export interface OrgsLoaderData {
  rpc: Record<string, unknown>;
}

/**
 * The loader for an orgs route. Whether the visitor operates the directory comes from the
 * profile the gate read (`/auth/me`, possibly in a `{data}` envelope). A read that fails, or a
 * URL outside the SSR allowlist, is left out and loads on the client.
 */
export const createOrgsLoader = (route: OrgsSsrRoute): LoaderFunction<OrgsLoaderData> => {
  return async (request, params): Promise<OrgsLoaderData> => {
    const profile = unwrapAdminEnvelope(getAdminSpaRequest()?.profile ?? null);
    const isOperator = isOrganizationOperatorProfile(
      (profile ?? undefined) as Parameters<typeof isOrganizationOperatorProfile>[0]
    );
    const requests = orgsSsrRequests(route, {isOperator, orgId: decodeRouteParam(params.orgId)});
    if (!request || requests.length === 0) {
      return {rpc: {}};
    }
    try {
      // expo-server hands loaders a read-only Request; loadSsrPayload only reads its headers.
      const {rpc} = await loadSsrPayload(request as unknown as Request, {requests});
      return {rpc};
    } catch (error) {
      warnAdminSpaServer(`Admin SPA ${route} rendered without its data`, {
        reason: error instanceof Error ? error.message : String(error),
      });
      return {rpc: {}};
    }
  };
};
