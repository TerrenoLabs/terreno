import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {NOOP_PROVIDER, OpenFeature} from "@openfeature/web-sdk";
import {act, renderHook, waitFor} from "@testing-library/react-native";

import {boolDef, createFlagTestServer} from "./flagTestServer";
import {useFeatureFlags} from "./useFeatureFlags";

const findDebug = (calls: unknown[][], message: string): unknown[] | undefined =>
  calls.find((args) => args[0] === message);

describe("useFeatureFlags", () => {
  const debugCalls: unknown[][] = [];
  const originalDebug = console.debug;

  beforeEach(async () => {
    debugCalls.length = 0;
    console.debug = (...args: unknown[]): void => {
      debugCalls.push(args);
    };
    await OpenFeature.setProviderAndWait("feature-flags", NOOP_PROVIDER);
  });

  afterEach(async () => {
    console.debug = originalDebug;
    await OpenFeature.setProviderAndWait("feature-flags", NOOP_PROVIDER);
  });

  it("requests the default flagConfiguration path", async () => {
    const server = createFlagTestServer({foo: boolDef("on")});
    const {result} = renderHook(() =>
      useFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(server.requests).toEqual(["GET /feature-flags/flagConfiguration"]);
  });

  it("projects the configuration to each flag's default-variant value", async () => {
    const server = createFlagTestServer({
      b1: boolDef("on"),
      missing: {defaultVariant: "gone", disabled: false, variants: {on: true}},
      v1: {
        defaultVariant: "compact",
        disabled: false,
        variants: {compact: "compact", detailed: "detailed"},
      },
    });
    const {result} = renderHook(() =>
      useFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.flags).toEqual({b1: true, missing: null, v1: "compact"});
  });

  it("returns accessors that read boolean and string values", async () => {
    const server = createFlagTestServer({
      booleanOff: boolDef("off"),
      booleanOn: boolDef("on"),
      variantFlag: {
        defaultVariant: "variant-a",
        disabled: false,
        variants: {compact: "compact", "variant-a": "variant-a"},
      },
    });
    const {result} = renderHook(() =>
      useFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.getFlag("booleanOn")).toBe(true);
    expect(result.current.getFlag("booleanOff")).toBe(false);
    expect(result.current.getFlag("variantFlag")).toBe(false);
    expect(result.current.getVariant("variantFlag")).toBe("variant-a");
    expect(result.current.getVariant("booleanOn")).toBeNull();
    expect(result.current.getVariant("missing")).toBeNull();
  });

  it("returns an empty flags map while the first request is in flight", async () => {
    const server = createFlagTestServer({foo: boolDef("on")});
    server.hold();
    const {result} = renderHook(() =>
      useFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    expect(result.current.flags).toEqual({});
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      server.release();
    });
  });

  it("refetches through the returned refetch", async () => {
    const server = createFlagTestServer({foo: boolDef("on")});
    const {result} = renderHook(() =>
      useFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(server.requests).toHaveLength(2);
    });
  });

  it("logs when a flagConfiguration request starts and completes", async () => {
    const server = createFlagTestServer({alpha: boolDef("on")});
    const {result} = renderHook(() =>
      useFeatureFlags({client: server.client, socket: null, userId: "u1"})
    );
    expect(findDebug(debugCalls, "[feature-flags] flagConfiguration request started")).toEqual([
      "[feature-flags] flagConfiguration request started",
      {basePath: "/feature-flags"},
    ]);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await waitFor(() => {
      expect(
        findDebug(debugCalls, "[feature-flags] flagConfiguration request completed")
      ).toBeDefined();
    });
  });

  it("logs when a flagConfiguration request fails", async () => {
    const server = createFlagTestServer();
    server.failNext(503);
    const {result} = renderHook(() =>
      useFeatureFlags({basePath: "/flags", client: server.client, socket: null, userId: "u1"})
    );
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
    await waitFor(() => {
      expect(
        findDebug(debugCalls, "[feature-flags] flagConfiguration request failed")
      ).toBeDefined();
    });
    expect(server.requests).toEqual(["GET /flags/flagConfiguration"]);
  });
});
