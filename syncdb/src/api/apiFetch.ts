import {API_ERROR_CODES, ApiError, type ApiErrorData} from "./apiError";

/** Default AbortController timeout for a single request. */
export const DEFAULT_API_TIMEOUT_MS = 30_000;

/** `fetch`-compatible function; injectable for tests and custom transports. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiFetchArgs {
  url: string;
  method?: string;
  /** Plain objects are JSON-encoded; FormData, Blob, and strings pass through. */
  body?: BodyInit | Record<string, unknown> | readonly unknown[] | null;
  /** Primitives, arrays (repeated keys), nested objects (bracket keys), Dates (ISO strings). */
  params?: Record<string, unknown>;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Defaults to JSON when the response says so, otherwise text. */
  parseAs?: "json" | "text" | "blob";
  fetchImpl?: FetchLike;
}

const isFormData = (value: unknown): value is FormData =>
  typeof FormData !== "undefined" && value instanceof FormData;

const isBinary = (value: unknown): boolean =>
  (typeof Blob !== "undefined" && value instanceof Blob) ||
  (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) ||
  (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams);

const isJsonBody = (value: unknown): boolean =>
  value != null && typeof value === "object" && !isFormData(value) && !isBinary(value);

const appendParam = (search: URLSearchParams, key: string, value: unknown): void => {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    search.append(key, "");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendParam(search, key, item);
    }
    return;
  }
  if (value instanceof Date) {
    search.append(key, value.toISOString());
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendParam(search, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  search.append(key, String(value));
};

/**
 * Serialize query params for `@terreno/api`'s qs parser: arrays become repeated
 * keys and nested objects use bracket keys (`updated[$gte]=…`).
 */
export const serializeParams = (params: Record<string, unknown> | undefined): string => {
  if (!params) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendParam(search, key, value);
  }
  return search.toString();
};

/** Prefix a relative URL with `baseUrl`; absolute and protocol-relative URLs are kept. */
export const resolveApiUrl = ({baseUrl, url}: {baseUrl?: string; url: string}): string => {
  if (!baseUrl || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
    return url;
  }
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${url.startsWith("/") ? url : `/${url}`}`;
};

/**
 * Same response unwrapping the RTK base query used: list envelopes
 * (`{data, more, …}`) stay whole, and envelopes with a truthy `data` unwrap to it.
 */
export const unwrapEnvelope = (result: unknown): unknown => {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  if ("more" in result) {
    return result;
  }
  const data = (result as {data?: unknown}).data;
  if (data) {
    return data;
  }
  return result;
};

const readErrorData = async (response: Response): Promise<ApiErrorData> => {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = (await response.json()) as
        | (Partial<ApiErrorData> & {message?: unknown})
        | null;
      // Routes that predate JSON:API errors (`PATCH /auth/me`) answer `{message}`; it is the
      // reason the server gives, so it stands in for the missing `title`.
      const title =
        typeof parsed?.title === "string" && parsed.title.length > 0
          ? parsed.title
          : typeof parsed?.message === "string" && parsed.message.length > 0
            ? parsed.message
            : undefined;
      if (parsed && title !== undefined) {
        const data: ApiErrorData = {title};
        if (parsed.detail !== undefined) {
          data.detail = parsed.detail;
        }
        if (parsed.code !== undefined) {
          data.code = parsed.code;
        }
        if (parsed.fields !== undefined) {
          data.fields = parsed.fields;
        }
        if (parsed.meta !== undefined) {
          data.meta = parsed.meta;
        }
        if (typeof parsed.disableExternalErrorTracking === "boolean") {
          data.disableExternalErrorTracking = parsed.disableExternalErrorTracking;
        }
        return data;
      }
    } catch {
      // Fall through to the status text.
    }
  }
  const fallback = response.statusText.trim();
  return {title: fallback.length > 0 ? fallback : `Request failed (${response.status})`};
};

/**
 * One `fetch` with a timeout, body encoding, and JSON:API error mapping. No auth,
 * retries, or unwrapping — {@link createApiClient} layers those on. Exported for
 * hosts (admin-frontend) that bind their own auth headers.
 */
export const apiFetch = async ({
  body,
  credentials,
  fetchImpl,
  headers,
  method = "GET",
  params,
  parseAs,
  signal,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
  url,
}: ApiFetchArgs): Promise<{response: Response; result: unknown}> => {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => {
    controller.abort();
  };
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", onAbort, {once: true});
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;
  if (isJsonBody(body)) {
    requestBody = JSON.stringify(body);
    if (!requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }
  } else if (body != null) {
    requestBody = body as BodyInit;
  }
  const query = serializeParams(params);
  const fullUrl = query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
  const fetcher: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  try {
    const response = await fetcher(fullUrl, {
      body: requestBody,
      credentials,
      headers: requestHeaders,
      method,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError({data: await readErrorData(response), status: response.status});
    }
    if (response.status === 204) {
      return {response, result: null};
    }
    if (parseAs === "blob") {
      return {response, result: await response.blob()};
    }
    if (parseAs === "text") {
      return {response, result: await response.text()};
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (parseAs === "json" || contentType.includes("application/json")) {
      return {response, result: await response.json()};
    }
    return {response, result: await response.text()};
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (timedOut) {
      throw new ApiError({
        cause: error,
        data: {code: API_ERROR_CODES.timeout, title: "Request timed out"},
        status: 0,
      });
    }
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ApiError({
        cause: error,
        data: {code: API_ERROR_CODES.aborted, title: "Request cancelled"},
        status: 0,
      });
    }
    throw new ApiError({
      cause: error,
      data: {code: API_ERROR_CODES.network, title: "Network request failed"},
      status: 0,
    });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
};
