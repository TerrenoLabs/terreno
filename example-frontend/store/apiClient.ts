/**
 * Request client for every non-synced backend route (`/auth/me`, actions, AI, …).
 * Synced collections go through `syncDb` instead.
 */
import {type ApiClient, createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {isWebBearerAuth} from "@/lib/betterAuth";
import {reportApiError} from "@/store/errors";
import {authProvider} from "@/store/syncdb";

export const apiClient: ApiClient = createApiClient({
  authProvider,
  baseUrl,
  // Bearer mode sends the token in `Authorization` and no cookies: a cross-site API answers
  // CORS with `*`, which browsers refuse for a credentialed request.
  credentials: isWebBearerAuth ? "omit" : "include",
  headers: appHeaders,
  onError: reportApiError,
});
