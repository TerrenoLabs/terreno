import {afterEach, beforeEach, describe, it} from "bun:test";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import React, {useLayoutEffect, useState} from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminProvider} from "./AdminProvider";
import type {AdminRequestArgs} from "./adminRequest";
import type {AdminRpc} from "./adminRpc";
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

type SeedModule = typeof import("./adminRpcSeed");

interface SeedQueryState {
  data: unknown;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

interface SeedQueryOptions {
  headers?: Record<string, string>;
  keepPreviousData?: boolean;
  providesTags?: readonly string[];
  skip?: boolean;
  transformResponse?: (result: unknown) => unknown;
  url: string;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

// The seed module is loaded lazily so the pre-existing tests above still run while it is missing.
describe("useAdminRpcQuery with AdminRpcSeed", () => {
  let seedModule: SeedModule;

  beforeEach(async () => {
    seedModule = await import("./adminRpcSeed");
  });

  const ROLES = [{name: "admin"}, {name: "viewer"}];

  interface CommittedRender {
    data: unknown;
    isLoading: boolean;
    org: string | undefined;
  }

  interface Setup {
    commits: CommittedRender[];
    getCalls: () => AdminRequestArgs[];
    renders: SeedQueryState[];
    setOptions: (next: SeedQueryOptions) => void;
    trigger: () => {unwrap: () => Promise<unknown>};
  }

  const setup = async ({
    options,
    respond = () => ({fetched: true}),
    seeds,
  }: {
    options: SeedQueryOptions;
    respond?: (args: AdminRequestArgs) => unknown;
    seeds?: Record<string, unknown>[];
  }): Promise<Setup> => {
    const calls: AdminRequestArgs[] = [];
    const rpc: AdminRpc = async (args) => {
      if ((args.method ?? "GET") === "GET") {
        calls.push(args);
      }
      return respond(args);
    };
    const renders: SeedQueryState[] = [];
    const commits: CommittedRender[] = [];
    let setOptions: (next: SeedQueryOptions) => void = () => undefined;
    let trigger: Setup["trigger"] = () => ({unwrap: async () => undefined});
    const Harness: React.FC = () => {
      const [current, setCurrent] = useState(options);
      setOptions = setCurrent;
      const state = useAdminRpcQuery({...current, rpc}) as SeedQueryState;
      renders.push(state);
      const org = current.headers?.["X-Organization-Id"];
      // Records what each committed render showed, so a transient stale frame cannot hide.
      useLayoutEffect(() => {
        commits.push({data: state.data, isLoading: state.isLoading, org});
      });
      const [mutate] = useAdminRpcMutation(rpc, {invalidatesTags: ["roles"]});
      trigger = () => mutate({method: "POST", url: "/admin/roles"});
      return null;
    };
    let tree = (
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <Harness />
      </AdminProvider>
    );
    for (const data of [...(seeds ?? [])].reverse()) {
      const Seed = seedModule.AdminRpcSeed;
      tree = <Seed data={data}>{tree}</Seed>;
    }
    renderWithTheme(tree);
    await flush();
    return {
      commits,
      getCalls: () => calls,
      renders,
      setOptions: (next) => setOptions(next),
      trigger: () => trigger(),
    };
  };

  it("returns the seeded body on first render without calling rpc", async () => {
    const t = await setup({
      options: {url: "/admin/roles"},
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    assert.strictEqual(t.renders[0]?.data, ROLES);
    assert.isFalse(t.renders[0]?.isLoading);
    assert.lengthOf(t.getCalls(), 0);
  });

  it("loads and calls rpc once for a URL that is not seeded", async () => {
    const t = await setup({
      options: {url: "/admin/other"},
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    assert.isTrue(t.renders[0]?.isLoading);
    assert.isUndefined(t.renders[0]?.data);
    assert.lengthOf(t.getCalls(), 1);
  });

  it("calls rpc once on refetch and updates data", async () => {
    const t = await setup({
      options: {url: "/admin/roles"},
      respond: () => ["fresh"],
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    await act(async () => {
      void t.renders.at(-1)?.refetch();
    });
    await flush();
    assert.lengthOf(t.getCalls(), 1);
    assert.deepEqual(t.renders.at(-1)?.data, ["fresh"]);
  });

  it("treats a different query string as unseeded (exact match)", async () => {
    const t = await setup({
      options: {url: "/admin/roles?page=2"},
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    assert.isTrue(t.renders[0]?.isLoading);
    assert.isUndefined(t.renders[0]?.data);
    assert.lengthOf(t.getCalls(), 1);
  });

  it("fetches when the url changes from a seeded url to an unseeded one", async () => {
    const t = await setup({
      options: {url: "/admin/roles"},
      respond: () => ["page2"],
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    assert.lengthOf(t.getCalls(), 0);
    await act(async () => {
      t.setOptions({url: "/admin/roles?page=2"});
    });
    await flush();
    assert.lengthOf(t.getCalls(), 1);
    assert.equal(t.getCalls()[0]?.url, "/admin/roles?page=2");
    assert.deepEqual(t.renders.at(-1)?.data, ["page2"]);
  });

  it("does not satisfy an org-scoped hook with a seed stored without the header", async () => {
    const t = await setup({
      options: {headers: {"X-Organization-Id": "o1"}, url: "/orgs/o1/members"},
      seeds: [{[seedModule.adminRpcSeedKey("/orgs/o1/members")]: ["m"]}],
    });
    assert.isTrue(t.renders[0]?.isLoading);
    assert.isUndefined(t.renders[0]?.data);
    assert.lengthOf(t.getCalls(), 1);
  });

  it("does not satisfy a hook scoped to another org", async () => {
    const t = await setup({
      options: {headers: {"X-Organization-Id": "o2"}, url: "/orgs/members"},
      seeds: [
        {
          [seedModule.adminRpcSeedKey("/orgs/members", {"X-Organization-Id": "o1"})]: ["m"],
        },
      ],
    });
    assert.isTrue(t.renders[0]?.isLoading);
    assert.isUndefined(t.renders[0]?.data);
    assert.lengthOf(t.getCalls(), 1);
  });

  it("satisfies a hook scoped to the same org", async () => {
    const members = ["m"];
    const t = await setup({
      options: {headers: {"X-Organization-Id": "o1"}, url: "/orgs/members"},
      seeds: [
        {
          [seedModule.adminRpcSeedKey("/orgs/members", {"X-Organization-Id": "o1"})]: members,
        },
      ],
    });
    assert.strictEqual(t.renders[0]?.data, members);
    assert.isFalse(t.renders[0]?.isLoading);
    assert.lengthOf(t.getCalls(), 0);
  });

  it("returns no data and does not fetch when seeded but skipped", async () => {
    const t = await setup({
      options: {skip: true, url: "/admin/roles"},
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    assert.isUndefined(t.renders[0]?.data);
    assert.isUndefined(t.renders.at(-1)?.data);
    assert.lengthOf(t.getCalls(), 0);
  });

  it("applies transformResponse to the seed", async () => {
    const items = [{id: 1}, {id: 2}];
    const t = await setup({
      options: {
        transformResponse: (body) => (body as {items: unknown[]}).items,
        url: "/admin/roles",
      },
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: {items}}],
    });
    assert.deepEqual(t.renders[0]?.data, items);
    assert.isFalse(t.renders[0]?.isLoading);
    assert.lengthOf(t.getCalls(), 0);
  });

  it("refetches once when a mutation invalidates a seeded query's tags", async () => {
    const t = await setup({
      options: {providesTags: ["roles"], url: "/admin/roles"},
      respond: () => ["after-mutation"],
      seeds: [{[seedModule.adminRpcSeedKey("/admin/roles")]: ROLES}],
    });
    assert.lengthOf(t.getCalls(), 0);
    await act(async () => {
      await t.trigger().unwrap();
    });
    await flush();
    assert.lengthOf(t.getCalls(), 1);
    assert.deepEqual(t.renders.at(-1)?.data, ["after-mutation"]);
  });

  it("lets an inner seed win over an outer one and keeps outer-only keys visible", async () => {
    const aKey = seedModule.adminRpcSeedKey("/a");
    const bKey = seedModule.adminRpcSeedKey("/b");
    const inner = await setup({
      options: {url: "/a"},
      seeds: [{[aKey]: 1, [bKey]: "outer-b"}, {[aKey]: 2}],
    });
    assert.equal(inner.renders[0]?.data, 2);
    assert.lengthOf(inner.getCalls(), 0);
    const outerOnly = await setup({
      options: {url: "/b"},
      seeds: [{[aKey]: 1, [bKey]: "outer-b"}, {[aKey]: 2}],
    });
    assert.equal(outerOnly.renders[0]?.data, "outer-b");
    assert.lengthOf(outerOnly.getCalls(), 0);
  });

  it("refetches under the new org when the org header changes on a mounted seeded hook", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const o2 = {"X-Organization-Id": "o2"};
    const t = await setup({
      options: {headers: o1, url: "/m"},
      respond: (args) =>
        `${(args.headers as Record<string, string> | undefined)?.["X-Organization-Id"]}-fetched`,
      seeds: [{[seedModule.adminRpcSeedKey("/m", o1)]: "o1-body"}],
    });
    assert.equal(t.renders.at(-1)?.data, "o1-body");
    assert.lengthOf(t.getCalls(), 0);
    const switchedAt = t.renders.length;
    await act(async () => {
      t.setOptions({headers: o2, url: "/m"});
    });
    await flush();
    assert.lengthOf(t.getCalls(), 1);
    assert.deepEqual(t.getCalls()[0]?.headers, o2);
    assert.equal(t.renders.at(-1)?.data, "o2-fetched");
    const settledAt = t.renders.findIndex((r, i) => i >= switchedAt && r.data === "o2-fetched");
    assert.isAtLeast(settledAt, 0);
    for (const render of t.renders.slice(settledAt)) {
      assert.notEqual(render.data, "o1-body");
    }
  });

  it("refetches when an org header is added to a mounted hook seeded without one", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const t = await setup({
      options: {url: "/m"},
      respond: () => "scoped-fetched",
      seeds: [{[seedModule.adminRpcSeedKey("/m")]: "unscoped-body"}],
    });
    assert.equal(t.renders.at(-1)?.data, "unscoped-body");
    assert.lengthOf(t.getCalls(), 0);
    await act(async () => {
      t.setOptions({headers: o1, url: "/m"});
    });
    await flush();
    assert.lengthOf(t.getCalls(), 1);
    assert.deepEqual(t.getCalls()[0]?.headers, o1);
    assert.equal(t.renders.at(-1)?.data, "scoped-fetched");
  });

  it("loads again when returning to the seeded url after leaving it", async () => {
    const t = await setup({
      options: {url: "/s"},
      respond: (args) => `fetched:${args.url}`,
      seeds: [{[seedModule.adminRpcSeedKey("/s")]: "seed-s"}],
    });
    assert.equal(t.renders.at(-1)?.data, "seed-s");
    assert.lengthOf(t.getCalls(), 0);
    await act(async () => {
      t.setOptions({url: "/r"});
    });
    await flush();
    assert.deepEqual(
      t.getCalls().map((c) => c.url),
      ["/r"]
    );
    await act(async () => {
      t.setOptions({url: "/s"});
    });
    await flush();
    assert.deepEqual(
      t.getCalls().map((c) => c.url),
      ["/r", "/s"]
    );
    assert.equal(t.renders.at(-1)?.data, "fetched:/s");
  });

  it("never commits a render under o2 that shows the seeded o1 body", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const o2 = {"X-Organization-Id": "o2"};
    const t = await setup({
      options: {headers: o1, url: "/m"},
      respond: (args) =>
        `${(args.headers as Record<string, string> | undefined)?.["X-Organization-Id"]}-fetched`,
      seeds: [{[seedModule.adminRpcSeedKey("/m", o1)]: "o1-body"}],
    });
    assert.equal(t.commits.at(-1)?.data, "o1-body");
    await act(async () => {
      t.setOptions({headers: o2, url: "/m"});
    });
    await flush();
    const o2Commits = t.commits.filter((c) => c.org === "o2");
    assert.isAbove(o2Commits.length, 0);
    for (const commit of o2Commits) {
      assert.notEqual(commit.data, "o1-body", "an o2 render showed the o1 seed");
    }
    assert.lengthOf(t.getCalls(), 1);
    assert.deepEqual(t.getCalls()[0]?.headers, o2);
    assert.equal(t.commits.at(-1)?.data, "o2-fetched");
  });

  it("refetches for o1 after o1 -> o2 -> o1 and never shows the o2 body under o1", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const o2 = {"X-Organization-Id": "o2"};
    const t = await setup({
      options: {headers: o1, url: "/m"},
      respond: (args) =>
        `${(args.headers as Record<string, string> | undefined)?.["X-Organization-Id"]}-fetched`,
      seeds: [{[seedModule.adminRpcSeedKey("/m", o1)]: "o1-body"}],
    });
    await act(async () => {
      t.setOptions({headers: o2, url: "/m"});
    });
    await flush();
    assert.equal(t.commits.at(-1)?.data, "o2-fetched");
    await act(async () => {
      t.setOptions({headers: o1, url: "/m"});
    });
    await flush();
    assert.deepEqual(
      t
        .getCalls()
        .map((c) => (c.headers as Record<string, string> | undefined)?.["X-Organization-Id"]),
      ["o2", "o1"]
    );
    for (const commit of t.commits.filter((c) => c.org === "o1")) {
      assert.notEqual(commit.data, "o2-fetched", "an o1 render showed the o2 body");
    }
    assert.equal(t.commits.at(-1)?.data, "o1-fetched");
  });

  it("never commits a render under o2 that shows an unseeded o1 fetch", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const o2 = {"X-Organization-Id": "o2"};
    const t = await setup({
      options: {headers: o1, url: "/m"},
      respond: (args) =>
        `${(args.headers as Record<string, string> | undefined)?.["X-Organization-Id"]}-fetched`,
    });
    assert.equal(t.commits.at(-1)?.data, "o1-fetched");
    await act(async () => {
      t.setOptions({headers: o2, url: "/m"});
    });
    await flush();
    const o2Commits = t.commits.filter((c) => c.org === "o2");
    assert.isAbove(o2Commits.length, 0);
    assert.isTrue(o2Commits[0]?.isLoading, "first o2 render is not loading");
    for (const commit of o2Commits) {
      assert.notEqual(commit.data, "o1-fetched", "an o2 render showed the o1 body");
    }
    assert.equal(t.commits.at(-1)?.data, "o2-fetched");
  });

  it("drops a keepPreviousData body and loads when the org changes on the same url", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const o2 = {"X-Organization-Id": "o2"};
    const t = await setup({
      options: {headers: o1, keepPreviousData: true, url: "/m"},
      respond: (args) =>
        (args.headers as Record<string, string> | undefined)?.["X-Organization-Id"] === "o2"
          ? "B"
          : "A",
    });
    assert.equal(t.commits.at(-1)?.data, "A");
    assert.isFalse(t.commits.at(-1)?.isLoading);
    await act(async () => {
      t.setOptions({headers: o2, keepPreviousData: true, url: "/m"});
    });
    await flush();
    const o2Commits = t.commits.filter((c) => c.org === "o2");
    assert.isAbove(o2Commits.length, 0);
    for (const commit of o2Commits) {
      assert.notEqual(commit.data, "A", "an o2 render kept the o1 body");
    }
    assert.isTrue(o2Commits[0]?.isLoading, "first o2 render is not loading");
    assert.deepEqual(t.getCalls().at(-1)?.headers, o2);
    assert.equal(t.commits.at(-1)?.data, "B");
  });

  it("reports loading on every o2 render until the o2 fetch resolves", async () => {
    const o1 = {"X-Organization-Id": "o1"};
    const o2 = {"X-Organization-Id": "o2"};
    let resolveO2: (value: unknown) => void = () => undefined;
    const o2Body = new Promise<unknown>((resolve) => {
      resolveO2 = resolve;
    });
    const t = await setup({
      options: {headers: o1, url: "/m"},
      respond: (args) =>
        (args.headers as Record<string, string> | undefined)?.["X-Organization-Id"] === "o2"
          ? o2Body
          : "o1-fetched",
    });
    assert.equal(t.commits.at(-1)?.data, "o1-fetched");
    await act(async () => {
      t.setOptions({headers: o2, url: "/m"});
    });
    await flush();
    assert.deepEqual(t.getCalls().at(-1)?.headers, o2);
    const pendingO2Commits = t.commits.filter((c) => c.org === "o2");
    assert.isAbove(pendingO2Commits.length, 0);
    for (const commit of pendingO2Commits) {
      assert.isTrue(commit.isLoading, "an o2 render before the o2 fetch resolved was not loading");
      assert.isUndefined(commit.data);
    }
    await act(async () => {
      resolveO2("o2-fetched");
    });
    await flush();
    assert.equal(t.commits.at(-1)?.data, "o2-fetched");
    assert.isFalse(t.commits.at(-1)?.isLoading);
  });

  it("behaves as before when there is no AdminRpcSeed in the tree", async () => {
    const t = await setup({options: {url: "/admin/roles"}, respond: () => ["live"]});
    assert.isTrue(t.renders[0]?.isLoading);
    assert.isUndefined(t.renders[0]?.data);
    assert.lengthOf(t.getCalls(), 1);
    assert.deepEqual(t.renders.at(-1)?.data, ["live"]);
    assert.isFalse(t.renders.at(-1)?.isLoading);
  });
});

describe("adminRpcSeedKey", () => {
  let key: SeedModule["adminRpcSeedKey"];

  beforeEach(async () => {
    key = (await import("./adminRpcSeed")).adminRpcSeedKey;
  });

  it("differs when an X-Organization-Id header is sent", () => {
    assert.notEqual(key("/a"), key("/a", {"X-Organization-Id": "o1"}));
  });

  it("differs between org ids", () => {
    assert.notEqual(key("/a", {"X-Organization-Id": "o1"}), key("/a", {"X-Organization-Id": "o2"}));
  });

  it("keeps the query string in the key", () => {
    assert.notEqual(key("/a"), key("/a?page=2"));
  });

  it("ignores other header names", () => {
    assert.equal(key("/a"), key("/a", {"X-Other": "o1"}));
    assert.equal(key("/a"), key("/a", {}));
  });

  it("reads the org header from Headers, tuple arrays, and any name casing", () => {
    const expected = key("/a", {"X-Organization-Id": "o1"});
    assert.equal(key("/a", new Headers({"X-Organization-Id": "o1"})), expected);
    assert.equal(key("/a", [["X-Organization-Id", "o1"]]), expected);
    assert.equal(key("/a", {"x-organization-id": "o1"}), expected);
    assert.equal(key("/a", [["x-ORGANIZATION-id", "o1"]]), expected);
    assert.equal(key("/a", new Headers({"x-organization-id": "o1"})), expected);
  });
});
