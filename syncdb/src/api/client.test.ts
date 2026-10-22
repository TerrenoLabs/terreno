import {describe, expect, it} from "bun:test";

import {ApiError, apiFetch, createApiClient, type FetchLike, isApiError} from "./client";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: {"Content-Type": "application/json"},
    status,
  });

/** Scripted fetch double: each call shifts the next responder off the queue. */
const scriptedFetch = (
  responders: Array<(call: RecordedCall) => Response | Promise<Response>>
): {calls: RecordedCall[]; fetchImpl: FetchLike} => {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const call = {init: init ?? {}, url: String(input)};
    calls.push(call);
    const responder = responders.shift();
    if (!responder) {
      throw new Error(`Unexpected fetch ${call.url}`);
    }
    return responder(call);
  };
  return {calls, fetchImpl};
};

/** Resolve the ApiError a request rejects with; fails the test if it resolves. */
const failureOf = (promise: Promise<unknown>): Promise<ApiError> =>
  promise.then(
    () => {
      throw new Error("Expected the request to fail");
    },
    (error: unknown) => error as ApiError
  );

const headerOf = (call: RecordedCall, name: string): string | null =>
  new Headers(call.init.headers).get(name);

describe("createApiClient.request", () => {
  it("prefixes relative URLs, sends the bearer token, and merges configured headers", async () => {
    const {calls, fetchImpl} = scriptedFetch([() => jsonResponse({data: {email: "a@b.co"}})]);
    const client = createApiClient({
      authProvider: {getToken: async () => "tok-1"},
      baseUrl: "http://api.test/",
      fetchImpl,
      headers: async () => ({"App-Platform": "web", "App-Version": "1.2.3"}),
    });

    const me = await client.request<{email: string}>({url: "/auth/me"});

    expect(me).toEqual({email: "a@b.co"});
    expect(calls[0].url).toBe("http://api.test/auth/me");
    expect(calls[0].init.method).toBe("GET");
    expect(headerOf(calls[0], "Authorization")).toBe("Bearer tok-1");
    expect(headerOf(calls[0], "App-Version")).toBe("1.2.3");
    expect(headerOf(calls[0], "App-Platform")).toBe("web");
  });

  it("leaves absolute URLs alone and omits Authorization when signed out", async () => {
    const {calls, fetchImpl} = scriptedFetch([() => jsonResponse({ok: true})]);
    const client = createApiClient({
      authProvider: {getToken: async () => null},
      baseUrl: "http://api.test",
      credentials: "include",
      fetchImpl,
    });

    await client.request({url: "https://other.test/health"});

    expect(calls[0].url).toBe("https://other.test/health");
    expect(headerOf(calls[0], "Authorization")).toBeNull();
    expect(calls[0].init.credentials).toBe("include");
  });

  it("serializes params the way the qs-based backend parser reads them", async () => {
    const {calls, fetchImpl} = scriptedFetch([() => jsonResponse({data: []})]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    await client.request({
      params: {
        completed: false,
        empty: undefined,
        ids: ["a", "b"],
        limit: 20,
        since: new Date("2026-01-02T03:04:05.000Z"),
        updated: {$gte: "2026-01-01"},
      },
      url: "/todos",
    });

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/todos");
    expect(url.searchParams.get("completed")).toBe("false");
    expect(url.searchParams.has("empty")).toBe(false);
    expect(url.searchParams.getAll("ids")).toEqual(["a", "b"]);
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("updated[$gte]")).toBe("2026-01-01");
    expect(url.searchParams.get("since")).toBe("2026-01-02T03:04:05.000Z");
  });

  it("JSON-encodes object bodies and passes FormData through untouched", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({data: {name: "New"}}),
      () => jsonResponse({data: {url: "gs://x"}}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    await client.request({body: {name: "New"}, method: "PATCH", url: "/auth/me"});
    const form = new FormData();
    form.append("file", "content");
    await client.request({body: form, method: "POST", url: "/files/upload"});

    expect(calls[0].init.body).toBe('{"name":"New"}');
    expect(headerOf(calls[0], "Content-Type")).toBe("application/json");
    expect(calls[1].init.body).toBe(form);
    expect(headerOf(calls[1], "Content-Type")).toBeNull();
  });

  it("unwraps {data} documents, keeps list envelopes, and returns null for 204", async () => {
    const list = {data: [{_id: "1"}], limit: 10, more: false, page: 1, total: 1};
    const {fetchImpl} = scriptedFetch([
      () => jsonResponse({data: {_id: "1"}}),
      () => jsonResponse(list),
      () => new Response(null, {status: 204}),
      () => jsonResponse({data: {_id: "2"}}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    expect(await client.request<unknown>({url: "/todos/1"})).toEqual({_id: "1"});
    expect(await client.request<unknown>({url: "/todos"})).toEqual(list);
    expect(await client.request<unknown>({method: "DELETE", url: "/todos/1"})).toBeNull();
    expect(await client.request<unknown>({unwrap: false, url: "/todos/2"})).toEqual({
      data: {_id: "2"},
    });
  });

  it("throws ApiError with the server's title, detail, and fields", async () => {
    const {fetchImpl} = scriptedFetch([
      () =>
        jsonResponse(
          {detail: "Email taken", fields: {email: "Already used"}, title: "Validation failed"},
          400
        ),
      () => new Response("upstream down", {status: 502, statusText: "Bad Gateway"}),
    ]);
    const errors: ApiError[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl,
      onError: (error) => {
        errors.push(error);
      },
    });

    const first = await failureOf(client.request({method: "POST", url: "/auth/signup"}));
    const second = await failureOf(client.request({url: "/flaky"}));

    expect(first).toBeInstanceOf(ApiError);
    expect(first.status).toBe(400);
    expect(first.message).toBe("Validation failed");
    expect(first.data).toEqual({
      detail: "Email taken",
      fields: {email: "Already used"},
      title: "Validation failed",
    });
    expect(second.status).toBe(502);
    expect(second.data.title).toBe("Bad Gateway");
    expect(errors.map((error) => error.status)).toEqual([400, 502]);
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    let token = "stale";
    let refreshes = 0;
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({data: {_id: "u1"}}),
    ]);
    const client = createApiClient({
      authProvider: {
        getToken: async () => token,
        refresh: async () => {
          refreshes += 1;
          token = "fresh";
          return true;
        },
      },
      baseUrl: "http://api.test",
      fetchImpl,
    });

    expect(await client.request<unknown>({url: "/auth/me"})).toEqual({_id: "u1"});
    expect(refreshes).toBe(1);
    expect(headerOf(calls[0], "Authorization")).toBe("Bearer stale");
    expect(headerOf(calls[1], "Authorization")).toBe("Bearer fresh");
  });

  it("surfaces 401 without looping when refresh fails or is unavailable", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Unauthorized"}, 401),
    ]);
    const refreshing = createApiClient({
      authProvider: {getToken: async () => "t", refresh: async () => false},
      baseUrl: "http://api.test",
      fetchImpl,
    });
    const plain = createApiClient({baseUrl: "http://api.test", fetchImpl});

    const first = await failureOf(refreshing.request({url: "/auth/me"}));
    const second = await failureOf(plain.request({url: "/auth/me"}));

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it("maps timeouts and network failures to status-0 ApiErrors", async () => {
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const offline: FetchLike = async () => {
      throw new TypeError("Network request failed");
    };

    const timedOut = await failureOf(
      createApiClient({baseUrl: "http://api.test", fetchImpl: hanging}).request({
        timeoutMs: 5,
        url: "/slow",
      })
    );
    const failed = await failureOf(
      createApiClient({baseUrl: "http://api.test", fetchImpl: offline}).request({url: "/down"})
    );

    expect(timedOut).toBeInstanceOf(ApiError);
    expect(timedOut.status).toBe(0);
    expect(timedOut.data).toEqual({code: "request-timeout", title: "Request timed out"});
    expect(failed.status).toBe(0);
    expect(failed.data).toEqual({code: "network-error", title: "Network request failed"});
  });
});

