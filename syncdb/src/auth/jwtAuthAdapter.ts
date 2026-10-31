/**
 * Legacy `@terreno/api` JWT auth for frontends, without Redux. Ported from the pre-58 rtk package's
 * `generateAuthSlice` + `emptyApi` base query.
 *
 * One `jwtAuthAdapter` object is both:
 * - an {@link AuthProvider} for `createSyncDb` / `createApiClient` (`getToken` refreshes the
 *   access token when it is under two minutes from expiry; `refresh` runs on a 401), and
 * - a {@link SessionSource} for `SessionProvider` / `createSessionStore`.
 *
 * Concurrent refreshes share one `/auth/refresh_token` call. A refresh the server rejects
 * signs the user out; a network failure keeps the session and the current token.
 */
import {API_ERROR_CODES, ApiError} from "../api/apiError";
import {type FetchLike, resolveApiUrl, unwrapEnvelope} from "../api/apiFetch";
import type {AuthProvider} from "../types";
import type {SessionChangeListener, SessionSnapshot, SessionSource} from "./session";
import {
  AUTH_TOKEN_KEY,
  decodeJwtClaims,
  getDefaultJwtTokenStorage,
  type JwtTokenStorage,
  type JwtTokens,
  REFRESH_TOKEN_KEY,
  readJwtTokens,
  tokenExpirationTimesFor,
} from "./tokenExpiry";

/** Refresh the access token when it has fewer seconds than this left (about two minutes). */
export const DEFAULT_REFRESH_BEFORE_EXPIRY_SECS = 130;

/** Default timeout for auth requests. */
export const DEFAULT_JWT_AUTH_TIMEOUT_MS = 30_000;

/** Auth routes, relative to `baseUrl`. Defaults match `@terreno/api`. */
export interface JwtAuthPaths {
  login: string;
  signup: string;
  refreshToken: string;
  googleLogin: string;
  resetPassword: string;
}

export const DEFAULT_JWT_AUTH_PATHS: JwtAuthPaths = {
  googleLogin: "/auth/google",
  login: "/auth/login",
  refreshToken: "/auth/refresh_token",
  resetPassword: "/resetPassword",
  signup: "/auth/signup",
};

/** The user a JWT session reports: the `id` claim the API signs into every token. */
export interface JwtSessionUser {
  id: string;
}

export type EmailLoginRequest =
  | {email: string; username?: never; password: string}
  | {username: string; email?: never; password: string};

export interface EmailSignupRequest {
  email: string;
  password: string;
  /** Extra fields the API's signup strategy stores on the user. */
  [key: string]: unknown;
}

export interface GoogleLoginRequest {
  idToken: string;
}

export interface ResetPasswordRequest {
  /** One-time token from the emailed reset link. */
  token?: string;
  password?: string;
  newPassword?: string;
  [key: string]: unknown;
}

/** What `/auth/login`, `/auth/signup`, `/auth/google`, and `/resetPassword` return in `data`. */
export interface JwtAuthResponse {
  token: string;
  refreshToken: string;
  userId: string;
}

/** Result of a refresh attempt. */
type RefreshOutcome = "refreshed" | "transient" | "failed";

