import type {AdminGetAuthHeaders} from "./types";

/** Default AbortController timeout for {@link adminRequest}. */
export const DEFAULT_ADMIN_REQUEST_TIMEOUT_MS = 30_000;

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

const isFormData = (value: unknown): value is FormData => {
  return typeof FormData !== "undefined" && value instanceof FormData;
};

const isJsonBody = (value: unknown): value is Record<string, unknown> => {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (isFormData(value)) {
    return false;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return false;
  }
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    return false;
  }
  return true;
};

const readErrorPayload = async (response: Response): Promise<{detail?: string; title: string}> => {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = (await response.json()) as {detail?: string; title?: string};
      if (typeof parsed.title === "string" && parsed.title.length > 0) {
        return {detail: parsed.detail, title: parsed.title};
      }
    } catch {
      // Fall through to status text.
    }
  }
  const fallback = response.statusText.trim();
  return {title: fallback.length > 0 ? fallback : `Request failed (${response.status})`};
};

/**
 * Native `fetch` helper for every admin request (model CRUD, config, scripts, roles, …).
 * Not axios and not RTK Query. Hosts inject auth via {@link bindAdminRequest} /
 * `AdminProvider` `{getAuthHeaders, credentials, apiOrigin}`.
 */
export const adminRequest = async <T = unknown>({
  body,
  credentials,
  headers,
  method = "GET",
  parseAs,
  signal,
  timeoutMs = DEFAULT_ADMIN_REQUEST_TIMEOUT_MS,
  url,
}: AdminRequestArgs): Promise<T> => {
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, {once: true});
    }
  }
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;
  if (isFormData(body)) {
    requestBody = body;
  } else if (isJsonBody(body)) {
    requestBody = JSON.stringify(body);
    if (!requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }
  } else if (body != null) {
    requestBody = body as BodyInit;
  }

  try {
    const response = await globalThis.fetch(url, {
      body: requestBody,
      credentials,
      headers: requestHeaders,
      method,
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await readErrorPayload(response);
      throw new AdminAPIError({...payload, status: response.status});
    }
    if (response.status === 204) {
      return undefined as T;
    }
    if (parseAs === "blob") {
      return (await response.blob()) as T;
    }
    if (parseAs === "text") {
      return (await response.text()) as T;
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as T;
  } catch (error) {
    if (error instanceof AdminAPIError) {
      throw error;
    }
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || controller.signal.aborted) {
      throw new AdminAPIError({status: 0, title: "Request timed out"});
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
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
