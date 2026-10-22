import * as Sentry from "@sentry/react";
import {API_ERROR_CODES, type ApiError, type ApiRequestArgs} from "@terreno/syncdb/api";
import {captureException} from "@/utils/sentry";

const ignoredErrors = [
  "Account locked due to too many failed login attempts",
  "Password or username is incorrect",
  "User interaction is not allowed",
  "Token refresh failed with 401",
  "Failed to refresh token",
  "Auth and refresh tokens are expired",
  "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
  "Registration failed - permission denied",
  "TypeError: Load failed",
  "TypeError: Failed to fetch",
];

/** Statuses that are expected in normal use (signed out, missing record) and never reported. */
const IGNORED_STATUSES = new Set([401, 404]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null &&
  typeof value === "object" &&
  (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);

/** The request's params and JSON body, or `undefined` when it sent neither. */
const requestArgs = (args: ApiRequestArgs): Record<string, unknown> | undefined => {
  const summary: Record<string, unknown> = {};
  if (args.params && Object.keys(args.params).length > 0) {
    summary.params = args.params;
  }
  if (isPlainObject(args.body)) {
    summary.body = args.body;
  } else if (typeof FormData !== "undefined" && args.body instanceof FormData) {
    summary.body = "[FormData]";
  } else if (args.body != null) {
    summary.body = `[${typeof args.body}]`;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
};

/** Error text from the response, plus the underlying cause for network failures. */
const errorMessageFor = (error: ApiError): string => {
  const cause = (error as {cause?: unknown}).cause;
  if (error.status === 0 && cause) {
    return `${error.data.title}: ${String(cause)}`;
  }
  return error.data.title || error.message;
};

const isTrackingDisabled = (error: ApiError): boolean => {
  const data = error.data as {
    disableExternalErrorTracking?: unknown;
    meta?: Record<string, unknown>;
  };
  return (
    data.disableExternalErrorTracking === true || data.meta?.disableExternalErrorTracking === true
  );
};

/**
 * `onError` for the app's request client: log every failed request and send the actionable ones
 * to Sentry. Signed-out (401), not-found (404), network failures, known auth/permission messages,
 * and errors the server marks `disableExternalErrorTracking` stay out of Sentry.
 */
export const reportApiError = (error: ApiError, args: ApiRequestArgs): void => {
  const method = (args.method ?? "GET").toUpperCase();
  const kind = method === "GET" ? "query" : "mutation";
  const endpointInfo = `${method} ${args.url} rejected ${kind}`;
  const errorMessage = errorMessageFor(error);
  const summarizedArgs = requestArgs(args);
  const argsString = summarizedArgs ? JSON.stringify(summarizedArgs) : "no args";
  const message = `${endpointInfo}: ${errorMessage} (args: ${argsString})`;
  console.debug(message);

  if (IGNORED_STATUSES.has(error.status)) {
    return;
  }
  // Offline and unreachable-server failures are expected on mobile networks.
  if (error.data.code === API_ERROR_CODES.network) {
    return;
  }
  const shouldIgnore =
    ignoredErrors.some((ignoredError) => errorMessage.includes(ignoredError)) ||
    isTrackingDisabled(error);
  if (shouldIgnore) {
    return;
  }

  console.warn(`sending data to Sentry: ${message}`);
  Sentry.withScope((scope: Sentry.Scope) => {
    scope.setContext("request", {
      args: summarizedArgs,
      endpointInfo,
      error: error.data,
      status: error.status,
    });
    captureException(new Error(message));
  });
};
