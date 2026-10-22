import {type ApiClient, createApiClient, type FetchLike} from "@terreno/syncdb/api";
import {SessionProvider} from "@terreno/syncdb/auth";
import {ApiClientProvider} from "@terreno/syncdb/react";
import {createAuthClient} from "better-auth/react";
import React, {createContext, useContext, useMemo} from "react";
import {useAppConfig} from "./AppConfigGate";

export type AdminSpaAuthClient = ReturnType<typeof createAuthClient>;

/** @internal */
export interface AdminSpaClients {
  /** Same-origin request client for the SPA's own non-admin calls (e.g. `/auth/me`). */
  apiClient: ApiClient;
  /** Cookie-session Better Auth client (sign-in, sign-out, session reads). */
  authClient: AdminSpaAuthClient;
}

const DEFAULT_AUTH_BASE_PATH = "/api/auth";
const FALLBACK_ORIGIN = "http://localhost:4000";

const AuthClientContext = createContext<AdminSpaAuthClient | undefined>(undefined);

/** The SPA's Better Auth client. Throws outside {@link StoreProvider}. */
export const useAuthClient = (): AdminSpaAuthClient => {
  const authClient = useContext(AuthClientContext);
  if (!authClient) {
    throw new Error("useAuthClient must be used within <StoreProvider>");
  }
  return authClient;
};

/** Origin the SPA is served from; the backend serves the SPA, auth, and API on it. */
/** @internal */
export const resolveAdminSpaOrigin = (): string =>
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : FALLBACK_ORIGIN;

/**
 * Build the SPA's Better Auth client and request client. Both use the browser's
 * same-origin session cookie: the request client sends `credentials: "same-origin"` and
 * relative URLs, and the auth client is `better-auth/react`'s web client (NOT the Expo
 * factory, which stores cookies itself for native apps).
 */
/** @internal */
export const createAdminSpaClients = ({
  authBasePath,
  fetchImpl,
  origin,
}: {
  authBasePath?: string;
  fetchImpl?: FetchLike;
  origin: string;
}): AdminSpaClients => ({
  apiClient: createApiClient({credentials: "same-origin", fetchImpl}),
  authClient: createAuthClient({
    basePath: authBasePath ?? DEFAULT_AUTH_BASE_PATH,
    baseURL: origin,
    ...(fetchImpl ? {fetchOptions: {customFetchImpl: fetchImpl as typeof fetch}} : {}),
  }),
});

interface StoreProviderProps {
  children: React.ReactNode;
  /** Replace `fetch` for both clients (tests, custom transports). */
  fetchImpl?: FetchLike;
}

/**
 * Builds the Better Auth client and request client from the loaded app-config, then
 * mounts `SessionProvider` (session state for `useSession()`) and `ApiClientProvider`
 * (for `useApiQuery`). Lives below {@link AppConfigGate} because the auth client's
 * `basePath` comes from the config. Logging out drops the request client's cache so the
 * next admin never sees the previous admin's profile.
 */
export const StoreProvider: React.FC<StoreProviderProps> = ({children, fetchImpl}) => {
  const {appConfig} = useAppConfig();
  const authBasePath = appConfig.authBasePath ?? DEFAULT_AUTH_BASE_PATH;

  const {apiClient, authClient} = useMemo(
    (): AdminSpaClients =>
      createAdminSpaClients({authBasePath, fetchImpl, origin: resolveAdminSpaOrigin()}),
    [authBasePath, fetchImpl]
  );

  return (
    <AuthClientContext.Provider value={authClient}>
      <ApiClientProvider client={apiClient}>
        {/* SessionProvider reads its config once, so remount it when the clients change. */}
        <SessionProvider authClient={authClient} key={authBasePath} onLogout={apiClient.reset}>
          {children}
        </SessionProvider>
      </ApiClientProvider>
    </AuthClientContext.Provider>
  );
};
