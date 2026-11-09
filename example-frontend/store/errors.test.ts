import {afterEach, beforeEach, describe, it, mock} from "bun:test";
import assert from "node:assert";
import {API_ERROR_CODES, ApiError, type ApiErrorData} from "@terreno/syncdb/api";

// Sentry Scope type - represents the Sentry scope object for error context
type SentryScope = {
  setContext: (name: string, context: Record<string, unknown>) => void;
};

const setContext = mock((_name: string, _context: Record<string, unknown>) => {});

// Mock Sentry before importing the module
const mockSentry = {
  withScope: mock((callback: (scope: SentryScope) => void) => {
    callback({setContext});
  }),
};

mock.module("@sentry/react", () => mockSentry);

const captureException = mock((_error: unknown) => {});
mock.module("@/utils/sentry", () => ({
  captureException,
}));

const {reportApiError} = await import("./errors");

const apiError = (
  status: number,
  data: Partial<ApiErrorData> & Record<string, unknown> = {},
  cause?: unknown
): ApiError =>
  new ApiError({cause, data: {title: "Server exploded", ...data} as ApiErrorData, status});

describe("reportApiError", () => {
  let consoleDebugSpy: ReturnType<typeof mock>;
  let consoleWarnSpy: ReturnType<typeof mock>;
  let originalConsoleDebug: typeof console.debug;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    originalConsoleDebug = console.debug;
    originalConsoleWarn = console.warn;
    consoleDebugSpy = mock(() => {});
    consoleWarnSpy = mock(() => {});
    // Console methods are reassigned to mocks for testing purposes
    console.debug = consoleDebugSpy as unknown as typeof console.debug;
    console.warn = consoleWarnSpy as unknown as typeof console.warn;
    captureException.mockClear();
    setContext.mockClear();
  });

  afterEach(() => {
    console.debug = originalConsoleDebug;
    console.warn = originalConsoleWarn;
  });

  it("logs the method, url, and args of a failed mutation and reports it to Sentry", () => {
    reportApiError(apiError(500), {body: {name: "test"}, method: "POST", url: "/users"});

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      'POST /users rejected mutation: Server exploded (args: {"body":{"name":"test"}})'
    );
    assert.strictEqual(captureException.mock.calls.length, 1);
    const reported = captureException.mock.calls[0][0] as Error;
    assert.strictEqual(
      reported.message,
      'POST /users rejected mutation: Server exploded (args: {"body":{"name":"test"}})'
    );
    assert.strictEqual(setContext.mock.calls[0][0], "request");
    assert.deepStrictEqual(setContext.mock.calls[0][1], {
      args: {body: {name: "test"}},
      endpointInfo: "POST /users rejected mutation",
      error: {title: "Server exploded"},
      status: 500,
    });
  });

  it("labels GET requests as queries and summarizes their params", () => {
    reportApiError(apiError(500), {params: {limit: 20, page: 2}, url: "/todos"});

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      'GET /todos rejected query: Server exploded (args: {"params":{"limit":20,"page":2}})'
    );
  });

  it("masks password fields in logs and the Sentry context", () => {
    reportApiError(apiError(500), {
      body: {currentPassword: "dummy-secret-1", email: "new@example.com"},
      method: "PATCH",
      url: "/auth/me",
    });

    const logged = JSON.stringify([consoleDebugSpy.mock.calls, consoleWarnSpy.mock.calls]);
    assert.ok(!logged.includes("dummy-secret-1"));
    assert.ok(logged.includes("<REDACTED>"));
    assert.strictEqual(setContext.mock.calls.length, 1);
    assert.ok(!JSON.stringify(setContext.mock.calls[0][1]).includes("dummy-secret-1"));
  });

  it("reports no args when the request sent none", () => {
    reportApiError(apiError(500), {method: "DELETE", url: "/todos/1"});

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      "DELETE /todos/1 rejected mutation: Server exploded (args: no args)"
    );
  });

  it("summarizes large nested bodies", () => {
    reportApiError(apiError(500), {
      body: {
        email: "test@example.com",
        preferences: {language: "en", notifications: true, theme: "dark", timezone: "UTC"},
      },
      method: "PATCH",
      url: "/auth/me",
    });

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      'PATCH /auth/me rejected mutation: Server exploded (args: {"body":{"email":"test@example.com","preferences":{"language":"en","notifications":true,"theme":"dark","timezone":"UTC"}}})'
    );
  });

  it("names non-JSON bodies instead of serializing them", () => {
    reportApiError(apiError(500), {body: new FormData(), method: "POST", url: "/files/upload"});

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      'POST /files/upload rejected mutation: Server exploded (args: {"body":"[FormData]"})'
    );
  });

  it("does not report 404 and 401 errors to Sentry", () => {
    reportApiError(apiError(404, {title: "Not Found"}), {url: "/users/123"});
    reportApiError(apiError(401, {title: "Unauthorized"}), {url: "/auth/me"});

    assert.strictEqual(consoleDebugSpy.mock.calls.length, 2);
    assert.strictEqual(consoleWarnSpy.mock.calls.length, 0);
    assert.strictEqual(captureException.mock.calls.length, 0);
  });

  it("does not report network failures to Sentry", () => {
    reportApiError(
      apiError(
        0,
        {code: API_ERROR_CODES.network, title: "Network request failed"},
        new TypeError("Failed to fetch")
      ),
      {url: "/auth/me"}
    );

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      "GET /auth/me rejected query: Network request failed: TypeError: Failed to fetch (args: no args)"
    );
    assert.strictEqual(captureException.mock.calls.length, 0);
  });

  it("ignores push notification permission denied errors", () => {
    reportApiError(apiError(500, {title: "AbortError: Registration failed - permission denied"}), {
      method: "POST",
      url: "/comms/pushTokens",
    });

    assert.strictEqual(consoleWarnSpy.mock.calls.length, 0);
    assert.strictEqual(captureException.mock.calls.length, 0);
  });

  it("respects disableExternalErrorTracking from the server", () => {
    reportApiError(apiError(500, {disableExternalErrorTracking: true}), {url: "/docs"});
    reportApiError(apiError(500, {meta: {disableExternalErrorTracking: true}}), {url: "/docs"});

    assert.strictEqual(captureException.mock.calls.length, 0);
  });

  it("reports timeouts", () => {
    reportApiError(apiError(0, {code: API_ERROR_CODES.timeout, title: "Request timed out"}), {
      url: "/slow",
    });

    assert.strictEqual(consoleWarnSpy.mock.calls.length, 1);
    assert.strictEqual(captureException.mock.calls.length, 1);
  });
});
