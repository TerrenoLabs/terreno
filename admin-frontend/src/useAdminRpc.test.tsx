import {afterEach, describe, it} from "bun:test";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import React, {useState} from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminProvider} from "./AdminProvider";
import {
  resetAdminRpcWarningForTests,
  unwrapAdminEnvelope,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "./useAdminRpc";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

const Probe: React.FC<{onValue: (value: unknown) => void; renderValue: () => unknown}> = ({
  onValue,
  renderValue,
}) => {
  onValue(renderValue());
  return null;
};

describe("useAdminRpc", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("binds a client inside AdminProvider even without auth options", async () => {
    const calls: {credentials?: RequestCredentials; url: string}[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({credentials: init?.credentials, url: String(url)});
      return jsonResponse({ok: true});
    }) as typeof fetch;
    let rpc: ((args: {url: string}) => Promise<unknown>) | undefined;
    renderWithTheme(
      <AdminProvider apiBase="/admin" apiOrigin="http://api.test" routeBase="/admin">
        <Probe
          onValue={(value) => {
            rpc = value as typeof rpc;
          }}
          renderValue={useAdminRpc}
        />
      </AdminProvider>
    );
    assert.isFunction(rpc);
    const result = await rpc?.({url: "/admin/config"});
    assert.deepEqual(result, {ok: true});
    assert.deepEqual(calls, [{credentials: undefined, url: "http://api.test/admin/config"}]);
  });

  it("falls back to a same-origin client outside AdminProvider and warns once", async () => {
    resetAdminRpcWarningForTests();
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return jsonResponse({ok: true});
    }) as typeof fetch;
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]): void => {
      warnings.push(String(args[0]));
    };
    const clients: unknown[] = [];
    try {
      renderWithTheme(
        <>
          <Probe onValue={(value) => clients.push(value)} renderValue={useAdminRpc} />
          <Probe onValue={(value) => clients.push(value)} renderValue={useAdminRpc} />
        </>
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.lengthOf(clients, 2);
    assert.strictEqual(clients[0], clients[1]);
    assert.lengthOf(
      warnings.filter((warning) => warning.includes("outside AdminProvider")),
      1
    );
    const rpc = clients[0] as (args: {url: string}) => Promise<unknown>;
    assert.deepEqual(await rpc({url: "/admin/config"}), {ok: true});
    assert.deepEqual(urls, ["/admin/config"]);
  });

  it("unwraps single-document envelopes and keeps list envelopes", () => {
    const list = {data: [{_id: "a"}], limit: 20, more: false, page: 1, total: 1};
    assert.strictEqual(unwrapAdminEnvelope(list), list);
    assert.deepEqual(unwrapAdminEnvelope({data: {_id: "a"}}), {_id: "a"});
    assert.deepEqual(unwrapAdminEnvelope({updated: 2}), {updated: 2});
    assert.deepEqual(unwrapAdminEnvelope({data: null}), {data: null});
    assert.deepEqual(unwrapAdminEnvelope([1, 2]), [1, 2]);
    assert.isNull(unwrapAdminEnvelope(null));
    assert.equal(unwrapAdminEnvelope("text"), "text");
  });

  it("sends query headers, transforms responses, and resolves refetch results", async () => {
    const seen: {headers: Headers; url: string}[] = [];
    let calls = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls += 1;
      seen.push({headers: new Headers(init?.headers), url: String(url)});
      if (calls === 2) {
        return jsonResponse({title: "Nope"}, 500);
      }
      return jsonResponse({data: {_id: "doc-1", n: calls}});
    }) as typeof fetch;

    let latest:
      | {
          data?: {_id: string; n: number};
          isError: boolean;
          refetch: () => Promise<{data?: unknown; error?: unknown; isError: boolean}>;
        }
      | undefined;
    const Harness: React.FC = () => {
      const rpc = useAdminRpc();
      latest = useAdminRpcQuery<{_id: string; n: number}>({
        headers: {"X-Organization-Id": "org-1"},
        rpc,
        transformResponse: unwrapAdminEnvelope,
        url: "/admin/foods/doc-1",
      });
      return null;
    };
    renderWithTheme(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(latest?.data, {_id: "doc-1", n: 1});
    assert.equal(seen[0]?.headers.get("X-Organization-Id"), "org-1");

    let failedPromise: Promise<{error?: unknown; isError: boolean}> | undefined;
    await act(async () => {
      failedPromise = latest?.refetch();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const failed = await failedPromise;
    assert.isTrue(failed?.isError);
    assert.isTrue(latest?.isError);

    let succeededPromise: Promise<{data?: unknown; isError: boolean}> | undefined;
    await act(async () => {
      succeededPromise = latest?.refetch();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const succeeded = await succeededPromise;
    assert.isFalse(succeeded?.isError);
    assert.deepEqual(succeeded?.data, {_id: "doc-1", n: 3});
  });

  it("resolves refetch immediately when the query is skipped", async () => {
    let latest: {refetch: () => Promise<{isError: boolean}>} | undefined;
    const Harness: React.FC = () => {
      latest = useAdminRpcQuery({rpc: undefined, skip: true, url: "/x"});
      return null;
    };
    renderWithTheme(<Harness />);
    let resultPromise: Promise<{isError: boolean}> | undefined;
    await act(async () => {
      resultPromise = latest?.refetch();
    });
    const result = await resultPromise;
    assert.deepEqual(result, {isError: false});
  });

  it("transforms mutation responses before unwrap resolves", async () => {
    globalThis.fetch = (async () => jsonResponse({data: {_id: "new"}})) as typeof fetch;
    let trigger:
      | ((args: {method: "POST"; url: string}) => {unwrap: () => Promise<unknown>})
      | undefined;
    const Harness: React.FC = () => {
      const rpc = useAdminRpc();
      const [mutate] = useAdminRpcMutation(rpc, {transformResponse: unwrapAdminEnvelope});
      trigger = mutate;
      return null;
    };
    renderWithTheme(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <Harness />
      </AdminProvider>
    );
    let created: unknown;
    await act(async () => {
      created = await trigger?.({method: "POST", url: "/admin/foods"}).unwrap();
    });
    assert.deepEqual(created, {_id: "new"});
  });

  it("skips queries when rpc is missing or skip is true", () => {
    let state: {isLoading?: boolean; data?: unknown} | undefined;
    renderWithTheme(
      <AdminProvider apiBase="/admin" routeBase="/admin">
        <Probe
          onValue={(value) => {
            state = value as {isLoading?: boolean; data?: unknown};
          }}
          renderValue={() => useAdminRpcQuery({rpc: undefined, skip: true, url: "/x"})}
        />
      </AdminProvider>
    );
    assert.isFalse(state?.isLoading);
    assert.isUndefined(state?.data);
  });

  it("loads GET data, surfaces errors, and refetches", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ok: true}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        });
      }
      return new Response("nope", {status: 500});
    }) as typeof fetch;

    let latest: {
      data?: {ok: boolean};
      error?: unknown;
      refetch: () => void;
    } = {refetch: () => undefined};

    const Harness: React.FC = () => {
      const rpc = useAdminRpc();
      latest = useAdminRpcQuery<{ok: boolean}>({rpc, url: "/ping"});
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(latest.data, {ok: true});

    await act(async () => {
      void latest.refetch();
      await Promise.resolve();
    });
    assert.isOk(latest.error);
  });

  it("drops the previous body and reports loading when the URL changes", async () => {
    let gets = 0;
    let resolveNext: ((response: Response) => void) | undefined;
    globalThis.fetch = (async () => {
      gets += 1;
      if (gets > 1) {
        return await new Promise<Response>((resolve) => {
          resolveNext = resolve;
        });
      }
      return new Response(JSON.stringify({name: "Ada"}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;

    let setUrl: ((next: string) => void) | undefined;
    let queryState: {data?: {name: string}; isLoading: boolean} | undefined;
    const Harness: React.FC = () => {
      const [url, setNextUrl] = useState("/users/a");
      setUrl = setNextUrl;
      const rpc = useAdminRpc();
      queryState = useAdminRpcQuery<{name: string}>({rpc, url});
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    assert.equal(gets, 1);
    assert.deepEqual(queryState?.data, {name: "Ada"});
    assert.isFalse(queryState?.isLoading);

    await act(async () => {
      setUrl?.("/users/b");
    });
    assert.isUndefined(queryState?.data);
    assert.isTrue(queryState?.isLoading);

    await act(async () => {
      resolveNext?.(
        new Response(JSON.stringify({name: "Bea"}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        })
      );
      await Promise.resolve();
    });
    assert.equal(gets, 2);
    assert.deepEqual(queryState?.data, {name: "Bea"});
    assert.isFalse(queryState?.isLoading);
  });

  it("keeps the previous body, not loading, while a keepPreviousData query pages", async () => {
    let gets = 0;
    let resolveNext: ((response: Response) => void) | undefined;
    globalThis.fetch = (async () => {
      gets += 1;
      if (gets > 1) {
        return await new Promise<Response>((resolve) => {
          resolveNext = resolve;
        });
      }
      return new Response(JSON.stringify({page: 1}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;

    let setUrl: ((next: string) => void) | undefined;
    let queryState: {data?: {page: number}; isFetching: boolean; isLoading: boolean} | undefined;
    const Harness: React.FC = () => {
      const [url, setNextUrl] = useState("/list?page=1");
      setUrl = setNextUrl;
      const rpc = useAdminRpc();
      queryState = useAdminRpcQuery<{page: number}>({keepPreviousData: true, rpc, url});
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(queryState?.data, {page: 1});
    assert.isFalse(queryState?.isLoading);

    await act(async () => {
      setUrl?.("/list?page=2");
    });
    // Page 1 stays on screen while page 2 is in flight.
    assert.deepEqual(queryState?.data, {page: 1});
    assert.isFalse(queryState?.isLoading);
    assert.isTrue(queryState?.isFetching);

    await act(async () => {
      resolveNext?.(
        new Response(JSON.stringify({page: 2}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        })
      );
      await Promise.resolve();
    });
    assert.deepEqual(queryState?.data, {page: 2});
    assert.isFalse(queryState?.isFetching);
  });

  it("reports loading when returning to a URL before the other one finishes", async () => {
    let gets = 0;
    globalThis.fetch = (async () => {
      gets += 1;
      if (gets > 1) {
        return await new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({name: "Ada"}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;

    let setUrl: ((next: string) => void) | undefined;
    let queryState: {data?: {name: string}; isLoading: boolean} | undefined;
    const Harness: React.FC = () => {
      const [url, setNextUrl] = useState("/users/a");
      setUrl = setNextUrl;
      const rpc = useAdminRpc();
      queryState = useAdminRpcQuery<{name: string}>({rpc, url});
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(queryState?.data, {name: "Ada"});

    await act(async () => {
      setUrl?.("/users/b");
    });
    await act(async () => {
      setUrl?.("/users/a");
    });
    assert.equal(gets, 3);
    assert.isUndefined(queryState?.data);
    assert.isTrue(queryState?.isLoading);
  });

  it("refetches mounted queries after a successful tagged mutation", async () => {
    let gets = 0;
    let resolveRefetch: ((response: Response) => void) | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({saved: true}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        });
      }
      gets += 1;
      if (gets === 2) {
        return await new Promise<Response>((resolve) => {
          resolveRefetch = resolve;
        });
      }
      return new Response(JSON.stringify({n: gets}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;

    let trigger:
      | ((args: {method: "POST"; url: string}) => {unwrap: () => Promise<unknown>})
      | undefined;
    let queryState:
      | {
          data?: {n: number};
          isFetching: boolean;
          isLoading: boolean;
        }
      | undefined;
    const tags = ["items"] as const;
    const Harness: React.FC = () => {
      const rpc = useAdminRpc();
      queryState = useAdminRpcQuery<{n: number}>({providesTags: tags, rpc, url: "/items"});
      const [mutate] = useAdminRpcMutation(rpc, {invalidatesTags: tags});
      trigger = mutate;
      return null;
    };

    const rendered = renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    assert.equal(gets, 1);

    await act(async () => {
      await trigger?.({method: "POST", url: "/items"}).unwrap();
      await Promise.resolve();
    });
    assert.equal(gets, 2);
    assert.deepEqual(queryState?.data, {n: 1});
    assert.isFalse(queryState?.isLoading);
    assert.isTrue(queryState?.isFetching);

    await act(async () => {
      resolveRefetch?.(
        new Response(JSON.stringify({n: 2}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        })
      );
      await Promise.resolve();
    });
    assert.deepEqual(queryState?.data, {n: 2});
    assert.isFalse(queryState?.isFetching);
    rendered.unmount();
  });

  it("polls on an interval and mutations unwrap or throw", async () => {
    let gets = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({saved: true}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        });
      }
      gets += 1;
      return new Response(JSON.stringify({n: gets}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;

    let trigger:
      | ((args: {method: "POST"; url: string}) => {unwrap: () => Promise<unknown>})
      | undefined;
    let missingRpcTrigger:
      | ((args: {method: "POST"; url: string}) => {unwrap: () => Promise<unknown>})
      | undefined;

    const Harness: React.FC = () => {
      const rpc = useAdminRpc();
      useAdminRpcQuery({pollingInterval: 20, rpc, url: "/poll"});
      const [mutate] = useAdminRpcMutation(rpc);
      const [mutateMissing] = useAdminRpcMutation(undefined);
      trigger = mutate;
      missingRpcTrigger = mutateMissing;
      return null;
    };

    const rendered = renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.isAtLeast(gets, 2);

    const saved = await trigger?.({method: "POST", url: "/save"}).unwrap();
    assert.deepEqual(saved, {saved: true});

    let threw = false;
    try {
      await missingRpcTrigger?.({method: "POST", url: "/save"}).unwrap();
    } catch (err) {
      threw = true;
      assert.include(String(err), "unavailable");
    }
    assert.isTrue(threw);
    rendered.unmount();
  });
});