describe("createApiClient query cache", () => {
  it("dedupes identical in-flight queries and reuses cached data", async () => {
    const {calls, fetchImpl} = scriptedFetch([() => jsonResponse({data: {_id: "u1"}})]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    const [first, second] = await Promise.all([
      client.fetchQuery({url: "/auth/me"}),
      client.fetchQuery({url: "/auth/me"}),
    ]);
    const third = await client.fetchQuery({url: "/auth/me"});

    expect(first).toEqual({_id: "u1"});
    expect(second).toEqual({_id: "u1"});
    expect(third).toEqual({_id: "u1"});
    expect(calls).toHaveLength(1);
    expect(client.getQueryState({url: "/auth/me"})).toMatchObject({
      data: {_id: "u1"},
      isFetching: false,
      status: "fulfilled",
    });
  });

  it("refetches subscribed queries whose tags are invalidated and drops unsubscribed ones", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({data: {name: "Old"}}),
      () => jsonResponse({data: [{_id: "t"}], more: false}),
      () => jsonResponse({data: {name: "New"}}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});
    const seen: unknown[] = [];

    const unsubscribe = client.subscribeQuery(
      {url: "/auth/me"},
      () => {
        seen.push(client.getQueryState({url: "/auth/me"}).data);
      },
      {providesTags: ["profile"]}
    );
    await client.fetchQuery({url: "/auth/me"});
    await client.fetchQuery({url: "/todos"}, {providesTags: ["profile"]});

    client.invalidateTags(["profile"]);
    await client.fetchQuery({url: "/auth/me"});

    expect(client.getQueryState({url: "/auth/me"}).data).toEqual({name: "New"});
    expect(seen).toContainEqual({name: "New"});
    expect(client.getQueryState({url: "/todos"}).status).toBe("uninitialized");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/auth/me",
      "/todos",
      "/auth/me",
    ]);
    unsubscribe();
  });

  it("keys the cache by params and headers, and reset() clears everything", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({data: {org: "a"}}),
      () => jsonResponse({data: {org: "b"}}),
      () => jsonResponse({data: {org: "a2"}}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    await client.fetchQuery({headers: {"X-Organization-Id": "a"}, url: "/orgs/current"});
    await client.fetchQuery({headers: {"X-Organization-Id": "b"}, url: "/orgs/current"});
    client.reset();
    const after = await client.fetchQuery({
      headers: {"X-Organization-Id": "a"},
      url: "/orgs/current",
    });

    expect(after).toEqual({org: "a2"});
    expect(calls).toHaveLength(3);
  });

  it("stores rejected queries as errors and retries them on force", async () => {
    const {fetchImpl} = scriptedFetch([
      () => jsonResponse({title: "Nope"}, 500),
      () => jsonResponse({data: {ok: true}}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    const failure = await failureOf(client.fetchQuery({url: "/x"}));
    const state = client.getQueryState({url: "/x"});
    const recovered = await client.fetchQuery({url: "/x"}, {force: true});

    expect(failure.status).toBe(500);
    expect(state.status).toBe("rejected");
    expect((state.error as ApiError).data.title).toBe("Nope");
    expect(recovered).toEqual({ok: true});
  });
});

describe("apiFetch edge behavior", () => {
  it("parses text and blob bodies and sends null params as empty values", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => new Response("plain", {headers: {"Content-Type": "text/plain"}}),
      () => new Response("csv,data", {headers: {"Content-Type": "text/csv"}}),
      () => new Response("bytes"),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    const implicitText = await client.request<string>({params: {cursor: null}, url: "/a"});
    const explicitText = await client.request<string>({parseAs: "text", url: "/b"});
    const blob = await client.request<Blob>({parseAs: "blob", url: "/c"});

    expect(implicitText).toBe("plain");
    expect(explicitText).toBe("csv,data");
    expect(await blob.text()).toBe("bytes");
    expect(calls[0].url).toBe("http://api.test/a?cursor=");
  });

  it("keeps code and meta from error bodies and recognizes ApiError instances", async () => {
    const {fetchImpl} = scriptedFetch([
      () => jsonResponse({code: "rate-limited", meta: {retryAfter: 30}, title: "Slow down"}, 429),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    const error = await failureOf(client.request({url: "/busy"}));

    expect(isApiError(error)).toBe(true);
    expect(isApiError(new Error("plain"))).toBe(false);
    expect(error.data).toEqual({code: "rate-limited", meta: {retryAfter: 30}, title: "Slow down"});
  });

  it("aborts when the caller's signal fires, including one that already fired", async () => {
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const reported: ApiError[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetchImpl: hanging,
      onError: (error) => {
        reported.push(error);
      },
    });
    const live = new AbortController();
    const done = new AbortController();
    done.abort();

    const pending = failureOf(client.request({signal: live.signal, url: "/slow"}));
    live.abort();

    const cancelled = await pending;
    expect(cancelled.status).toBe(0);
    expect(cancelled.data).toEqual({code: "request-aborted", title: "Request cancelled"});
    expect((await failureOf(client.request({signal: done.signal, url: "/slow"}))).status).toBe(0);
    expect(reported).toEqual([]);
  });
});

describe("query cache lifetime", () => {
  it("drops unsubscribed entries after keepUnusedDataMs and keeps subscribed ones", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({data: {n: 1}}),
      () => jsonResponse({data: {n: 2}}),
      () => jsonResponse({data: {n: 3}}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl, keepUnusedDataMs: 5});

    await client.fetchQuery({url: "/kept"});
    const unsubscribe = client.subscribeQuery({url: "/kept"}, () => {});
    await client.fetchQuery({url: "/dropped"});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.getQueryState({url: "/kept"}).data).toEqual({n: 1});
    expect(client.getQueryState({url: "/dropped"}).status).toBe("uninitialized");
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.getQueryState({url: "/kept"}).status).toBe("uninitialized");
    expect(await client.fetchQuery<unknown>({url: "/kept"})).toEqual({n: 3});
    expect(calls).toHaveLength(3);
  });
});

