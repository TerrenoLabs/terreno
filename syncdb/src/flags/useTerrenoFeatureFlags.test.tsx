import "fake-indexeddb/auto";
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {OpenFeatureProvider, useBooleanFlagValue} from "@openfeature/react-sdk";
import {NOOP_PROVIDER, OpenFeature} from "@openfeature/web-sdk";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import React, {StrictMode} from "react";

import {createSyncDb, type SyncDb} from "../client";
import {memoryPersisterFactory} from "../persisters/memoryPersister";
import {ApiClientProvider} from "../react/apiHooks";
import {SyncDbProvider} from "../react/provider";
import {createFakeTransport, type FakeTransport} from "../testing/fakeTransport";
import {boolDef, createFlagTestServer} from "./flagTestServer";
import {useTerrenoFeatureFlags} from "./useTerrenoFeatureFlags";

let nameCounter = 0;

const makeSyncDb = (): {syncDb: SyncDb; transport: FakeTransport} => {
  nameCounter += 1;
  const transport = createFakeTransport();
  const syncDb = createSyncDb({
    authProvider: {
      getToken: async () => "token",
      getUserId: async () => "u1",
      onAuthChange: () => () => {},
    },
    collections: ["todos"],
    name: `flags-${nameCounter}`,
    persisterFactory: memoryPersisterFactory,
    reconcileIntervalMs: 0,
    transport,
  });
  return {syncDb, transport};
};

