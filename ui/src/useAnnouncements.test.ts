import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
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
import {type AnnouncementPublic, useAnnouncements} from "./useAnnouncements";

const feedItem: AnnouncementPublic = {
  body: "Body",
  id: "feed-1",
  priority: 0,
  requiresAcknowledgement: false,
  title: "Feed",
  version: 1,
};

describe("useAnnouncements", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    constantsState.expoConfig.extra.buildNumber = undefined;
    Platform.OS = originalOS;
  });

  it("unwraps pending and feed payloads", async () => {
    const {client} = createFakeRequestClient({
      "GET /api/announcements/feed": () => ({data: [feedItem]}),
      "GET /api/announcements/pending": () => ({data: {current: null, remainingCount: 0}}),
    });
    const {result} = renderHook(() => useAnnouncements(client, "/api"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.pending?.remainingCount).toBe(0));
    await waitFor(() => expect(result.current.feed).toHaveLength(1));
    expect(result.current.feed[0]?.id).toBe("feed-1");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFeedLoading).toBe(false);
  });

  it("accepts bare payloads from clients that already unwrap envelopes", async () => {
    const {client} = createFakeRequestClient({
      "GET /announcements/feed": () => [feedItem],
      "GET /announcements/pending": () => ({current: null, remainingCount: 2}),
    });
    const {result} = renderHook(() => useAnnouncements(client));
    await waitFor(() => expect(result.current.pending?.remainingCount).toBe(2));
    await waitFor(() => expect(result.current.feed).toHaveLength(1));
  });

  it("returns an empty feed when the feed envelope has no data", async () => {
    const {client} = createFakeRequestClient({
      "GET /announcements/feed": () => ({}),
      "GET /announcements/pending": () => ({current: null, remainingCount: 0}),
    });
    const {result} = renderHook(() => useAnnouncements(client));
    await waitFor(() => expect(result.current.isFeedLoading).toBe(false));
    expect(result.current.feed).toEqual([]);
  });

  it("surfaces pending errors without treating feed errors as blocking", async () => {
    const pendingFailure = fakeHttpError(500, "pending failed");
    const feedFailure = fakeHttpError(500, "feed failed");
    const {client} = createFakeRequestClient({
      "GET /announcements/feed": () => {
        throw feedFailure;
      },
      "GET /announcements/pending": () => {
        throw pendingFailure;
      },
    });
    const {result} = renderHook(() => useAnnouncements(client));
    await waitFor(() => expect(result.current.error).toBe(pendingFailure));
    await waitFor(() => expect(result.current.feedError).toBe(feedFailure));
  });

  it("keeps feed errors separate from pending errors", async () => {
    const feedFailure = fakeHttpError(500, "feed failed");
    const {client} = createFakeRequestClient({
      "GET /announcements/feed": () => {
        throw feedFailure;
      },
      "GET /announcements/pending": () => ({current: null, remainingCount: 0}),
    });
    const {result} = renderHook(() => useAnnouncements(client));
    await waitFor(() => expect(result.current.feedError).toBe(feedFailure));
    expect(result.current.error).toBeUndefined();
  });

  it("sends platform, version, and feed paging params when build number is valid", async () => {
    constantsState.expoConfig.extra.buildNumber = 42;
    Platform.OS = "ios";
    const {client, callsTo} = createFakeRequestClient({
      "GET /api/announcements/feed": () => [],
      "GET /api/announcements/pending": () => ({current: null, remainingCount: 0}),
    });
    const {result} = renderHook(() => useAnnouncements(client, "/api", {limit: 5, page: 2}));
    await waitFor(() => expect(result.current.isFeedLoading).toBe(false));
    expect(callsTo("GET /api/announcements/pending")[0]?.params).toEqual({
      platform: "ios",
      version: 42,
    });
    expect(callsTo("GET /api/announcements/feed")[0]?.params).toEqual({
      limit: 5,
      page: 2,
      platform: "ios",
      version: 42,
    });
  });

  it("omits version and defaults feed paging when build number is invalid", async () => {
    constantsState.expoConfig.extra.buildNumber = "invalid";
    Platform.OS = "web";
    const {client, calls} = createFakeRequestClient({
      "GET /announcements/feed": () => [],
      "GET /announcements/pending": () => ({current: null, remainingCount: 0}),
    });
    const {result} = renderHook(() => useAnnouncements(client));
    await waitFor(() => expect(result.current.isFeedLoading).toBe(false));
    for (const call of calls) {
      expect(call.params && "version" in call.params).toBe(false);
    }
    expect(calls.find((call) => call.url === "/announcements/feed")?.params).toEqual({
      limit: 20,
      page: 1,
      platform: "web",
    });
  });

  it("refetches the pending announcement after an acknowledgement", async () => {
    let remainingCount = 1;
    const {client, callsTo} = createFakeRequestClient({
      "GET /announcements/feed": () => [],
      "GET /announcements/pending": () => ({current: null, remainingCount}),
      "POST /announcements/:id/acknowledge": () => ({acknowledged: true}),
    });
    const {result} = renderHook(() => ({
      ack: useAcknowledgeAnnouncement(client),
      announcements: useAnnouncements(client),
    }));
    await waitFor(() => expect(result.current.announcements.pending?.remainingCount).toBe(1));

    remainingCount = 0;
    await act(async () => {
      await result.current.ack.acknowledge("announcement-1");
    });
    await waitFor(() => expect(result.current.announcements.pending?.remainingCount).toBe(0));
    expect(callsTo("GET /announcements/pending")).toHaveLength(2);
    expect(callsTo("GET /announcements/feed")).toHaveLength(1);
  });
});
