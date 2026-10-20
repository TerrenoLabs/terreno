/**
 * Request client for every non-synced backend route (`/auth/me`, actions, AI, …).
 * Synced collections go through `syncDb` instead.
 */
import {type ApiClient, createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {authProvider} from "@/store/syncdb";

export const apiClient: ApiClient = createApiClient({
  authProvider,
  baseUrl,
  credentials: "include",
  headers: appHeaders,
});
