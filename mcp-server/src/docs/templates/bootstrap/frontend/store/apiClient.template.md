/**
 * Request client for every non-synced backend route (`/auth/me`, modelRouter actions, admin).
 * Synced collections go through `syncDb` instead. Generated hooks in `store/apiSdk.ts` use the
 * client that `ApiClientProvider` (in `app/_layout.tsx`) puts in context.
 */
import {type ApiClient, createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {authProvider} from "@/store/syncdb";

/** Failures callers already handle (signed out, missing rows) are not worth a warning. */
const QUIET_STATUSES = new Set([401, 404]);

export const apiClient: ApiClient = createApiClient({
  authProvider,
  baseUrl,
  credentials: "include",
  headers: appHeaders,
  onError: (error, args): void => {
    if (QUIET_STATUSES.has(error.status)) {
      return;
    }
    console.warn(`${args.method ?? "GET"} ${args.url} failed: ${error.message}`);
  },
});

/** Bearer header for `@terreno/admin-frontend`'s `AdminProvider` fetch client. */
export const getAdminAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await authProvider.getToken();
  if (!token) {
    return {};
  }
  return {Authorization: `Bearer ${token}`};
};