describe("auth refresh edges", () => {
  it("does not refresh again when the retried request is still unauthorized", async () => {
    let refreshes = 0;
    const errors: ApiError[] = [];
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({title: "Unauthorized"}, 401),
      () => jsonResponse({title: "Session revoked"}, 401),
    ]);
    const client = createApiClient({
      authProvider: {
        getToken: async () => "t",
        refresh: async () => {
          refreshes += 1;
          return true;
        },
      },
      baseUrl: "http://api.test",
      fetchImpl,
      onError: (error) => {
        errors.push(error);
      },
    });

    const error = await failureOf(client.request({url: "/auth/me"}));

    expect(error.data.title).toBe("Session revoked");
    expect(refreshes).toBe(1);
    expect(calls).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it("shares one refresh between concurrent unauthorized requests", async () => {
    let token = "stale";
    let refreshes = 0;
    const fetchImpl: FetchLike = async (_input, init) => {
      const auth = new Headers(init?.headers).get("Authorization");
      return auth === "Bearer fresh"
        ? jsonResponse({data: {ok: true}})
        : jsonResponse({title: "Unauthorized"}, 401);
    };
    const client = createApiClient({
      authProvider: {
        getToken: async () => token,
        refresh: async () => {
          refreshes += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          token = "fresh";
          return true;
        },
      },
      baseUrl: "http://api.test",
      fetchImpl,
    });

    const results = await Promise.all([
      client.request<unknown>({url: "/a"}),
      client.request<unknown>({url: "/b"}),
      client.request<unknown>({url: "/c"}),
    ]);

    expect(results).toEqual([{ok: true}, {ok: true}, {ok: true}]);
    expect(refreshes).toBe(1);
  });
});

