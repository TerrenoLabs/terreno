import {
  adminRpcSeedKey,
  withDefaultCommsDashboardDates,
  withQueryString,
} from "@terreno/admin-frontend";
import type {LoaderFunction} from "expo-server";
import {loadSsrPayload} from "./loadSsrPayload";
import {decodeRouteParam} from "./modelRoutes";

/** Rows the jobs and comms dashboards list per page (`LIST_LIMIT` in each screen). */
const LIST_LIMIT = 20;

/** Jobs routes whose screens read through `useJobsDashboardApi`. */
export type JobsSsrRoute = "/jobs" | "/jobs/[id]";

/** Comms routes whose screens read through `useCommsDashboardApi`. */
export type CommsSsrRoute = "/comms" | "/comms/[id]";

/**
 * @public Also the test seam that pins these URLs against the jobs screens' hooks.
 *
 * The URLs the jobs screens request on mount. They are not under the admin API base, and the
 * detail id is used as the hook uses it (decoded, not re-encoded).
 */
export const jobsSsrUrls = (route: JobsSsrRoute, {id}: {id?: string}): string[] => {
  if (route === "/jobs/[id]") {
    return id ? [`/jobs/${id}`] : [];
  }
  return [
    withQueryString({params: {limit: LIST_LIMIT, page: 1}, url: "/jobs"}),
    "/jobs/stats",
    "/jobs/schedules",
  ];
};

/**
 * @public Also the test seam that pins these URLs against the comms screens' hooks.
 *
 * The URLs the comms screens request on mount: the list and stats over the dashboard's default
 * date range (whole-minute bounds, so the browser builds the same URL), or one message.
 */
export const commsSsrUrls = (route: CommsSsrRoute, {id}: {id?: string}): string[] => {
  if (route === "/comms/[id]") {
    return id ? [`/comms/messages/${id}`] : [];
  }
  const {endDate, startDate} = withDefaultCommsDashboardDates({});
  return [
    withQueryString({
      params: {endDate, limit: LIST_LIMIT, page: 1, startDate},
      url: "/comms/messages",
    }),
    withQueryString({params: {endDate, startDate}, url: "/comms/stats"}),
  ];
};

/** What a jobs or comms loader returns. */
export interface JobsCommsLoaderData {
  /** Bodies keyed by `adminRpcSeedKey`, for `AdminRpcSeed`. */
  rpc: Record<string, unknown>;
  /** The backend answered 404 for the requested record. */
  notFound?: boolean;
}

/**
 * The loader for a jobs or comms route: fetches its URLs with the visitor's session so the
 * screen renders its data in the first HTML. A record route whose read answers 404 reports
 * `notFound` (the page still answers 200: expo-server 58 sets other statuses only by throwing).
 * A read that fails, or a URL outside the SSR allowlist, is left out and loads on the client.
 */
export const createJobsCommsLoader = (
  route: JobsSsrRoute | CommsSsrRoute
): LoaderFunction<JobsCommsLoaderData> => {
  return async (request, params): Promise<JobsCommsLoaderData> => {
    const id = decodeRouteParam(params.id);
    const urls = route.startsWith("/jobs")
      ? jobsSsrUrls(route as JobsSsrRoute, {id})
      : commsSsrUrls(route as CommsSsrRoute, {id});
    if (!request || urls.length === 0) {
      return {rpc: {}};
    }
    try {
      // expo-server hands loaders a read-only Request; loadSsrPayload only reads its headers.
      const {rpc, status} = await loadSsrPayload(request as unknown as Request, {
        requests: urls.map((url) => ({url})),
      });
      const isRecordRoute = route.endsWith("[id]");
      if (isRecordRoute && status[adminRpcSeedKey(urls[0])] === 404) {
        return {notFound: true, rpc: {}};
      }
      return {rpc};
    } catch (error) {
      console.warn(`Admin SPA ${route} rendered without its data`, {
        reason: error instanceof Error ? error.message : String(error),
      });
      return {rpc: {}};
    }
  };
};
