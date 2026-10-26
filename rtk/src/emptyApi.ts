// This file is the basis for openApiSdk.ts. See openapi-config.ts for configuration that is
// combined with this to generate the SDK.
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type BaseQueryApi,
  createApi,
  type FetchArgs,
  fetchBaseQuery,
  retry,
} from "@reduxjs/toolkit/query/react";
import type {AuthProvider} from "@terreno/syncdb";
import {Mutex} from "async-mutex";
import axios from "axios";
import axiosRetry from "axios-retry";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {jwtDecode} from "jwt-decode";
import {DateTime} from "luxon";
import qs from "qs";
import {emitAuthChange, onAuthChange} from "./authEvents";
import {generateProfileEndpoints, getAuthToken} from "./authSlice";
import {AUTH_DEBUG, baseUrl, LOGOUT_ACTION_TYPE, TOKEN_REFRESHED_SUCCESS} from "./constants";
import {shouldDeferOfflineMutation} from "./offlineGate";
import {IsWeb} from "./platform";
import {getTokenSource} from "./tokenSource";

const log = AUTH_DEBUG ? (s: string): void => console.debug(`[auth] ${s}`) : (): void => {};

/** Response from Terreno `GET /version-check` (VersionCheckPlugin). */
export interface VersionCheckResponse {
  message?: string;
  /** How often the client should poll for updates, in milliseconds. */
  pollingIntervalMs?: number;
  requiredVersion?: number;
  status: "ok" | "warning" | "required";
  updateUrl?: string;
  warningVersion?: number;
}

axiosRetry(axios, {retries: 3, retryDelay: axiosRetry.exponentialDelay});

const mutex = new Mutex();

interface TokenPayload {
  exp: number;
}

export const getTokenExpirationTimes = async (): Promise<{
  refreshRemainingSecs?: number;
  authRemainingSecs?: number;
}> => {
  let refreshToken: string | null;
  let authToken: string | null;
  if (!IsWeb) {
    refreshToken = await SecureStore.getItemAsync("REFRESH_TOKEN");
    authToken = await SecureStore.getItemAsync("AUTH_TOKEN");
  } else {
    // Check if we're in a browser environment (not SSR)
    if (typeof window !== "undefined") {
      refreshToken = await AsyncStorage.getItem("REFRESH_TOKEN");
      authToken = await AsyncStorage.getItem("AUTH_TOKEN");
    } else {
      refreshToken = null;
      authToken = null;
    }
  }

  if (!refreshToken || !authToken) {
    return {authRemainingSecs: undefined, refreshRemainingSecs: undefined};
  }

  const now = DateTime.now().setZone("UTC");
  const refreshDecoded = jwtDecode<TokenPayload>(refreshToken);
  const authDecoded = jwtDecode<TokenPayload>(authToken);

  const refreshExpiration = DateTime.fromSeconds(refreshDecoded.exp).setZone("UTC");
  const authExpiration = DateTime.fromSeconds(authDecoded.exp).setZone("UTC");

  const refreshTimeRemaining = Math.floor(refreshExpiration.diff(now, "seconds").seconds);
  const authTimeRemaining = Math.floor(authExpiration.diff(now, "seconds").seconds);

  if (AUTH_DEBUG) {
    log(`Refresh expires in ${refreshTimeRemaining}s, Auth expires in ${authTimeRemaining}s`);
  }

  return {authRemainingSecs: authTimeRemaining, refreshRemainingSecs: refreshTimeRemaining};
};

// Helper function to decode token and get expiration info
export const getFriendlyExpirationInfo = async (): Promise<string> => {
  const {authRemainingSecs, refreshRemainingSecs} = await getTokenExpirationTimes();

  if (authRemainingSecs === undefined && refreshRemainingSecs === undefined) {
    return "No tokens available";
  }

  const messages: string[] = [];
  if (authRemainingSecs !== undefined) {
    if (authRemainingSecs <= 0) {
      messages.push(`Auth token expired ${Math.abs(authRemainingSecs)} seconds ago`);
    } else {
      messages.push(`Auth token expires in ${authRemainingSecs} seconds`);
    }
  }

  if (refreshRemainingSecs !== undefined) {
    if (refreshRemainingSecs <= 0) {
      messages.push(`Refresh token expired ${Math.abs(refreshRemainingSecs)} seconds ago`);
    } else {
      messages.push(`Refresh token expires in ${refreshRemainingSecs} seconds`);
    }
  }

  return messages.join(", ");
};

