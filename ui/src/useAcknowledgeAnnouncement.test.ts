import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {Platform} from "react-native";

const constantsState = {
  expoConfig: {
    extra: {
      buildNumber: undefined as number | string | undefined,
    },
  },
};

mock.module("expo-constants", () => ({
  default: constantsState,
}));

import {createFakeRequestClient, fakeHttpError} from "./test-utils";
import {useAcknowledgeAnnouncement} from "./useAcknowledgeAnnouncement";

const buildClient = (): ReturnType<typeof createFakeRequestClient> =>
  createFakeRequestClient({
    "POST /api/announcements/:id/acknowledge": () => ({acknowledged: true}),
    "POST /api/announcements/:id/click": () => ({recorded: true}),
    "POST /api/announcements/:id/impression": () => ({recorded: true}),
  });

describe("useAcknowledgeAnnouncement", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    constantsState.expoConfig.extra.buildNumber = undefined;
    Platform.OS = originalOS;
  });

  it("acknowledges and records impressions", async () => {
    const {client, callsTo} = buildClient();
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client, "/api"));
    await act(async () => {
      await result.current.acknowledge("announcement-1");
      await result.current.recordImpression("announcement-1");
    });
    expect(callsTo("POST /api/announcements/announcement-1/acknowledge")).toHaveLength(1);
    expect(callsTo("POST /api/announcements/announcement-1/impression")).toHaveLength(1);
    expect(result.current.isSubmitting).toBe(false);
  });

  it("uses the client platform for impressions", async () => {
    Platform.OS = "ios";
    const {client, calls} = buildClient();
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client, "/api"));
    await act(async () => {
      await result.current.recordImpression("announcement-1");
    });
    expect(calls).toEqual([
      {
        body: {platform: "ios"},
        method: "POST",
        url: "/api/announcements/announcement-1/impression",
      },
    ]);
  });

  it("records primary-action clicks with platform and build version in the query", async () => {
    constantsState.expoConfig.extra.buildNumber = 42;
    Platform.OS = "web";
    const {client, calls} = buildClient();
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client, "/api"));
    await act(async () => {
      await result.current.recordClick("announcement-42");
    });
    expect(calls).toEqual([
      {
        body: {action: "primaryAction", platform: "web"},
        method: "POST",
        params: {platform: "web", version: 42},
        url: "/api/announcements/announcement-42/click",
      },
    ]);
  });

  it("omits version from click params when build number is not finite", async () => {
    Platform.OS = "android";
    const {client, calls} = buildClient();
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client, "/api"));
    await act(async () => {
      await result.current.recordClick("announcement-1");
    });
    expect(calls[0]?.params).toEqual({platform: "android"});
    expect(calls[0]?.body).toEqual({action: "primaryAction", platform: "android"});
  });

  it("posts acknowledge with platform and build version in the query", async () => {
    constantsState.expoConfig.extra.buildNumber = 42;
    Platform.OS = "ios";
    const {client, calls} = buildClient();
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client, "/api"));
    await act(async () => {
      await result.current.acknowledge("announcement-42");
    });
    expect(calls).toEqual([
      {
        method: "POST",
        params: {platform: "ios", version: 42},
        url: "/api/announcements/announcement-42/acknowledge",
      },
    ]);
  });

  it("omits version from acknowledge params when build number is not finite", async () => {
    constantsState.expoConfig.extra.buildNumber = "invalid";
    Platform.OS = "web";
    const {client, calls} = createFakeRequestClient({
      "POST /announcements/:id/acknowledge": () => ({acknowledged: true}),
    });
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client));
    await act(async () => {
      await result.current.acknowledge("announcement-1");
    });
    expect(calls[0]?.url).toBe("/announcements/announcement-1/acknowledge");
    expect(calls[0]?.params).toEqual({platform: "web"});
  });

  it("exposes the failing request error", async () => {
    const failure = fakeHttpError(500);
    const {client} = createFakeRequestClient({
      "POST /announcements/:id/click": () => {
        throw failure;
      },
    });
    const {result} = renderHook(() => useAcknowledgeAnnouncement(client));
    await act(async () => {
      await result.current.recordClick("announcement-1").catch(() => {});
    });
    expect(result.current.error).toBe(failure);
  });
});
