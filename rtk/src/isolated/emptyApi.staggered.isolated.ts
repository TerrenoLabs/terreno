import {afterEach, beforeEach, describe, it, mock, spyOn} from "bun:test";
import type {BaseQueryApi, FetchArgs} from "@reduxjs/toolkit/query/react";
import axios, {AxiosError} from "axios";
import {assert} from "chai";
import {DateTime} from "luxon";

// Force the web code paths regardless of which platform mock another test file installed.
mock.module("../platform", () => ({IsWeb: true}));

// Mutable async storage so each test controls what the token helpers read. Returns null by
// default, matching the preload mock for the rest of the package.
const storage = new Map<string, string>();

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string): Promise<string | null> => storage.get(key) ?? null,
    removeItem: async (key: string): Promise<void> => {
      storage.delete(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      storage.set(key, value);
    },
  },
}));

const {configureOfflineMutationEndpoints} = await import("../offlineGate");
const {setTokenSource} = await import("../tokenSource");
const {LOGOUT_ACTION_TYPE, TOKEN_REFRESHED_SUCCESS} = await import("../constants");
const {
  getBaseQuery,
  getFriendlyExpirationInfo,
  getTokenExpirationTimes,
  jwtTokenSource,
  refreshAuthToken,
  shouldShowStillThereModal,
  staggeredBaseQuery,
} = await import("../emptyApi");

const encodeSegment = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const makeJwt = (expiresInSecs: number): string => {
  const exp = Math.floor(DateTime.now().toSeconds()) + expiresInSecs;
  return `${encodeSegment({alg: "HS256", typ: "JWT"})}.${encodeSegment({exp})}.signature`;
};

const setTokens = ({auth, refresh}: {auth?: string; refresh?: string}): void => {
  storage.clear();
  if (auth) {
    storage.set("AUTH_TOKEN", auth);
  }
  if (refresh) {
    storage.set("REFRESH_TOKEN", refresh);
  }
};

interface DispatchedAction {
  type: string;
}

interface FakeApi {
  api: BaseQueryApi;
  dispatched: DispatchedAction[];
}

const createApi = ({
  endpoint = "getTodos",
  offline = false,
  type = "query",
}: {
  endpoint?: string;
  offline?: boolean;
  type?: "query" | "mutation";
} = {}): FakeApi => {
  const dispatched: DispatchedAction[] = [];
  const controller = new AbortController();
  const api: BaseQueryApi = {
    abort: () => controller.abort(),
    dispatch: ((action: DispatchedAction) => {
      dispatched.push(action);
      return action;
    }) as BaseQueryApi["dispatch"],
    endpoint,
    extra: undefined,
    forced: false,
    getState: () => ({
      offline: {conflicts: [], isOnline: !offline, isSyncing: false, queue: []},
    }),
    queryCacheKey: endpoint,
    signal: controller.signal,
    type,
  };
  return {api, dispatched};
};

type FetchFn = typeof globalThis.fetch;

interface RecordedRequest {
  headers: Headers;
  url: string;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    headers: status === 204 ? {} : {"content-type": "application/json"},
    status,
  });