// Give an extra 5 seconds to make sure if they hit the modal with 1 minute left,
// they have time to click the button
export const shouldShowStillThereModal = async (): Promise<boolean> => {
  const {refreshRemainingSecs} = await getTokenExpirationTimes();
  if (refreshRemainingSecs === undefined) {
    return false;
  }
  return refreshRemainingSecs <= 65;
};

export const refreshAuthToken = async (): Promise<void> => {
  let refreshToken: string | null;
  if (!IsWeb) {
    refreshToken = await SecureStore.getItemAsync("REFRESH_TOKEN");
  } else {
    // Check if we're in a browser environment (not SSR)
    if (typeof window !== "undefined") {
      refreshToken = await AsyncStorage.getItem("REFRESH_TOKEN");
    } else {
      refreshToken = null;
    }
  }
  console.debug("Refreshing token, current token");
  if (refreshToken) {
    const refreshResult = await axios.post(`${baseUrl}/auth/refresh_token`, {
      refreshToken,
    });
    console.debug("Refresh token result");
    if (refreshResult?.data?.data) {
      const data = refreshResult.data.data;
      if (!data.token || !data.refreshToken) {
        console.warn("refresh token API request didn't return data");
        throw new Error("refresh token API request didn't return data");
      }
      if (!IsWeb) {
        await SecureStore.setItemAsync("AUTH_TOKEN", data.token);
        await SecureStore.setItemAsync("REFRESH_TOKEN", data.refreshToken);
      } else {
        // Check if we're in a browser environment (not SSR)
        if (typeof window !== "undefined") {
          await AsyncStorage.setItem("AUTH_TOKEN", data.token);
          await AsyncStorage.setItem("REFRESH_TOKEN", data.refreshToken);
        }
      }
      axios.defaults.headers.common.Authorization = `Bearer ${data.token}`;
      console.debug("New token stored");
      emitAuthChange();
    } else {
      console.warn("refresh token API request failed or didn't return data");
      throw new Error("refresh token API request failed or didn't return data");
    }
  } else {
    console.warn("no refresh token found");
    throw new Error("no refresh token found");
  }
};

interface JwtIdentityPayload {
  id?: string;
  sub?: string;
}

/**
 * The legacy JWT token source: the tokens `generateAuthSlice` stores. rtk uses this behavior
 * until an app calls `setTokenSource`; registering it explicitly changes nothing.
 */
