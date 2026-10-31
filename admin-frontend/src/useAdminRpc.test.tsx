import {afterEach, describe, it} from "bun:test";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import React, {useState} from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminProvider} from "./AdminProvider";
import type {AdminApi} from "./types";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "./useAdminRpc";

const api = {} as unknown as AdminApi;

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

  it("returns undefined rpc outside a fetch-capable provider", () => {
    let rpc: unknown;
    renderWithTheme(
      <AdminProvider api={api} apiBase="/admin" routeBase="/admin">
        <Probe
          onValue={(value) => {
            rpc = value;
          }}
          renderValue={useAdminRpc}
        />
      </AdminProvider>
    );
    assert.isUndefined(rpc);
  });

  it("skips queries when rpc is missing or skip is true", () => {
    let state: {isLoading?: boolean; data?: unknown} | undefined;
    renderWithTheme(
      <AdminProvider api={api} apiBase="/admin" routeBase="/admin">
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
    globalThis.fetch = (async (_url: string) => {
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
        api={api}
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
      latest.refetch();
      await Promise.resolve();
    });
    assert.isOk(latest.error);
  });

  it("drops the previous body and reports loading when the URL changes", async () => {
    let gets = 0;
    let resolveNext: ((response: Response) => void) | undefined;
    globalThis.fetch = (async (_url: string) => {
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
        api={api}
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

  it("reports loading when returning to a URL before the other one finishes", async () => {
    let gets = 0;
    globalThis.fetch = (async (_url: string) => {
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
        api={api}
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
        api={api}
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
        api={api}
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
