/**
 * Error payload from an `@terreno/api` JSON:API error body. `title` is always
 * set (falls back to the HTTP status text); the rest mirror the server body.
 */
export interface ApiErrorData {
  title: string;
  detail?: string;
  code?: string;
  fields?: Record<string, string>;
  meta?: Record<string, unknown>;
  /**
   * Set by the server when the error is expected and must not reach external error tracking
   * (Sentry). Hosts' `onError` handlers should skip reporting when it is `true`.
   */
  disableExternalErrorTracking?: boolean;
}

/** `data.code` values for failures that never reached an HTTP response (`status: 0`). */
export const API_ERROR_CODES = {
  /** The caller's `signal` aborted the request. */
  aborted: "request-aborted",
  /** `fetch` rejected (offline, DNS, CORS, connection reset). */
  network: "network-error",
  /** The request exceeded `timeoutMs`. */
  timeout: "request-timeout",
} as const;

/**
 * Thrown for every failed request made through the syncdb API client. Shaped like
 * `@terreno/ui`'s `APIError` (`status` + `data.title`) so screens can render it
 * directly. `status` is `0` for timeouts, cancellations, and network failures
 * (see {@link API_ERROR_CODES}).
 */
export class ApiError extends Error {
  data: ApiErrorData;
  status: number;

  constructor({cause, data, status}: {cause?: unknown; data: ApiErrorData; status: number}) {
    super(data.title, cause === undefined ? undefined : {cause});
    this.name = "ApiError";
    this.data = data;
    this.status = status;
  }
}

/** Narrow an unknown caught value to {@link ApiError}. */
export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;