export const jwtTokenSource: AuthProvider = {
  getToken: (): Promise<string | null> => getAuthToken(),
  getUserId: async (): Promise<string | null> => {
    const token = await getAuthToken();
    if (!token) {
      return null;
    }
    try {
      const payload = jwtDecode<JwtIdentityPayload>(token);
      return payload.id ?? payload.sub ?? null;
    } catch {
      return null;
    }
  },
  onAuthChange,
  refresh: async (): Promise<boolean> => {
    try {
      // Share the base query's mutex so a caller such as syncdb never races its refresh.
      await mutex.runExclusive(refreshAuthToken);
      return true;
    } catch (error: unknown) {
      log(`JWT token source refresh failed: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  },
};

/** True when rtk should run the legacy JWT path: no source registered, or the JWT one. */
export const isJwtTokenSource = (source: AuthProvider | undefined): boolean => {
  return !source || source === jwtTokenSource;
};

interface BaseQueryOptions {
  /** Send no `authorization` header when the token is null (instead of `Bearer null`). */
  omitAuthorizationWhenMissing?: boolean;
}

export const getBaseQuery = (
  args: string | FetchArgs,
  api: BaseQueryApi,
  extraOptions: unknown,
  token: string | null,
  {omitAuthorizationWhenMissing = false}: BaseQueryOptions = {}
) => {
  const version = Constants.expoConfig?.version ?? "Unknown";

  return fetchBaseQuery({
    baseUrl: `${baseUrl}`,
    // We need to use qs.stringify here because fetchBaseQuery uses the qs library which doesn't
    // support nested objects, such as our $in, $lt/$gte, etc queries.
    paramsSerializer: (params) => {
      return qs.stringify(params);
    },
    prepareHeaders: async (headers) => {
      if (token || !omitAuthorizationWhenMissing) {
        headers.set("authorization", `Bearer ${token}`);
      }
      // Send version in case the API needs to respond differently based on version.
      headers.set("App-Version", version);
      headers.set("App-Platform", IsWeb ? "web" : "mobile");
      return headers;
    },
    // We need to slightly change the format of the data coming from the API to match the format
    // that the SDK generates.
    responseHandler: async (response) => {
      if (response.status === 204) {
        return null;
      }
      const result = await response.json();
      if ("more" in result) {
        // For list responses, return the whole result
        return result;
      } else if (result.data) {
        // For read, update, and create responses, return the data. We used to use a transformer,
        // but
        return result.data;
      } else {
        return result;
      }
    },
  })(args, api, extraOptions as Parameters<ReturnType<typeof fetchBaseQuery>>[2]);
};

// Endpoints that never need a valid token, so the base query neither validates nor refreshes it.
const PUBLIC_ENDPOINTS = [
  "emailLogin",
  "emailSignUp",
  "getVersionCheck",
  "getZoomSignature",
  "googleLogin",
];

// One in-flight refresh shared by every request that got a 401 from the same token source.
let tokenSourceRefresh: {promise: Promise<boolean>; source: AuthProvider} | undefined;

const readSourceToken = async (source: AuthProvider): Promise<string | null> => {
  try {
    return await source.getToken();
  } catch (error: unknown) {
    console.warn(
      `[auth] Token source getToken failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
};

const refreshSourceToken = (source: AuthProvider): Promise<boolean> => {
  if (!source.refresh) {
    return Promise.resolve(false);
  }
  if (tokenSourceRefresh?.source === source) {
    return tokenSourceRefresh.promise;
  }
  // Promise.resolve().then() turns a synchronous throw from refresh into a rejection.
  const promise = Promise.resolve()
    // Called on the source so a class-based provider keeps its `this`.
    .then((): Promise<boolean> => source.refresh?.() ?? Promise.resolve(false))
    .catch((error: unknown): boolean => {
      console.warn(
        `[auth] Token source refresh failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    });
  const pending = {promise, source};
  tokenSourceRefresh = pending;
  void promise.finally((): void => {
    if (tokenSourceRefresh === pending) {
      tokenSourceRefresh = undefined;
    }
  });
  return promise;
};

/**
 * Base query for a registered, non-JWT token source (for example Better Auth). The client never
 * decides on its own that the user is logged out: a null token sends the request without auth,
 * and only a 401 that survives one refresh dispatches logout.
 */
const tokenSourceBaseQuery = async (
  args: string | FetchArgs,
  api: BaseQueryApi,
  extraOptions: unknown,
  source: AuthProvider
): Promise<Awaited<ReturnType<typeof getBaseQuery>>> => {
  const options: BaseQueryOptions = {omitAuthorizationWhenMissing: true};
  const token = await readSourceToken(source);
  let result = await getBaseQuery(args, api, extraOptions, token, options);

  if (PUBLIC_ENDPOINTS.includes(api.endpoint)) {
    return result;
  }

  if (result.error?.status === 401) {
    log(`401 from ${api.endpoint}, refreshing the token source and retrying once`);
    await refreshSourceToken(source);
    const retryToken = await readSourceToken(source);
    result = await getBaseQuery(args, api, extraOptions, retryToken, options);
    if (result.error?.status === 401) {
      console.warn(`[auth] 401 from ${api.endpoint} after a token refresh, logging out`);
      api.dispatch({type: LOGOUT_ACTION_TYPE});
      retry.fail(result.error, result.meta);
    }
  }

  if (result.error && api.type === "mutation") {
    retry.fail(result.error, result.meta);
  }
  return result;
};

export const staggeredBaseQuery = retry(
  async (args: string | FetchArgs, api, extraOptions) => {
    // Short-circuit immediately when offline for configured mutation endpoints
    if (api.type === "mutation" && shouldDeferOfflineMutation(api.endpoint, api.getState)) {
      retry.fail({error: "Network unavailable", status: "FETCH_ERROR"});
    }

    const source = getTokenSource();
    if (source && !isJwtTokenSource(source)) {
      return tokenSourceBaseQuery(args, api, extraOptions, source);
    }

    // wait until the mutex is available without locking it
    await mutex.waitForUnlock();
    let token = await getAuthToken();

    if (PUBLIC_ENDPOINTS.includes(api.endpoint)) {
      // just pass thru the request without token validation for login/signup requests
      // (even if there's a stale token in storage)
      return getBaseQuery(args, api, extraOptions, token);
    }
    if (!token) {
      console.debug(`No token found and the endpoint is ${api.endpoint}`);
      // assume the token was removed because the user logged out and dispatch logout
      api.dispatch({type: LOGOUT_ACTION_TYPE});
      return {error: {error: `No token found for ${api.endpoint}`, status: "FETCH_ERROR"}};
    }

    const {refreshRemainingSecs, authRemainingSecs} = await getTokenExpirationTimes();
    // if both auth and refresh tokens exist but are expired, log the user out
    if (
      authRemainingSecs &&
      authRemainingSecs < 0 &&
      refreshRemainingSecs &&
      refreshRemainingSecs < 0
    ) {
      console.warn(
        `[auth] Both tokens are expired, logging out: authRemainingSecs: ${authRemainingSecs}, refreshRemainingSecs: ${refreshRemainingSecs}`
      );
      api.dispatch({type: LOGOUT_ACTION_TYPE});
      return {error: {error: "Auth and refresh tokens are expired", status: "FETCH_ERROR"}};
    }

    // if the auth token is within about 2 minute of expiring, refresh it automatically
    if (authRemainingSecs && authRemainingSecs < 130) {
      if (!mutex.isLocked()) {
        const release = await mutex.acquire();
        try {
          log(`Refreshing token: authRemainingSecs: ${authRemainingSecs}`);
          await refreshAuthToken();
          token = await getAuthToken();
          log(`Token refreshed: ${token}`);
          api.dispatch({type: TOKEN_REFRESHED_SUCCESS});
        } catch (error: unknown) {
          if (axios.isAxiosError(error)) {
            // if it is a Network Error, don't auto log out and just let the next request go
            // through
            console.warn(`[auth] Network error refreshing token: ${error.code} ${error.message}`);
            if (error.code === "ERR_NETWORK") {
              return getBaseQuery(args, api, extraOptions, token);
            } else if (error.status === 401) {
              api.dispatch({type: LOGOUT_ACTION_TYPE});
              return {error: {error: "Token refresh failed with 401", status: "FETCH_ERROR"}};
            }
          }
          console.warn(
            `[auth] Error refreshing token: ${error instanceof Error ? error.message : String(error)}`
          );
          api.dispatch({type: LOGOUT_ACTION_TYPE});
          return {
            error: {
              error: `Failed to refresh token: ${error instanceof Error ? error.message : String(error)}`,
              status: "FETCH_ERROR",
            },
          };
        } finally {
          release();
        }
      }
    } else {
      // wait until the mutex is available
      log(`Waiting for mutex to get token: authRemainingSecs: ${authRemainingSecs}`);
      await mutex.waitForUnlock();
      token = await getAuthToken();
    }

    let baseQuery = getBaseQuery(args, api, extraOptions, token);
    let result = await baseQuery;

    if (result.error?.status === 401) {
      if (!mutex.isLocked()) {
        console.warn("[auth] 401 error, refreshing token and retrying, waiting for mutex");
        const release = await mutex.acquire();
        log("401 error, refreshing token and retrying, got mutex");
        try {
          await refreshAuthToken();
          token = await getAuthToken();
          log(`401 error, refreshing token and retrying, got new token: ${token}`);
          api.dispatch({type: TOKEN_REFRESHED_SUCCESS});
          baseQuery = getBaseQuery(args, api, extraOptions, token);
          // retry once with the new token before failing and logging out
          result = await baseQuery;
        } catch (error: unknown) {
          console.error(
            "Error refreshing auth token",
            error instanceof Error ? error.message : String(error)
          );
          api.dispatch({type: LOGOUT_ACTION_TYPE});
        } finally {
          release();
        }
      } else {
        // wait until the mutex is available without locking it then try again since got 401 on
        // first try
        console.warn(
          "401 error and mutex locked, refreshing token and retrying, waiting for mutex"
        );
        await mutex.waitForUnlock();
        token = await getAuthToken();
        log(`401 error and mutex locked, refreshing token and retrying, got new token: ${token}`);
        baseQuery = getBaseQuery(args, api, extraOptions, token);
        result = await baseQuery;
      }
      // if any other type of error, don't retry if it is a mutation to prevent potential duplicates
    } else if (result.error && api.type === "mutation") {
      log(`Error on mutation, not retrying, ${authRemainingSecs}`);
      retry.fail(result.error);
    }
    return result;
  },
  {
    maxRetries: 3,
  }
);

// initialize an empty api service that we'll inject endpoints into later as needed
export const emptySplitApi = createApi({
  baseQuery: staggeredBaseQuery,
  endpoints: (builder) => ({
    getVersionCheck: builder.query<VersionCheckResponse, {platform: string; version: number}>({
      query: ({platform, version}) => ({
        params: {platform, version},
        url: "/version-check",
      }),
    }),
    ...generateProfileEndpoints(
      builder as unknown as Parameters<typeof generateProfileEndpoints>[0],
      "users"
    ), // using 'users' here since it is highly intertwined with Users
  }),
  reducerPath: "terreno-rtk",
});

export const {useGetVersionCheckQuery, useLazyGetVersionCheckQuery} = emptySplitApi;
