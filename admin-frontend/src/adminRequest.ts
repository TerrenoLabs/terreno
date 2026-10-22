import {API_ERROR_CODES, apiFetch, DEFAULT_API_TIMEOUT_MS, isApiError} from "@terreno/syncdb/api";

import type {AdminGetAuthHeaders} from "./types";

/** Default AbortController timeout for {@link adminRequest}. */
export const DEFAULT_ADMIN_REQUEST_TIMEOUT_MS = DEFAULT_API_TIMEOUT_MS;

export interface AdminRequestArgs {
  url: string;
  method?: string;
  body?: BodyInit | Record<string, unknown> | null;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  timeoutMs?: number;
  parseAs?: "json" | "text" | "blob";
}

/**
 * Thrown for non-2xx responses and timeouts. Shape matches `@terreno/ui` `APIError`
 * (`status` + `data.title`) so existing admin screens can display it.
 */
export class AdminAPIError extends Error {
  data: {detail?: string; title: string};
  status: number;

  constructor({
    detail,
    status,
    title,
  }: {
    detail?: string;
    status: number;
    title: string;
  }) {
    super(title);
    this.name = "AdminAPIError";
    this.data = {detail, title};
    this.status = status;
  }
}

/**
 * Native `fetch` helper for every admin request (model CRUD, config, scripts, roles, …).
 * Delegates to `@terreno/syncdb/api`'s `apiFetch` (timeout, body encoding, JSON:API
 * error parsing) and maps its errors to {@link AdminAPIError}. Hosts inject auth via
 * {@link bindAdminRequest} / `AdminProvider` `{getAuthHeaders, credentials, apiOrigin}`.
 */
export const adminRequest = async <T = unknown>({
  timeoutMs = DEFAULT_ADMIN_REQUEST_TIMEOUT_MS,
  ...args
}: AdminRequestArgs): Promise<T> => {
  try {
    const {response, result} = await apiFetch({...args, timeoutMs});
    // Admin callers have always received `undefined` for 204 No Content.
    return (response.status === 204 ? undefined : result) as T;
  } catch (error) {
    // Raw fetch failures (offline, CORS) keep surfacing as the original error.
    if (isApiError(error) && error.data.code === API_ERROR_CODES.network && error.cause) {
      throw error.cause;
    }
    if (isApiError(error)) {
      throw new AdminAPIError({
        detail: error.data.detail,
        status: error.status,
        title: error.data.title,
      });
    }
    throw error;
  }
};

export interface BindAdminRequestOptions {
  credentials?: RequestCredentials;
  getAuthHeaders?: AdminGetAuthHeaders;
  /**
   * API origin for embedded hosts (e.g. `http://localhost:4000`). Absolute `url`
   * values are left unchanged. Relative paths such as `/admin/config` and
   * `/rbac/roles` are prefixed so they do not hit the Expo web origin.
   */
  origin?: string;
}

/**
 * Prefix a relative admin RPC URL with the host API origin. Same-origin SPA
 * hosts omit `origin` and keep path-only URLs.
 */
const resolveAdminFetchUrl = ({origin, url}: {origin?: string; url: string}): string => {
  if (!origin) {
    return url;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
    return url;
  }
  const trimmedOrigin = origin.replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${trimmedOrigin}${path}`;
};

/**
 * Bind host auth onto {@link adminRequest}.
 * SPA: `credentials: "same-origin"` and no Bearer headers.
 * Embedded: `getAuthHeaders` returns `Authorization: Bearer …` plus `origin`.
 */
export const bindAdminRequest = ({
  credentials,
  getAuthHeaders,
  origin,
}: BindAdminRequestOptions): ((args: AdminRequestArgs) => Promise<unknown>) => {
  return async (args: AdminRequestArgs): Promise<unknown> => {
    const headers = new Headers(args.headers);
    if (getAuthHeaders) {
      const extra = await getAuthHeaders();
      new Headers(extra).forEach((value, key) => {
        headers.set(key, value);
      });
    }
    return adminRequest({
      ...args,
      credentials: args.credentials ?? credentials,
      headers,
      url: resolveAdminFetchUrl({origin, url: args.url}),
    });
  };
};
