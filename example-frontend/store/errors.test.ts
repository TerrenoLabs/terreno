import {afterEach, beforeEach, describe, it, mock} from "bun:test";
import assert from "node:assert";
import type {MiddlewareAPI} from "@reduxjs/toolkit";

// Sentry Scope type - represents the Sentry scope object for error context
type SentryScope = {
  setContext: (name: string, context: Record<string, unknown>) => void;
};

// Mock Sentry before importing the module
const mockSentry = {
  // withScope accepts a callback that receives a Sentry scope object
  withScope: mock((callback: (scope: SentryScope) => void) => {
    const mockScope = {
      setContext: mock(() => {}),
    };
    callback(mockScope);
  }),
};

// Mock @sentry/react
mock.module("@sentry/react", () => mockSentry);

// Mock @/utils/sentry
const captureException = mock(() => {});
mock.module("@/utils/sentry", () => ({
  captureException,
}));

const {rtkQueryErrorMiddleware} = await import("./errors");

type ActionType = {
  error?: boolean;
  payload?: {
    status?: string | number;
    error?: string;
    data?: {
      title?: string;
      message?: string;
      disableExternalErrorTracking?: boolean;
    };
  };
  meta?: {
    baseQueryMeta?: {
      request?: {
        method?: string;
        url?: string;
      };
    };
    arg?: {
      type?: string;
      endpointName?: string;
      originalArgs?: Record<string, unknown>;
    };
  };
};

describe("rtkQueryErrorMiddleware", () => {
  let mockStore: MiddlewareAPI;
  let next: ReturnType<typeof mock>;
  let consoleDebugSpy: ReturnType<typeof mock>;
  let consoleWarnSpy: ReturnType<typeof mock>;
  let originalConsoleDebug: typeof console.debug;
  let originalConsoleWarn: typeof console.warn;
  let middleware: (action: ActionType) => ActionType;

  beforeEach(() => {
    // MiddlewareAPI requires dispatch and getState functions
    // Mock functions are used to track calls in tests
    mockStore = {
      dispatch: mock(() => {}) as unknown as MiddlewareAPI["dispatch"],
      getState: mock(() => {}) as unknown as MiddlewareAPI["getState"],
    };
    next = mock((action: ActionType) => action);

    // Save original console methods
    originalConsoleDebug = console.debug;
    originalConsoleWarn = console.warn;

    // Replace with mocks
    consoleDebugSpy = mock(() => {});
    consoleWarnSpy = mock(() => {});
    // Console methods are reassigned to mocks for testing purposes
    console.debug = consoleDebugSpy as unknown as typeof console.debug;
    console.warn = consoleWarnSpy as unknown as typeof console.warn;

    const middlewareWithStore = rtkQueryErrorMiddleware(mockStore);
    middleware = (action: ActionType): ActionType =>
      middlewareWithStore(next)(action) as ActionType;
  });

  afterEach(() => {
    // Restore original console methods
    console.debug = originalConsoleDebug;
    console.warn = originalConsoleWarn;
  });

  it("formats error messages with baseQueryMeta when available", () => {
    const action = {
      error: true,
      meta: {
        arg: {
          endpointName: "createUser",
          originalArgs: {
            name: "test",
          },
          type: "mutation",
        },
        baseQueryMeta: {
          request: {
            method: "POST",
            url: "/api/users",
          },
        },
      },
      payload: {
        error: "TypeError: Failed to fetch",
        status: "FETCH_ERROR",
      },
    };

    middleware(action);

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      '/api/users POST: TypeError: Failed to fetch (args: {"name":"test"})'
    );
    assert.ok(consoleDebugSpy.mock.calls[0][1]);
  });

  it("masks password args in logs and the Sentry context", () => {
    const contexts: Array<Record<string, unknown>> = [];
    mockSentry.withScope.mockImplementationOnce((callback: (scope: SentryScope) => void) => {
      callback({
        setContext: (_name: string, context: Record<string, unknown>): void => {
          contexts.push(context);
        },
      });
    });
    const action = {
      error: true,
      meta: {
        arg: {
          endpointName: "patchMe",
          originalArgs: {currentPassword: "dummy-secret-1", email: "new@example.com"},
          type: "mutation",
        },
        baseQueryMeta: {request: {method: "PATCH", url: "/auth/me"}},
      },
      payload: {data: {message: "Something else failed"}, status: 500},
    };

    middleware(action);

    const logged = JSON.stringify([consoleDebugSpy.mock.calls, consoleWarnSpy.mock.calls]);
    assert.ok(!logged.includes("dummy-secret-1"));
    assert.ok(logged.includes("<REDACTED>"));
    assert.strictEqual(contexts.length, 1);
    assert.ok(!JSON.stringify(contexts[0]).includes("dummy-secret-1"));
  });

  it("falls back to meta.arg when baseQueryMeta is not available", () => {
    const action = {
      error: true,
      meta: {
        arg: {
          endpointName: "createUser",
          originalArgs: {
            name: "test",
          },
          type: "mutation",
        },
      },
      payload: {
        error: "TypeError: Failed to fetch",
        status: "FETCH_ERROR",
      },
    };

    middleware(action);

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      'createUser rejected mutation: TypeError: Failed to fetch (args: {"name":"test"})'
    );
    assert.ok(consoleDebugSpy.mock.calls[0][1]);
  });

  it("handles missing meta.arg gracefully", () => {
    const action = {
      error: true,
      payload: {
        error: "Network Error",
        status: "FETCH_ERROR",
      },
    };

    middleware(action);

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      "unknown endpoint: Network Error (args: no args)"
    );
    assert.ok(consoleDebugSpy.mock.calls[0][1]);
  });

  it("summarizes large objects in args", () => {
    const action = {
      error: true,
      meta: {
        arg: {
          endpointName: "updateUserProfile",
          originalArgs: {
            body: {
              email: "test@example.com",
              name: "test",
              preferences: {
                language: "en",
                notifications: true,
                theme: "dark",
                timezone: "UTC",
              },
            },
            id: "123",
          },
          type: "mutation",
        },
      },
      payload: {
        error: "TypeError: Failed to fetch",
        status: "FETCH_ERROR",
      },
    };

    middleware(action);

    assert.strictEqual(
      consoleDebugSpy.mock.calls[0][0],
      'updateUserProfile rejected mutation: TypeError: Failed to fetch (args: {"body":{"email":"test@example.com","name":"test","preferences":{"language":"en","notifications":true,"theme":"dark","timezone":"UTC"}},"id":"123"})'
    );
    assert.ok(consoleDebugSpy.mock.calls[0][1]);
  });

  it("ignores 404 and 401 errors from Sentry", () => {
    const action = {
      error: true,
      meta: {
        arg: {
          endpointName: "getUserById",
          originalArgs: {id: "123"},
          type: "query",
        },
        baseQueryMeta: {
          request: {
            method: "GET",
            url: "/api/users/123",
          },
        },
      },
      payload: {
        error: "Not Found",
        status: 404,
      },
    };

    middleware(action);

    assert.strictEqual(consoleWarnSpy.mock.calls.length, 0);
  });

  it("ignores push notification permission denied errors", () => {
    const action = {
      error: true,
      payload: {
        error: "AbortError: Registration failed - permission denied",
      },
    };

    middleware(action);

    assert.strictEqual(consoleWarnSpy.mock.calls.length, 0);
    assert.ok(next.mock.calls.length > 0);
    assert.deepStrictEqual(next.mock.calls[0][0], action);
  });
});