const installFetch = (responses: Array<() => Response>): RecordedRequest[] => {
  const requests: RecordedRequest[] = [];
  const fetchFn = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push({headers: request.headers, url: request.url});
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch call for ${request.url}`);
    }
    return next();
  });
  globalThis.fetch = fetchFn as unknown as FetchFn;
  return requests;
};

const runBaseQuery = (
  api: BaseQueryApi,
  args: string | FetchArgs = "/todos"
): ReturnType<typeof staggeredBaseQuery> => staggeredBaseQuery(args, api, {maxRetries: 0});

const originalFetch = globalThis.fetch;
const globalWithWindow = globalThis as {window?: unknown};

describe("emptyApi token helpers", () => {
  beforeEach(() => {
    globalWithWindow.window = globalThis;
    storage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalWithWindow, "window");
    storage.clear();
  });

  it("returns undefined expirations when tokens are missing", async () => {
    assert.deepEqual(await getTokenExpirationTimes(), {
      authRemainingSecs: undefined,
      refreshRemainingSecs: undefined,
    });
    setTokens({auth: makeJwt(60)});
    assert.deepEqual(await getTokenExpirationTimes(), {
      authRemainingSecs: undefined,
      refreshRemainingSecs: undefined,
    });
  });

  it("returns undefined expirations during SSR when window is not defined", async () => {
    setTokens({auth: makeJwt(60), refresh: makeJwt(600)});
    Reflect.deleteProperty(globalWithWindow, "window");
    assert.deepEqual(await getTokenExpirationTimes(), {
      authRemainingSecs: undefined,
      refreshRemainingSecs: undefined,
    });
  });

  it("computes remaining seconds from the token exp claims", async () => {
    setTokens({auth: makeJwt(120), refresh: makeJwt(3600)});
    const {authRemainingSecs, refreshRemainingSecs} = await getTokenExpirationTimes();
    assert.isNumber(authRemainingSecs);
    assert.isNumber(refreshRemainingSecs);
    assert.closeTo(authRemainingSecs as number, 120, 2);
    assert.closeTo(refreshRemainingSecs as number, 3600, 2);
  });

  it("describes token expiration in a friendly message", async () => {
    assert.equal(await getFriendlyExpirationInfo(), "No tokens available");

    setTokens({auth: makeJwt(120), refresh: makeJwt(3600)});
    const active = await getFriendlyExpirationInfo();
    assert.match(
      active,
      /^Auth token expires in \d+ seconds, Refresh token expires in \d+ seconds$/
    );

    setTokens({auth: makeJwt(-30), refresh: makeJwt(-300)});
    const expired = await getFriendlyExpirationInfo();
    assert.match(
      expired,
      /^Auth token expired \d+ seconds ago, Refresh token expired \d+ seconds ago$/
    );
  });

  it("shows the still-there modal only when the refresh token is about to expire", async () => {
    assert.isFalse(await shouldShowStillThereModal());
    setTokens({auth: makeJwt(60), refresh: makeJwt(3600)});
    assert.isFalse(await shouldShowStillThereModal());
    setTokens({auth: makeJwt(60), refresh: makeJwt(30)});
    assert.isTrue(await shouldShowStillThereModal());
  });
});

describe("refreshAuthToken", () => {
  let postSpy: ReturnType<typeof spyOn<typeof axios, "post">>;

  beforeEach(() => {
    globalWithWindow.window = globalThis;
    storage.clear();
    postSpy = spyOn(axios, "post");
  });

  afterEach(() => {
    postSpy.mockRestore();
    Reflect.deleteProperty(globalWithWindow, "window");
    Reflect.deleteProperty(axios.defaults.headers.common, "Authorization");
    storage.clear();
  });

  it("throws when no refresh token is stored", async () => {
    let thrown: unknown;
    try {
      await refreshAuthToken();
    } catch (error: unknown) {
      thrown = error;
    }
    assert.instanceOf(thrown, Error);
    assert.equal((thrown as Error).message, "no refresh token found");
    assert.equal(postSpy.mock.calls.length, 0);
  });

  it("throws when the API returns no data", async () => {
    setTokens({refresh: makeJwt(600)});
    postSpy.mockResolvedValue({data: {}});
    let thrown: unknown;
    try {
      await refreshAuthToken();
    } catch (error: unknown) {
      thrown = error;
    }
    assert.equal(
      (thrown as Error).message,
      "refresh token API request failed or didn't return data"
    );
  });

  it("throws when the API omits one of the tokens", async () => {
    setTokens({refresh: makeJwt(600)});
    postSpy.mockResolvedValue({data: {data: {token: "only-auth"}}});
    let thrown: unknown;
    try {
      await refreshAuthToken();
    } catch (error: unknown) {
      thrown = error;
    }
    assert.equal((thrown as Error).message, "refresh token API request didn't return data");
  });

  it("stores the new tokens and sets the axios default header", async () => {
    setTokens({refresh: "old-refresh"});
    postSpy.mockResolvedValue({data: {data: {refreshToken: "new-refresh", token: "new-auth"}}});

    await refreshAuthToken();

    assert.equal(postSpy.mock.calls.length, 1);
    assert.match(String(postSpy.mock.calls[0]?.[0]), /\/auth\/refresh_token$/);
    assert.deepEqual(postSpy.mock.calls[0]?.[1], {refreshToken: "old-refresh"});
    assert.equal(storage.get("AUTH_TOKEN"), "new-auth");
    assert.equal(storage.get("REFRESH_TOKEN"), "new-refresh");
    assert.equal(axios.defaults.headers.common.Authorization, "Bearer new-auth");
  });

  it("skips storage during SSR but still updates the axios header", async () => {
    setTokens({refresh: "old-refresh"});
    // The refresh token must be readable, so only remove the window after the read would happen
    // by making the storage read come from a pre-populated value and deleting window in between.
    postSpy.mockImplementation(async () => {
      Reflect.deleteProperty(globalWithWindow, "window");
      return {data: {data: {refreshToken: "new-refresh", token: "new-auth"}}};
    });

    await refreshAuthToken();

    assert.equal(storage.get("REFRESH_TOKEN"), "old-refresh");
    assert.isUndefined(storage.get("AUTH_TOKEN"));
    assert.equal(axios.defaults.headers.common.Authorization, "Bearer new-auth");
  });
});

describe("getBaseQuery", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends auth and app headers and serializes nested params", async () => {
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api} = createApi();

    const result = await getBaseQuery(
      {params: {status: {$in: ["a", "b"]}}, url: "/todos"},
      api,
      {},
      "token-123"
    );

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer token-123");
    assert.equal(requests[0]?.headers.get("app-platform"), "web");
    assert.isString(requests[0]?.headers.get("app-version"));
    assert.include(decodeURIComponent(requests[0]?.url ?? ""), "status[$in][0]=a");
  });

  it("returns null for 204 responses", async () => {
    installFetch([() => jsonResponse(null, 204)]);
    const {api} = createApi();
    const result = await getBaseQuery("/todos/1", api, {}, "token");
    assert.isNull(result.data);
  });

  it("passes list responses through untouched", async () => {
    installFetch([() => jsonResponse({data: [{id: "1"}], more: false, page: 1})]);
    const {api} = createApi();
    const result = await getBaseQuery("/todos", api, {}, "token");
    assert.deepEqual(result.data, {data: [{id: "1"}], more: false, page: 1});
  });

  it("returns bodies without a data wrapper as-is", async () => {
    installFetch([() => jsonResponse({ok: true})]);
    const {api} = createApi();
    const result = await getBaseQuery("/health", api, {}, "token");
    assert.deepEqual(result.data, {ok: true});
  });
});

describe("staggeredBaseQuery", () => {
  let postSpy: ReturnType<typeof spyOn<typeof axios, "post">>;

  beforeEach(() => {
    globalWithWindow.window = globalThis;
    storage.clear();
    postSpy = spyOn(axios, "post");
    configureOfflineMutationEndpoints([]);
  });

  afterEach(() => {
    postSpy.mockRestore();
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalWithWindow, "window");
    Reflect.deleteProperty(axios.defaults.headers.common, "Authorization");
    configureOfflineMutationEndpoints([]);
    storage.clear();
  });

  it("fails immediately for deferred offline mutations without fetching", async () => {
    configureOfflineMutationEndpoints(["postTodos"]);
    const requests = installFetch([]);
    const {api, dispatched} = createApi({endpoint: "postTodos", offline: true, type: "mutation"});

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {error: "Network unavailable", status: "FETCH_ERROR"});
    assert.equal(requests.length, 0);
    assert.deepEqual(dispatched, []);
  });

  it("passes login endpoints through without token validation", async () => {
    const requests = installFetch([() => jsonResponse({data: {token: "t"}})]);
    const {api, dispatched} = createApi({endpoint: "emailLogin", type: "mutation"});

    const result = await runBaseQuery(api, {body: {}, method: "POST", url: "/auth/login"});

    assert.deepEqual(result.data, {token: "t"});
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer null");
    assert.deepEqual(dispatched, []);
  });

  it("logs out when no token is stored", async () => {
    const requests = installFetch([]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {
      error: "No token found for getTodos",
      status: "FETCH_ERROR",
    });
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
    assert.equal(requests.length, 0);
  });

  it("logs out when both tokens are expired", async () => {
    setTokens({auth: makeJwt(-60), refresh: makeJwt(-600)});
    const requests = installFetch([]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {
      error: "Auth and refresh tokens are expired",
      status: "FETCH_ERROR",
    });
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
    assert.equal(requests.length, 0);
  });

  it("sends the stored token when it is not close to expiring", async () => {
    const auth = makeJwt(3600);
    setTokens({auth, refresh: makeJwt(7200)});
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${auth}`);
    assert.deepEqual(dispatched, []);
    assert.equal(postSpy.mock.calls.length, 0);
  });

  it("refreshes the token before the request when it is about to expire", async () => {
    setTokens({auth: makeJwt(60), refresh: makeJwt(7200)});
    postSpy.mockResolvedValue({data: {data: {refreshToken: "new-refresh", token: "new-auth"}}});
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(postSpy.mock.calls.length, 1);
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer new-auth");
    assert.deepEqual(dispatched, [{type: TOKEN_REFRESHED_SUCCESS}]);
  });

  it("continues with the current token when the refresh hits a network error", async () => {
    const auth = makeJwt(60);
    setTokens({auth, refresh: makeJwt(7200)});
    postSpy.mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${auth}`);
    assert.deepEqual(dispatched, []);
  });

  it("logs out when the refresh is rejected with a 401", async () => {
    setTokens({auth: makeJwt(60), refresh: makeJwt(7200)});
    const unauthorized = new AxiosError("Unauthorized", "ERR_BAD_REQUEST");
    unauthorized.status = 401;
    postSpy.mockRejectedValue(unauthorized);
    const requests = installFetch([]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {
      error: "Token refresh failed with 401",
      status: "FETCH_ERROR",
    });
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
    assert.equal(requests.length, 0);
  });

  it("logs out when the refresh fails for another reason", async () => {
    setTokens({auth: makeJwt(60), refresh: makeJwt(7200)});
    postSpy.mockResolvedValue({data: {}});
    const requests = installFetch([]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {
      error: "Failed to refresh token: refresh token API request failed or didn't return data",
      status: "FETCH_ERROR",
    });
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
    assert.equal(requests.length, 0);
  });

  it("refreshes and retries once after a 401 response", async () => {
    setTokens({auth: makeJwt(3600), refresh: makeJwt(7200)});
    postSpy.mockResolvedValue({data: {data: {refreshToken: "new-refresh", token: "new-auth"}}});
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "1"}}),
    ]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer new-auth");
    assert.deepEqual(dispatched, [{type: TOKEN_REFRESHED_SUCCESS}]);
  });

  it("logs out when the refresh after a 401 fails", async () => {
    setTokens({auth: makeJwt(3600), refresh: makeJwt(7200)});
    postSpy.mockRejectedValue(new Error("refresh down"));
    const requests = installFetch([() => jsonResponse({title: "Unauthorized"}, 401)]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.equal(result.error?.status, 401);
    assert.equal(requests.length, 1);
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
  });

  it("waits for an in-flight refresh instead of refreshing twice", async () => {
    setTokens({auth: makeJwt(3600), refresh: makeJwt(7200)});
    let resolveRefresh: (() => void) | undefined;
    postSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () =>
            resolve({data: {data: {refreshToken: "new-refresh", token: "new-auth"}}});
        })
    );
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "first"}}),
      () => jsonResponse({data: {id: "second"}}),
    ]);
    const first = createApi({endpoint: "getFirst"});
    const second = createApi({endpoint: "getSecond"});

    const firstPromise = runBaseQuery(first.api, "/first");
    const secondPromise = runBaseQuery(second.api, "/second");
    // Let both initial requests hit the 401 and the first one acquire the mutex.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.isFunction(resolveRefresh);
    resolveRefresh?.();

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    assert.equal(postSpy.mock.calls.length, 1);
    assert.equal(requests.length, 4);
    assert.equal(requests[2]?.headers.get("authorization"), "Bearer new-auth");
    assert.equal(requests[3]?.headers.get("authorization"), "Bearer new-auth");
    assert.sameDeepMembers([firstResult.data, secondResult.data], [{id: "first"}, {id: "second"}]);
    assert.deepEqual(first.dispatched.concat(second.dispatched), [{type: TOKEN_REFRESHED_SUCCESS}]);
  });

  it("does not retry failed mutations", async () => {
    setTokens({auth: makeJwt(3600), refresh: makeJwt(7200)});
    const requests = installFetch([() => jsonResponse({title: "Bad Request"}, 400)]);
    const {api, dispatched} = createApi({endpoint: "postTodos", type: "mutation"});

    const result = await runBaseQuery(api, {body: {}, method: "POST", url: "/todos"});

    assert.equal(result.error?.status, 400);
    assert.equal(requests.length, 1);
    assert.deepEqual(dispatched, []);
  });
});

interface FakeTokenSource {
  refreshCalls: () => number;
  setToken: (token: string | null) => void;
  source: {
    getToken: () => Promise<string | null>;
    getUserId: () => Promise<string | null>;
    onAuthChange: (callback: () => void) => () => void;
    refresh?: () => Promise<boolean>;
  };
}

const createFakeTokenSource = ({
  token = "fake-token",
  refreshedToken,
  withRefresh = true,
  refreshError,
}: {
  token?: string | null;
  refreshedToken?: string;
  withRefresh?: boolean;
  refreshError?: Error;
} = {}): FakeTokenSource => {
  let current = token;
  let refreshCount = 0;
  const source: FakeTokenSource["source"] = {
    getToken: async () => current,
    getUserId: async () => (current ? "user-1" : null),
    onAuthChange: () => () => {},
  };
  if (withRefresh) {
    source.refresh = async (): Promise<boolean> => {
      refreshCount += 1;
      if (refreshError) {
        throw refreshError;
      }
      if (refreshedToken) {
        current = refreshedToken;
      }
      return true;
    };
  }
  return {
    refreshCalls: () => refreshCount,
    setToken: (next) => {
      current = next;
    },
    source,
  };
};

describe("staggeredBaseQuery with a registered token source", () => {
  let postSpy: ReturnType<typeof spyOn<typeof axios, "post">>;

  beforeEach(() => {
    globalWithWindow.window = globalThis;
    storage.clear();
    postSpy = spyOn(axios, "post");
    configureOfflineMutationEndpoints([]);
  });

  afterEach(() => {
    setTokenSource(undefined);
    postSpy.mockRestore();
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalWithWindow, "window");
    configureOfflineMutationEndpoints([]);
    storage.clear();
  });

  it("sends the source's token and does not log out when no JWT is stored (#1217)", async () => {
    const fake = createFakeTokenSource();
    setTokenSource(fake.source);
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(dispatched, []);
    assert.deepEqual(result.data, {id: "1"});
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer fake-token");
    assert.equal(postSpy.mock.calls.length, 0);
  });

  it("sends the request without an authorization header when the token is null", async () => {
    const fake = createFakeTokenSource({token: null});
    setTokenSource(fake.source);
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.isNull(requests[0]?.headers.get("authorization") ?? null);
    assert.deepEqual(dispatched, []);
  });

  it("treats a token read that throws as no token", async () => {
    setTokenSource({
      getToken: async () => {
        throw new Error("storage unavailable");
      },
      getUserId: async () => null,
      onAuthChange: () => () => {},
    });
    const requests = installFetch([() => jsonResponse({data: {id: "1"}})]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.isNull(requests[0]?.headers.get("authorization") ?? null);
    assert.deepEqual(dispatched, []);
  });

  it("refreshes once after a 401 and returns the retried response", async () => {
    const fake = createFakeTokenSource({refreshedToken: "fresh-token"});
    setTokenSource(fake.source);
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "1"}}),
    ]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(fake.refreshCalls(), 1);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer fake-token");
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer fresh-token");
    assert.deepEqual(dispatched, []);
  });

  it("calls refresh on a class-based source with its own this", async () => {
    class ClassTokenSource {
      private token = "class-token";
      refreshCount = 0;
      async getToken(): Promise<string | null> {
        return this.token;
      }
      async getUserId(): Promise<string | null> {
        return "class-user";
      }
      onAuthChange(): () => void {
        return (): void => {};
      }
      async refresh(): Promise<boolean> {
        this.refreshCount += 1;
        this.token = "class-fresh-token";
        return true;
      }
    }
    const source = new ClassTokenSource();
    setTokenSource(source);
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "1"}}),
    ]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(source.refreshCount, 1);
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer class-fresh-token");
    assert.deepEqual(dispatched, []);
  });

  it("logs out only when the retry after a refresh is also a 401", async () => {
    const fake = createFakeTokenSource();
    setTokenSource(fake.source);
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Unauthorized"}, 401),
    ]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.equal(result.error?.status, 401);
    assert.equal(fake.refreshCalls(), 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
  });

  it("does not keep retrying after it logs out", async () => {
    const fake = createFakeTokenSource();
    setTokenSource(fake.source);
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Unauthorized"}, 401),
    ]);
    const {api, dispatched} = createApi();

    const result = await staggeredBaseQuery("/todos", api, {maxRetries: 2});

    assert.equal(result.error?.status, 401);
    assert.equal(requests.length, 2);
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
  });

  it("retries once with a re-read token when the source has no refresh", async () => {
    const fake = createFakeTokenSource({withRefresh: false});
    setTokenSource(fake.source);
    const requests = installFetch([
      () => {
        fake.setToken("rotated-token");
        return jsonResponse({title: "Unauthorized"}, 401);
      },
      () => jsonResponse({data: {id: "1"}}),
    ]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.data, {id: "1"});
    assert.equal(requests[1]?.headers.get("authorization"), "Bearer rotated-token");
    assert.deepEqual(dispatched, []);
  });

  it("still retries when the refresh throws, and logs out when the retry is a 401", async () => {
    const fake = createFakeTokenSource({refreshError: new Error("network down")});
    setTokenSource(fake.source);
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Unauthorized"}, 401),
    ]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.equal(result.error?.status, 401);
    assert.equal(fake.refreshCalls(), 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
  });

  it("calls refresh again after a refresh that threw synchronously", async () => {
    let refreshCount = 0;
    setTokenSource({
      getToken: async () => "fake-token",
      getUserId: async () => "user-1",
      onAuthChange: () => () => {},
      refresh: (): Promise<boolean> => {
        refreshCount += 1;
        throw new Error("sync failure");
      },
    });
    installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "1"}}),
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "2"}}),
    ]);

    const first = await runBaseQuery(createApi().api);
    const second = await runBaseQuery(createApi().api);

    assert.deepEqual(first.data, {id: "1"});
    assert.deepEqual(second.data, {id: "2"});
    assert.equal(refreshCount, 2);
  });

  it("shares one refresh between concurrent 401s", async () => {
    const fake = createFakeTokenSource({refreshedToken: "fresh-token"});
    setTokenSource(fake.source);
    const requests = installFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {id: "first"}}),
      () => jsonResponse({data: {id: "second"}}),
    ]);
    const first = createApi({endpoint: "getFirst"});
    const second = createApi({endpoint: "getSecond"});

    const [firstResult, secondResult] = await Promise.all([
      runBaseQuery(first.api, "/first"),
      runBaseQuery(second.api, "/second"),
    ]);

    assert.equal(fake.refreshCalls(), 1);
    assert.equal(requests.length, 4);
    assert.sameDeepMembers([firstResult.data, secondResult.data], [{id: "first"}, {id: "second"}]);
    assert.deepEqual(first.dispatched.concat(second.dispatched), []);
  });

  it("does not retry failed mutations", async () => {
    setTokenSource(createFakeTokenSource().source);
    const requests = installFetch([() => jsonResponse({title: "Bad Request"}, 400)]);
    const {api, dispatched} = createApi({endpoint: "postTodos", type: "mutation"});

    const result = await staggeredBaseQuery({body: {}, method: "POST", url: "/todos"}, api, {
      maxRetries: 2,
    });

    assert.equal(result.error?.status, 400);
    assert.equal(requests.length, 1);
    assert.deepEqual(dispatched, []);
  });

  it("passes public endpoints through without refreshing or logging out", async () => {
    const fake = createFakeTokenSource();
    setTokenSource(fake.source);
    const requests = installFetch([() => jsonResponse({title: "Unauthorized"}, 401)]);
    const {api, dispatched} = createApi({endpoint: "getVersionCheck"});

    const result = await runBaseQuery(api, "/version-check");

    assert.equal(result.error?.status, 401);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer fake-token");
    assert.equal(fake.refreshCalls(), 0);
    assert.deepEqual(dispatched, []);
  });

  it("still defers offline mutations before reading the source", async () => {
    configureOfflineMutationEndpoints(["postTodos"]);
    setTokenSource(createFakeTokenSource().source);
    const requests = installFetch([]);
    const {api, dispatched} = createApi({endpoint: "postTodos", offline: true, type: "mutation"});

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {error: "Network unavailable", status: "FETCH_ERROR"});
    assert.equal(requests.length, 0);
    assert.deepEqual(dispatched, []);
  });

  it("keeps the JWT behavior when jwtTokenSource is registered explicitly", async () => {
    setTokenSource(jwtTokenSource);
    const requests = installFetch([]);
    const {api, dispatched} = createApi();

    const result = await runBaseQuery(api);

    assert.deepEqual(result.error, {
      error: "No token found for getTodos",
      status: "FETCH_ERROR",
    });
    assert.deepEqual(dispatched, [{type: LOGOUT_ACTION_TYPE}]);
    assert.equal(requests.length, 0);
  });
});

describe("jwtTokenSource", () => {
  let postSpy: ReturnType<typeof spyOn<typeof axios, "post">>;

  beforeEach(() => {
    globalWithWindow.window = globalThis;
    storage.clear();
    postSpy = spyOn(axios, "post");
  });

  afterEach(() => {
    postSpy.mockRestore();
    Reflect.deleteProperty(globalWithWindow, "window");
    Reflect.deleteProperty(axios.defaults.headers.common, "Authorization");
    storage.clear();
  });

  it("reads the stored JWT through getAuthToken", async () => {
    assert.isNull(await jwtTokenSource.getToken());
    setTokens({auth: "stored-auth"});
    assert.equal(await jwtTokenSource.getToken(), "stored-auth");
  });

  it("refreshes through refreshAuthToken and resolves true on success", async () => {
    setTokens({refresh: "old-refresh"});
    postSpy.mockResolvedValue({data: {data: {refreshToken: "new-refresh", token: "new-auth"}}});

    assert.isTrue(await jwtTokenSource.refresh?.());
    assert.equal(postSpy.mock.calls.length, 1);
    assert.equal(storage.get("AUTH_TOKEN"), "new-auth");
  });

  it("resolves false when refreshAuthToken fails", async () => {
    assert.isFalse(await jwtTokenSource.refresh?.());
    assert.equal(postSpy.mock.calls.length, 0);
  });

  it("reads the user id from the stored JWT", async () => {
    assert.isNull(await jwtTokenSource.getUserId());
    const payload = encodeSegment({exp: 4102444800, id: "user-42"});
    setTokens({auth: `${encodeSegment({alg: "HS256"})}.${payload}.signature`});
    assert.equal(await jwtTokenSource.getUserId(), "user-42");
    const subOnly = encodeSegment({exp: 4102444800, sub: "user-sub"});
    setTokens({auth: `${encodeSegment({alg: "HS256"})}.${subOnly}.signature`});
    assert.equal(await jwtTokenSource.getUserId(), "user-sub");
    setTokens({auth: "not-a-jwt"});
    assert.isNull(await jwtTokenSource.getUserId());
  });

  it("notifies onAuthChange subscribers after a token refresh", async () => {
    setTokens({refresh: "old-refresh"});
    postSpy.mockResolvedValue({data: {data: {refreshToken: "new-refresh", token: "new-auth"}}});
    let calls = 0;
    const unsubscribe = jwtTokenSource.onAuthChange(() => {
      calls += 1;
    });

    await refreshAuthToken();
    unsubscribe();
    setTokens({refresh: "old-refresh"});
    await refreshAuthToken();

    assert.equal(calls, 1);
  });
});