describe("query cache races and keys", () => {
  const deferredFetch = (): {
    fetchImpl: FetchLike;
    resolveNext: (body: unknown) => void;
    count: () => number;
  } => {
    const pending: Array<(response: Response) => void> = [];
    let count = 0;
    return {
      count: () => count,
      fetchImpl: () => {
        count += 1;
        return new Promise((resolve) => {
          pending.push(resolve);
        });
      },
      resolveNext: (body) => {
        pending.shift()?.(jsonResponse(body));
      },
    };
  };

  it("ignores a response that lands after reset() so it cannot repopulate the cache", async () => {
    const backend = deferredFetch();
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl: backend.fetchImpl});

    const inFlight = client.fetchQuery({url: "/auth/me"});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.count()).toBe(1);
    client.reset();
    backend.resolveNext({data: {_id: "previous-user"}});
    await inFlight;

    expect(client.getQueryState({url: "/auth/me"}).status).toBe("uninitialized");
  });

  it("keeps the newest refetch when an invalidation overtakes an in-flight request", async () => {
    const backend = deferredFetch();
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl: backend.fetchImpl});
    const unsubscribe = client.subscribeQuery({url: "/auth/me"}, () => {}, {providesTags: ["me"]});

    const first = client.fetchQuery({url: "/auth/me"}, {providesTags: ["me"]});
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.invalidateTags(["me"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    backend.resolveNext({data: {name: "stale"}});
    backend.resolveNext({data: {name: "fresh"}});
    await first;
    await client.fetchQuery({url: "/auth/me"});

    expect(backend.count()).toBe(2);
    expect(client.getQueryState({url: "/auth/me"}).data).toEqual({name: "fresh"});
    unsubscribe();
  });

  it("keys cached POST queries by JSON body", async () => {
    const {calls, fetchImpl} = scriptedFetch([
      () => jsonResponse({data: ["a"]}),
      () => jsonResponse({data: ["b"]}),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});

    const first = await client.fetchQuery<unknown>({
      body: {q: "a"},
      method: "POST",
      url: "/search",
    });
    const second = await client.fetchQuery<unknown>({
      body: {q: "b"},
      method: "POST",
      url: "/search",
    });

    expect(first).toEqual(["a"]);
    expect(second).toEqual(["b"]);
    expect(calls).toHaveLength(2);
  });
});

