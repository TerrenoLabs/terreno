import {type ApiClient, createApiClient, type FetchLike, unwrapEnvelope} from "@terreno/syncdb/api";
import {
  type BetterAuthUser,
  createSessionStore,
  SessionProvider,
  type SessionSnapshot,
  type SessionStore,
} from "@terreno/syncdb/auth";
import {ApiClientProvider} from "@terreno/syncdb/react";
import {createAuthClient} from "better-auth/react";
import React, {createContext, useContext, useMemo} from "react";
import {getAdminSpaServerContext, isAdminSpaServerRender} from "../src/serverContext";
import {useAppConfig} from "./AppConfigGate";
import {ADMIN_SPA_PROFILE_REQUEST} from "./adminSpaProfile";
import {useSsrPayload} from "./ssrPayload";

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

/**
 * Origin the SPA is served from; the backend serves the SPA, auth, and API on it. A server
 * render uses the plugin's `internalOrigin`, never a guessed `localhost`.
 */
/** @internal */
export const resolveAdminSpaOrigin = (): string => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return getAdminSpaServerContext()?.internalOrigin ?? FALLBACK_ORIGIN;
};

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
  // A server render has no page origin to resolve relative URLs against; the browser does.
  apiClient: createApiClient({
    baseUrl: isAdminSpaServerRender() ? origin : undefined,
    credentials: "same-origin",
    fetchImpl,
  }),
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
  const payload = useSsrPayload();
  const profile = payload?.profile;

  const {apiClient, authClient} = useMemo((): AdminSpaClients => {
    const clients = createAdminSpaClients({
      authBasePath,
      fetchImpl,
      origin: resolveAdminSpaOrigin(),
    });
    // The server already read `/auth/me` for this session: profile readers render from it.
    if (profile) {
      clients.apiClient.primeQuery(ADMIN_SPA_PROFILE_REQUEST, unwrapEnvelope(profile));
    }
    return clients;
  }, [authBasePath, fetchImpl, profile]);

  // The gate's snapshot has the shape Better Auth's session source returns.
  const initialSession = payload
    ? ((payload.session ?? null) as SessionSnapshot<BetterAuthUser> | null)
    : undefined;
  const sessionStore = useMemo((): SessionStore => {
    const store = createSessionStore({authClient, initialSession, onLogout: apiClient.reset});
    // A server render only reads the session it was given: no source watch, no request.
    if (isAdminSpaServerRender()) {
      return {...store, start: (): void => {}, stop: (): void => {}};
    }
    return store;
  }, [apiClient, authClient, initialSession]);

  return (
    <AuthClientContext.Provider value={authClient}>
      <ApiClientProvider client={apiClient}>
        <SessionProvider store={sessionStore}>{children}</SessionProvider>
      </ApiClientProvider>
    </AuthClientContext.Provider>
  );
};