describe("useTerrenoFeatureFlags", () => {
  beforeEach(async () => {
    await OpenFeature.setProviderAndWait("feature-flags", NOOP_PROVIDER);
    await OpenFeature.setProviderAndWait("custom-ff", NOOP_PROVIDER);
  });

  afterEach(async () => {
    await OpenFeature.setProviderAndWait("feature-flags", NOOP_PROVIDER);
    await OpenFeature.setProviderAndWait("custom-ff", NOOP_PROVIDER);
  });

  it("loads flagConfiguration through the request client into OpenFeature", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(server.requests).toEqual(["GET /feature-flags/flagConfiguration"]);
    expect(result.current.client.getBooleanValue("alpha", false)).toBe(true);
    expect(result.current.flags.alpha?.defaultVariant).toBe("on");
  });

  it("uses the client from ApiClientProvider and a custom basePath", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result} = renderHook(
      () => useTerrenoFeatureFlags({basePath: "/flags", socket: null, userId: "u1"}),
      {
        wrapper: ({children}: {children: React.ReactNode}) => (
          <ApiClientProvider client={server.client}>{children}</ApiClientProvider>
        ),
      }
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(server.requests).toEqual(["GET /flags/flagConfiguration"]);
  });

  it("refetches for a new user instead of reusing the previous user's flags", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {rerender, result} = renderHook(
      ({userId}: {userId: string}) =>
        useTerrenoFeatureFlags({client: server.client, socket: null, userId}),
      {initialProps: {userId: "u1"}}
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    server.setConfig({alpha: boolDef("off")});
    rerender({userId: "u2"});
    await waitFor(() => {
      expect(server.requests).toHaveLength(2);
    });
    await waitFor(() => {
      expect(result.current.client.getBooleanValue("alpha", true)).toBe(false);
    });
  });

  it("does not request or report loading when skip is true", () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, skip: true, socket: null, userId: "u1"})
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.flags).toEqual({});
    expect(server.requests).toEqual([]);
  });

  it("does not leave loading stuck when the request fails", async () => {
    const server = createFlagTestServer();
    server.failNext(500);
    const {result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("reports loading while the first request and later refetches are in flight", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    server.hold();
    const {result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      server.release();
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    server.hold();
    let refetching: Promise<unknown> | undefined;
    act(() => {
      refetching = result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });
    await act(async () => {
      server.release();
      await refetching;
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("isolates domains so a custom domain does not read another domain's provider", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, domain: "custom-ff", socket: null})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(OpenFeature.getClient().getBooleanValue("alpha", false)).toBe(false);
    expect(result.current.client.getBooleanValue("alpha", false)).toBe(true);
  });

  it("refetches and applies new values when the syncdb socket pushes featureFlagsChanged", async () => {
    const server = createFlagTestServer({alpha: boolDef("off")});
    const {syncDb, transport} = makeSyncDb();
    const {result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, socket: syncDb, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.client.getBooleanValue("alpha", true)).toBe(false);

    server.setConfig({alpha: boolDef("on")});
    act(() => {
      transport.emitEvent("featureFlagsChanged", {key: "alpha"});
    });
    await waitFor(() => {
      expect(result.current.client.getBooleanValue("alpha", false)).toBe(true);
    });
    expect(server.requests).toHaveLength(2);
  });

  it("listens on the SyncDbProvider client by default and honors socketEventName", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {syncDb, transport} = makeSyncDb();
    const {result} = renderHook(
      () => useTerrenoFeatureFlags({client: server.client, socketEventName: "flags:changed"}),
      {
        wrapper: ({children}: {children: React.ReactNode}) => (
          <SyncDbProvider client={syncDb}>{children}</SyncDbProvider>
        ),
      }
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(transport.eventListenerCount("flags:changed")).toBe(1);
    act(() => {
      transport.emitEvent("featureFlagsChanged");
    });
    expect(server.requests).toHaveLength(1);
    act(() => {
      transport.emitEvent("flags:changed");
    });
    await waitFor(() => {
      expect(server.requests).toHaveLength(2);
    });
  });

  it("does not bind the socket while skipped", () => {
    const server = createFlagTestServer();
    const {syncDb, transport} = makeSyncDb();
    renderHook(() => useTerrenoFeatureFlags({client: server.client, skip: true, socket: syncDb}));
    expect(transport.eventListenerCount("featureFlagsChanged")).toBe(0);
  });

  it("returns a stable refetch callback", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {rerender, result} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    const firstRefetch = result.current.refetch;
    await act(async () => {
      await firstRefetch();
    });
    expect(server.requests).toHaveLength(2);
    rerender(undefined);
    expect(result.current.refetch).toBe(firstRefetch);
  });

  it("survives React StrictMode double-mount", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result} = renderHook(
      () => useTerrenoFeatureFlags({client: server.client, socket: null, userId: "u1"}),
      {
        wrapper: ({children}: {children: React.ReactNode}) => <StrictMode>{children}</StrictMode>,
      }
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.client.getBooleanValue("alpha", false)).toBe(true);
  });

  it("feeds OpenFeature React hooks under OpenFeatureProvider", async () => {
    const server = createFlagTestServer({"demo-flag": boolDef("on")});
    const {result} = renderHook(
      () => {
        useTerrenoFeatureFlags({client: server.client, socket: null, userId: "u1"});
        return useBooleanFlagValue("demo-flag", false);
      },
      {
        wrapper: ({children}: {children: React.ReactNode}) => (
          <OpenFeatureProvider domain="feature-flags">{children}</OpenFeatureProvider>
        ),
      }
    );
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});

describe("useTerrenoFeatureFlags ref-count cleanup", () => {
  /** Dedicated domain so other test files do not hold extra hook refs. */
  const domain = "terreno-refcount-test-isolation";

  beforeEach(async () => {
    await OpenFeature.setProviderAndWait(domain, NOOP_PROVIDER);
  });

  afterEach(async () => {
    await OpenFeature.setProviderAndWait(domain, NOOP_PROVIDER);
  });

  const readAlpha = (): boolean => OpenFeature.getClient(domain).getBooleanValue("alpha", false);

  it("installs the NOOP provider after an unmount that overlaps the provider switch", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result, unmount} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, domain, socket: null, userId: "u-fast"})
    );
    await waitFor(() => {
      expect(result.current.flags.alpha).toBeDefined();
    });
    // Unmount right after data arrives, while setProviderAndWait may still be pending.
    unmount();
    await waitFor(() => {
      expect(readAlpha()).toBe(false);
    });
  });

  it("installs the NOOP provider after the last instance unmounts", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {unmount} = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, domain, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(readAlpha()).toBe(true);
    });
    unmount();
    await waitFor(() => {
      expect(readAlpha()).toBe(false);
    });
  });

  it("keeps the provider while another instance is still mounted", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const first = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, domain, socket: null, userId: "u1"})
    );
    const second = renderHook(() =>
      useTerrenoFeatureFlags({client: server.client, domain, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(readAlpha()).toBe(true);
    });
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readAlpha()).toBe(true);
    second.unmount();
    await waitFor(() => {
      expect(readAlpha()).toBe(false);
    });
  });
});