describe("apiFetch called directly", () => {
  it("cancels an in-flight request when the caller's signal fires after it started", async () => {
    let started: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
        started();
      });
    const caller = new AbortController();

    const pending = failureOf(apiFetch({fetchImpl: hanging, signal: caller.signal, url: "/slow"}));
    await fetchStarted;
    caller.abort();

    const error = await pending;
    expect(error.status).toBe(0);
    expect(error.data).toEqual({code: "request-aborted", title: "Request cancelled"});
  });

  it("uses the global fetch when no fetchImpl is given", async () => {
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return jsonResponse({ok: true});
    }) as typeof fetch;
    try {
      const {result} = await apiFetch({params: {q: "a"}, url: "http://api.test/search"});

      expect(result).toEqual({ok: true});
      expect(seen).toEqual(["http://api.test/search?q=a"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to the status text when a JSON error body is malformed or untitled", async () => {
    const {fetchImpl} = scriptedFetch([
      () =>
        new Response("{not json", {
          headers: {"Content-Type": "application/json"},
          status: 502,
          statusText: "Bad Gateway",
        }),
      () => jsonResponse({detail: "no title"}, 503),
    ]);

    const malformed = await failureOf(apiFetch({fetchImpl, url: "/a"}));
    const untitled = await failureOf(apiFetch({fetchImpl, url: "/b"}));

    expect(malformed.status).toBe(502);
    expect(malformed.data).toEqual({title: "Bad Gateway"});
    expect(untitled.data).toEqual({title: "Request failed (503)"});
  });
});

describe("tag invalidation failures", () => {
  it("records a failed refetch on the subscribed entry without an unhandled rejection", async () => {
    const {fetchImpl} = scriptedFetch([
      () => jsonResponse({data: {name: "Ada"}}),
      () => jsonResponse({title: "Gone"}, 500),
    ]);
    const client = createApiClient({baseUrl: "http://api.test", fetchImpl});
    const args = {url: "/auth/me"};
    let notified = 0;
    const unsubscribe = client.subscribeQuery(
      args,
      () => {
        notified += 1;
      },
      {providesTags: ["profile"]}
    );
    await client.fetchQuery(args, {providesTags: ["profile"]});

    client.invalidateTags(["profile"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = client.getQueryState<{name: string}>(args);
    expect(state.status).toBe("rejected");
    expect((state.error as ApiError).data.title).toBe("Gone");
    expect(state.data).toEqual({name: "Ada"});
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
    client.reset();
  });
});