export interface JwtAuthAdapterOptions {
  /** API origin, e.g. `baseUrl` from `@terreno/syncdb/config`. */
  baseUrl: string;
  /** Token storage (default: SecureStore on native, AsyncStorage on web). */
  storage?: JwtTokenStorage;
  /** Override individual auth routes. */
  paths?: Partial<JwtAuthPaths>;
  /** Extra headers on auth requests (e.g. `appHeaders` from `@terreno/syncdb/config`). */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Refresh when the access token has fewer seconds left (default 130). */
  refreshBeforeExpirySecs?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface JwtAuthAdapter
  extends Required<AuthProvider>,
    Required<Omit<SessionSource<JwtSessionUser>, "mayHoldSession">> {
  /** `POST /auth/login`; stores the tokens and signs the session in. */
  login: (body: EmailLoginRequest) => Promise<JwtAuthResponse>;
  /** `POST /auth/signup`; stores the tokens and signs the session in. */
  signup: (body: EmailSignupRequest) => Promise<JwtAuthResponse>;
  /** `POST /auth/google` with a Google ID token; stores the tokens and signs the session in. */
  googleLogin: (body: GoogleLoginRequest) => Promise<JwtAuthResponse>;
  /**
   * `POST /resetPassword`. Returns the API response without signing in (rtk behaviour); call
   * `login` afterwards, or `setTokens` with the returned pair to sign straight in.
   */
  resetPassword: (body: ResetPasswordRequest) => Promise<JwtAuthResponse>;
  /** Store a token pair (e.g. from a custom auth route) and sign the session in. */
  setTokens: (tokens: {token: string; refreshToken?: string | null}) => Promise<string | null>;
  /** Clear stored tokens and notify listeners. JWTs are stateless, so no server call is made. */
  logout: () => Promise<void>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Read the user id from a token pair: the access token's `id` claim, else the refresh token's. */
const userIdFromTokens = (tokens: JwtTokens): string | null => {
  const id = decodeJwtClaims(tokens.token)?.id ?? decodeJwtClaims(tokens.refreshToken)?.id;
  return typeof id === "string" && id ? id : null;
};

const isBothExpired = (tokens: JwtTokens): boolean => {
  const {authRemainingSecs, refreshRemainingSecs} = tokenExpirationTimesFor({tokens});
  return (
    authRemainingSecs !== undefined &&
    authRemainingSecs < 0 &&
    refreshRemainingSecs !== undefined &&
    refreshRemainingSecs < 0
  );
};

/** Build a JSON:API-style {@link ApiError} from an auth error body (`{message}` or `{title}`). */
const toApiError = (response: Response, body: unknown): ApiError => {
  const payload = (body && typeof body === "object" ? body : {}) as {
    code?: unknown;
    detail?: unknown;
    message?: unknown;
    title?: unknown;
  };
  const title =
    (typeof payload.title === "string" && payload.title) ||
    (typeof payload.message === "string" && payload.message) ||
    response.statusText.trim() ||
    `Request failed (${response.status})`;
  return new ApiError({
    data: {
      title,
      ...(typeof payload.detail === "string" ? {detail: payload.detail} : {}),
      ...(typeof payload.code === "string" ? {code: payload.code} : {}),
    },
    status: response.status,
  });
};

/**
 * Create the JWT auth adapter. Pass it as `authProvider` to `createSyncDb` and
 * `createApiClient`, and as `source` to `SessionProvider`.
 *
 * @example
 * ```ts
 * import {baseUrl} from "@terreno/syncdb/config";
 * import {jwtAuthAdapter} from "@terreno/syncdb/auth";
 *
 * export const jwtAuth = jwtAuthAdapter({baseUrl});
 * export const apiClient = createApiClient({authProvider: jwtAuth, baseUrl});
 * // <SessionProvider source={jwtAuth} syncDbs={[syncDb]}>
 * ```
 */
export const jwtAuthAdapter = (options: JwtAuthAdapterOptions): JwtAuthAdapter => {
  const storage = options.storage ?? getDefaultJwtTokenStorage();
  const paths = {...DEFAULT_JWT_AUTH_PATHS, ...options.paths};
  const refreshBeforeExpirySecs =
    options.refreshBeforeExpirySecs ?? DEFAULT_REFRESH_BEFORE_EXPIRY_SECS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_JWT_AUTH_TIMEOUT_MS;
  const fetcher: FetchLike =
    options.fetchImpl ?? ((input, init): Promise<Response> => globalThis.fetch(input, init));

  const authListeners = new Set<() => void>();
  const sessionListeners = new Set<SessionChangeListener<JwtSessionUser>>();
  let refreshing: Promise<RefreshOutcome> | undefined;

  const snapshotFor = (userId: string | null): SessionSnapshot<JwtSessionUser> | null =>
    userId ? {user: {id: userId}, userId} : null;

  const notify = (userId: string | null): void => {
    const snapshot = snapshotFor(userId);
    for (const listener of [...sessionListeners]) {
      listener(snapshot);
    }
    for (const listener of [...authListeners]) {
      listener();
    }
  };

  const postJson = async (path: string, body: unknown): Promise<unknown> => {
    const extra = typeof options.headers === "function" ? await options.headers() : options.headers;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let response: Response;
    try {
      response = await fetcher(resolveApiUrl({baseUrl: options.baseUrl, url: path}), {
        body: JSON.stringify(body),
        headers: {Accept: "application/json", "Content-Type": "application/json", ...extra},
        method: "POST",
        signal: controller.signal,
      });
    } catch (error) {
      throw new ApiError({
        cause: error,
        data: timedOut
          ? {code: API_ERROR_CODES.timeout, title: "Request timed out"}
          : {code: API_ERROR_CODES.network, title: "Network request failed"},
        status: 0,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw toApiError(response, parsed);
    }
    return unwrapEnvelope(parsed);
  };

  const clearTokens = async (): Promise<void> => {
    await Promise.all([storage.removeItem(AUTH_TOKEN_KEY), storage.removeItem(REFRESH_TOKEN_KEY)]);
  };

  /** Clear tokens and tell listeners the session ended. */
  const endSession = async (reason: string): Promise<void> => {
    console.warn(`[terreno/syncdb] Signing out: ${reason}`);
    try {
      await clearTokens();
    } catch (error) {
      console.error("[terreno/syncdb] Error clearing auth tokens:", error);
    }
    notify(null);
  };

  const storeTokens = async ({
    refreshToken,
    token,
  }: {
    token: string;
    refreshToken?: string | null;
  }): Promise<void> => {
    await storage.setItem(AUTH_TOKEN_KEY, token);
    await storage.setItem(REFRESH_TOKEN_KEY, refreshToken ?? "");
  };

  const setTokens = async (tokens: {
    token: string;
    refreshToken?: string | null;
  }): Promise<string | null> => {
    await storeTokens(tokens);
    const userId = userIdFromTokens({
      refreshToken: tokens.refreshToken ?? null,
      token: tokens.token,
    });
    notify(userId);
    return userId;
  };

  /** POST credentials, store the returned tokens, and sign the session in. */
  const signIn = async (path: string, body: unknown): Promise<JwtAuthResponse> => {
    const data = (await postJson(path, body)) as Partial<JwtAuthResponse> | null;
    if (!data?.token) {
      throw new Error("Auth response did not include a token");
    }
    await storeTokens({refreshToken: data.refreshToken, token: data.token});
    const userId =
      (typeof data.userId === "string" && data.userId) ||
      userIdFromTokens({refreshToken: data.refreshToken ?? null, token: data.token});
    notify(userId);
    return {refreshToken: data.refreshToken ?? "", token: data.token, userId: userId ?? ""};
  };

  const runRefresh = async (): Promise<RefreshOutcome> => {
    const {refreshToken} = await readJwtTokens(storage);
    if (!refreshToken) {
      await endSession("no refresh token found");
      return "failed";
    }
    let data: Partial<JwtAuthResponse> | null;
    try {
      data = (await postJson(paths.refreshToken, {refreshToken})) as Partial<JwtAuthResponse>;
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Offline or timed out: keep the session; the next request tries again.
        console.warn(`[terreno/syncdb] Network error refreshing token: ${error.message}`);
        return "transient";
      }
      await endSession(`token refresh failed: ${errorMessage(error)}`);
      return "failed";
    }
    if (!data?.token || !data.refreshToken) {
      await endSession("refresh token response did not include tokens");
      return "failed";
    }
    await storeTokens({refreshToken: data.refreshToken, token: data.token});
    notify(userIdFromTokens({refreshToken: data.refreshToken, token: data.token}));
    return "refreshed";
  };

  /** Concurrent callers share one refresh request. */
  const refreshOnce = (): Promise<RefreshOutcome> => {
    refreshing ??= runRefresh()
      .catch(async (error: unknown): Promise<RefreshOutcome> => {
        // Storage failures while saving new tokens leave the session unusable.
        await endSession(`token refresh failed: ${errorMessage(error)}`);
        return "failed";
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };

  const refresh = async (): Promise<boolean> => (await refreshOnce()) === "refreshed";

  const getToken = async (): Promise<string | null> => {
    // A request that starts mid-refresh waits for it (resolves at once when none is running).
    await refreshing;
    const tokens = await readJwtTokens(storage);
    if (!tokens.token) {
      return null;
    }
    if (isBothExpired(tokens)) {
      await endSession("auth and refresh tokens are expired");
      return null;
    }
    const {authRemainingSecs} = tokenExpirationTimesFor({tokens});
    if (authRemainingSecs === undefined || authRemainingSecs >= refreshBeforeExpirySecs) {
      return tokens.token;
    }
    const outcome = await refreshOnce();
    if (outcome === "failed") {
      return null;
    }
    return (await readJwtTokens(storage)).token;
  };

  const getUserId = async (): Promise<string | null> => {
    try {
      const tokens = await readJwtTokens(storage);
      if (!tokens.token || isBothExpired(tokens)) {
        return null;
      }
      return userIdFromTokens(tokens);
    } catch (error) {
      console.warn("[terreno/syncdb] Could not read auth tokens:", error);
      return null;
    }
  };

  const getSession = async (): Promise<SessionSnapshot<JwtSessionUser> | null> => {
    const tokens = await readJwtTokens(storage);
    if (!tokens.token) {
      return null;
    }
    if (isBothExpired(tokens)) {
      await endSession("auth and refresh tokens are expired");
      return null;
    }
    return snapshotFor(userIdFromTokens(tokens));
  };

  const onAuthChange = (callback: () => void): (() => void) => {
    authListeners.add(callback);
    return (): void => {
      authListeners.delete(callback);
    };
  };

  const subscribe = (listener: SessionChangeListener<JwtSessionUser>): (() => void) => {
    sessionListeners.add(listener);
    return (): void => {
      sessionListeners.delete(listener);
    };
  };

  const logout = async (): Promise<void> => {
    await clearTokens();
    console.debug("[terreno/syncdb] Cleared auth tokens as part of logout");
    notify(null);
  };

  return {
    getSession,
    getToken,
    getUserId,
    googleLogin: (body) => signIn(paths.googleLogin, body),
    login: ({email, password, username}) => signIn(paths.login, {email, password, username}),
    logout,
    onAuthChange,
    refresh,
    resetPassword: async (body) => (await postJson(paths.resetPassword, body)) as JwtAuthResponse,
    setTokens,
    signOut: logout,
    signup: (body) => signIn(paths.signup, body),
    subscribe,
  };
};
