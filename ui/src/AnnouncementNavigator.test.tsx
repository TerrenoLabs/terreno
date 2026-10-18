import {beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {DateTime} from "luxon";
import React, {useCallback, useState} from "react";
import {Linking, Text} from "react-native";
import {AnnouncementNavigator} from "./AnnouncementNavigator";
import * as announcementFrequency from "./announcementFrequency";
import {
  buildFrequencyStorageKey,
  resetFrequencySessionStateForTests,
} from "./announcementFrequency";
import {Box} from "./Box";
import {TextField} from "./TextField";
import {renderWithTheme} from "./test-utils";
import {Unifier} from "./Unifier";
import {
  type AnnouncementPublic,
  type PendingAnnouncementsResponse,
  useAnnouncements,
} from "./useAnnouncements";

const makeAnnouncement = (overrides: Partial<AnnouncementPublic> = {}): AnnouncementPublic => ({
  body: "## Update\n\nWe shipped announcements.",
  displayMode: "modal",
  id: "announcement-1",
  priority: 1,
  requiresAcknowledgement: true,
  title: "What is new",
  version: 1,
  ...overrides,
});

const createMockApi = (
  pending: PendingAnnouncementsResponse | (() => PendingAnnouncementsResponse),
  refetchOverride?: () => Promise<void>,
  feedItems: AnnouncementPublic[] = [],
  clickUnwrap: () => Promise<unknown> = async () => ({data: {recorded: true}}),
  overrides: {
    acknowledgeUnwrap?: () => Promise<unknown>;
    impressionUnwrap?: () => Promise<unknown>;
  } = {}
) => {
  const getPending =
    typeof pending === "function" ? pending : (): PendingAnnouncementsResponse => pending;
  const refetch = refetchOverride ?? mock(() => Promise.resolve());
  const acknowledgeUnwrap =
    overrides.acknowledgeUnwrap ?? (async (): Promise<unknown> => ({data: {acknowledged: true}}));
  const impressionUnwrap =
    overrides.impressionUnwrap ?? (async (): Promise<unknown> => ({data: {recorded: true}}));
  const acknowledgeMutation = mock(() => ({
    unwrap: mock(acknowledgeUnwrap),
  }));
  const impressionMutation = mock(() => ({
    unwrap: mock(impressionUnwrap),
  }));
  const clickMutation = mock(() => ({
    unwrap: mock(clickUnwrap),
  }));

  const innerApi = {
    injectEndpoints: mock((_config: unknown) => ({
      useAcknowledgeAnnouncementMutation: mock(() => [
        acknowledgeMutation,
        {error: undefined, isLoading: false},
      ]),
      useGetAnnouncementFeedQuery: mock(() => ({
        data: {data: feedItems},
        error: undefined,
        isLoading: false,
        refetch,
      })),
      useGetPendingAnnouncementsQuery: mock(() => ({
        data: {data: getPending()},
        error: undefined,
        isLoading: false,
        refetch,
      })),
      useRecordAnnouncementClickMutation: mock(() => [
        clickMutation,
        {error: undefined, isLoading: false},
      ]),
      useRecordAnnouncementImpressionMutation: mock(() => [
        impressionMutation,
        {error: undefined, isLoading: false},
      ]),
    })),
  };

  return {
    acknowledgeMutation,
    api: {
      enhanceEndpoints: mock(() => innerApi),
    },
    clickMutation,
    impressionMutation,
    refetch,
  };
};

const announcementQueue: PendingAnnouncementsResponse[] = [
  {
    current: makeAnnouncement({id: "announcement-1", title: "First update"}),
    remainingCount: 1,
  },
  {
    current: makeAnnouncement({id: "announcement-2", title: "Second update"}),
    remainingCount: 0,
  },
  {current: null, remainingCount: 0},
];

const waitForFrequencyCheck = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const createNavigatorStorageMock = (): {
  getItem: ReturnType<typeof mock>;
  setItem: ReturnType<typeof mock>;
} => {
  const store = new Map<string, unknown>();
  return {
    getItem: mock(async (key: string) => store.get(key) ?? null),
    setItem: mock(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
};

describe("AnnouncementNavigator", () => {
  beforeEach(() => {
    resetFrequencySessionStateForTests();
    const storage = createNavigatorStorageMock();
    Unifier.storage.getItem = storage.getItem;
    Unifier.storage.setItem = storage.setItem;
  });

  it("renders children when no announcements are pending", () => {
    const {api} = createMockApi({current: null, remainingCount: 0});
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    expect(result.getByTestId("app-content")).toBeTruthy();
  });

  it("hides children while a modal announcement is pending", async () => {
    const {api, impressionMutation} = createMockApi({
      current: makeAnnouncement({displayMode: "modal"}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    await waitForFrequencyCheck();
    expect(result.getByTestId("announcement-screen")).toBeTruthy();
    assert.isNull(result.queryByTestId("app-content"));
    expect(impressionMutation).toHaveBeenCalledTimes(1);
  });

  it("refetches after acknowledge when more announcements remain", async () => {
    const {api, refetch, acknowledgeMutation} = createMockApi({
      current: makeAnnouncement({id: "announcement-1", title: "First"}),
      remainingCount: 1,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
    });

    expect(acknowledgeMutation).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the next announcement after refetch advances the queue", async () => {
    const QueueHarness: React.FC = () => {
      const [queueIndex, setQueueIndex] = useState(0);
      const refetch = useCallback(async (): Promise<void> => {
        setQueueIndex((currentIndex) => Math.min(currentIndex + 1, announcementQueue.length - 1));
      }, []);
      const {api} = createMockApi(() => announcementQueue[queueIndex], refetch);

      return (
        <AnnouncementNavigator api={api} frequency={{maxInterruptionsPerSession: 5}}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
    };

    const result = renderWithTheme(<QueueHarness />);
    await waitForFrequencyCheck();
    expect(result.getByText("First update")).toBeTruthy();

    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
    });
    await waitForFrequencyCheck();

    expect(result.getByText("Second update")).toBeTruthy();

    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
    });

    expect(result.getByTestId("app-content")).toBeTruthy();
    expect(result.queryByTestId("announcement-screen")).toBeNull();
  });

  it("renders a loading spinner while pending announcements load", () => {
    const innerApi = {
      injectEndpoints: mock(() => ({
        useAcknowledgeAnnouncementMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useGetAnnouncementFeedQuery: mock(() => ({
          data: undefined,
          error: undefined,
          isLoading: true,
          refetch: mock(() => Promise.resolve()),
        })),
        useGetPendingAnnouncementsQuery: mock(() => ({
          data: undefined,
          error: undefined,
          isLoading: true,
          refetch: mock(() => Promise.resolve()),
        })),
        useRecordAnnouncementClickMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useRecordAnnouncementImpressionMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
      })),
    };
    const result = renderWithTheme(
      <AnnouncementNavigator api={{enhanceEndpoints: mock(() => innerApi)}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    expect(result.getByTestId("announcement-navigator-loading")).toBeTruthy();
  });

  it("shows retry UI for recoverable pending errors", () => {
    const refetch = mock(() => Promise.resolve());
    const innerApi = {
      injectEndpoints: mock(() => ({
        useAcknowledgeAnnouncementMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useGetAnnouncementFeedQuery: mock(() => ({
          data: {data: []},
          error: undefined,
          isLoading: false,
          refetch,
        })),
        useGetPendingAnnouncementsQuery: mock(() => ({
          data: undefined,
          error: {status: 500},
          isLoading: false,
          refetch,
        })),
        useRecordAnnouncementClickMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useRecordAnnouncementImpressionMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
      })),
    };
    const onError = mock(() => undefined);
    const result = renderWithTheme(
      <AnnouncementNavigator api={{enhanceEndpoints: mock(() => innerApi)}} onError={onError}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    expect(result.getByTestId("announcement-navigator-error")).toBeTruthy();
    expect(onError).toHaveBeenCalled();
  });

  it("renders children when only the feed request fails", () => {
    const innerApi = {
      injectEndpoints: mock(() => ({
        useAcknowledgeAnnouncementMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useGetAnnouncementFeedQuery: mock(() => ({
          data: undefined,
          error: {status: 500},
          isLoading: false,
          refetch: mock(() => Promise.resolve()),
        })),
        useGetPendingAnnouncementsQuery: mock(() => ({
          data: {data: {current: null, remainingCount: 0}},
          error: undefined,
          isLoading: false,
          refetch: mock(() => Promise.resolve()),
        })),
        useRecordAnnouncementClickMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useRecordAnnouncementImpressionMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
      })),
    };
    const result = renderWithTheme(
      <AnnouncementNavigator api={{enhanceEndpoints: mock(() => innerApi)}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    expect(result.getByTestId("app-content")).toBeTruthy();
    expect(result.queryByTestId("announcement-navigator-error")).toBeNull();
  });

  it("keeps children mounted and shows a banner for banner announcements", async () => {
    const {api, impressionMutation} = createMockApi({
      current: makeAnnouncement({displayMode: "banner", requiresAcknowledgement: false}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    expect(result.getByTestId("app-content")).toBeTruthy();
    expect(result.getByTestId("announcement-banner")).toBeTruthy();
    expect(result.queryByTestId("announcement-screen")).toBeNull();
    expect(impressionMutation).toHaveBeenCalledTimes(1);
  });

  it("preserves child input state when a banner is dismissed", async () => {
    const StatefulInput: React.FC = () => {
      const [value, setValue] = useState("");
      return <TextField onChange={setValue} testID="todo-input" title="New Todo" value={value} />;
    };

    const BannerDismissHarness: React.FC = () => {
      const [pending, setPending] = useState<PendingAnnouncementsResponse>({
        current: makeAnnouncement({displayMode: "banner", requiresAcknowledgement: false}),
        remainingCount: 0,
      });
      const refetch = useCallback(async (): Promise<void> => {
        setPending({current: null, remainingCount: 0});
      }, []);
      const {api} = createMockApi(pending, refetch);

      return (
        <AnnouncementNavigator api={api} frequency={{maxInterruptionsPerSession: 5}}>
          <Box testID="app-content">
            <StatefulInput />
          </Box>
        </AnnouncementNavigator>
      );
    };

    const result = renderWithTheme(<BannerDismissHarness />);
    await waitForFrequencyCheck();
    expect(result.getByTestId("announcement-banner")).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(result.getByTestId("todo-input"), "unsaved text");
    });
    expect(result.getByTestId("todo-input").props.value).toBe("unsaved text");

    await act(async () => {
      fireEvent.press(result.getByText("Dismiss"));
      await Promise.resolve();
    });

    expect(result.queryByTestId("announcement-banner")).toBeNull();
    expect(result.getByTestId("todo-input").props.value).toBe("unsaved text");
  });

  it("ignores unexpected feed displayMode items in pending.current", () => {
    const {api} = createMockApi({
      current: makeAnnouncement({displayMode: "feed"}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    expect(result.getByTestId("app-content")).toBeTruthy();
    assert.isNull(result.queryByTestId("announcement-banner"));
    assert.isNull(result.queryByTestId("announcement-screen"));
  });

  it("does not show a second interrupt in the same session when maxInterruptionsPerSession is 1", async () => {
    const QueueHarness: React.FC = () => {
      const [queueIndex, setQueueIndex] = useState(0);
      const refetch = useCallback(async (): Promise<void> => {
        setQueueIndex((currentIndex) => Math.min(currentIndex + 1, announcementQueue.length - 1));
      }, []);
      const {api} = createMockApi(() => announcementQueue[queueIndex], refetch);

      return (
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
    };

    const result = renderWithTheme(<QueueHarness />);
    await waitForFrequencyCheck();
    expect(result.getByText("First update")).toBeTruthy();

    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
    });
    await waitForFrequencyCheck();

    expect(result.getByTestId("app-content")).toBeTruthy();
    assert.isNull(result.queryByText("Second update"));
    assert.isNull(result.queryByTestId("announcement-screen"));
  });

  it("shows the next interrupt after module session reset simulating cold start", async () => {
    // resetFrequencySessionStateForTests() simulates a JS runtime reload; navigator remount alone does not reset the cap.
    const FirstSessionHarness: React.FC = () => {
      const {api} = createMockApi({
        current: makeAnnouncement({id: "announcement-1", title: "First update"}),
        remainingCount: 1,
      });

      return (
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
    };

    const firstSession = renderWithTheme(<FirstSessionHarness />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(firstSession.getByText("First update")).toBeTruthy();
    firstSession.unmount();
    resetFrequencySessionStateForTests();

    const SecondSessionHarness: React.FC = () => {
      const {api} = createMockApi({
        current: makeAnnouncement({id: "announcement-2", title: "Second update"}),
        remainingCount: 0,
      });

      return (
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
    };

    const secondSession = renderWithTheme(<SecondSessionHarness />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(secondSession.getByText("Second update")).toBeTruthy();
  });

  it("keeps a visible interrupt mounted when the parent rerenders an equivalent inline frequency object", async () => {
    const {api} = createMockApi({
      current: makeAnnouncement({title: "Stable interrupt"}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api} frequency={{maxInterruptionsPerSession: 5}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    expect(result.getByTestId("announcement-screen")).toBeTruthy();
    assert.isNull(result.queryByTestId("app-content"));

    result.rerender(
      <AnnouncementNavigator api={api} frequency={{maxInterruptionsPerSession: 5}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    expect(result.getByTestId("announcement-screen")).toBeTruthy();
    assert.isNull(result.queryByTestId("app-content"));
  });

  it("skips interrupts on first launch when skipFirstLaunch is true", async () => {
    const {api} = createMockApi({
      current: makeAnnouncement({title: "Welcome"}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api} frequency={{skipFirstLaunch: true, userId: "user-1"}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.getByTestId("app-content")).toBeTruthy();
    assert.isNull(result.queryByTestId("announcement-screen"));
  });

  it("skips interrupts inside the cooldown window", async () => {
    const lastInterruptKey = buildFrequencyStorageKey("anon", "lastInterruptAt");
    const recentInterruptAt = DateTime.now().minus({hours: 1}).toISO() ?? "";
    Unifier.storage.getItem = mock(async (key: string) => {
      if (key === lastInterruptKey) {
        return recentInterruptAt;
      }
      return null;
    });
    Unifier.storage.setItem = mock(async () => undefined);

    const {api, impressionMutation} = createMockApi({
      current: makeAnnouncement({title: "Cooldown blocked"}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api} frequency={{cooldownHours: 24}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.getByTestId("app-content")).toBeTruthy();
    assert.isNull(result.queryByTestId("announcement-screen"));
    expect(impressionMutation).not.toHaveBeenCalled();
  });

  it("does not apply frequency caps to feed data from useAnnouncements", async () => {
    const feedItem = makeAnnouncement({
      displayMode: "feed",
      id: "feed-item",
      title: "Changelog entry",
    });
    const {api} = createMockApi(
      {
        current: makeAnnouncement({title: "Blocked interrupt"}),
        remainingCount: 0,
      },
      undefined,
      [feedItem]
    );

    const FeedHarness: React.FC = () => {
      const {feed} = useAnnouncements(api);
      return (
        <AnnouncementNavigator api={api} frequency={{maxInterruptionsPerSession: 0}}>
          <Box testID="app-content">
            <Text testID="feed-title">{feed[0]?.title ?? "missing"}</Text>
          </Box>
        </AnnouncementNavigator>
      );
    };

    const result = renderWithTheme(<FeedHarness />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.getByTestId("feed-title")).toHaveTextContent("Changelog entry");
    expect(result.getByTestId("app-content")).toBeTruthy();
    assert.isNull(result.queryByTestId("announcement-screen"));
  });

  it("fails open when frequency storage reads fail", async () => {
    Unifier.storage.getItem = mock(async () => {
      throw new Error("storage read failed");
    });
    Unifier.storage.setItem = mock(async () => {
      throw new Error("storage write failed");
    });

    const {api, impressionMutation} = createMockApi({
      current: makeAnnouncement({title: "Still visible"}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api} frequency={{cooldownHours: 12, skipFirstLaunch: true}}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.getByTestId("announcement-screen")).toBeTruthy();
    expect(impressionMutation).toHaveBeenCalledTimes(1);
  });

  it("records an impression instead of acknowledging when the API marks dismiss-only", async () => {
    const {api, impressionMutation, acknowledgeMutation} = createMockApi({
      current: makeAnnouncement({requiresAcknowledgement: false}),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Dismiss"));
    });
    expect(impressionMutation).toHaveBeenCalled();
    expect(acknowledgeMutation).not.toHaveBeenCalled();
  });

  it("records a click and opens the primary action URL from the modal", async () => {
    const openUrl = mock(() => Promise.resolve(true));
    Linking.canOpenURL = openUrl;
    Linking.openURL = mock(() => Promise.resolve());

    const {api, clickMutation} = createMockApi({
      current: makeAnnouncement({
        primaryAction: {label: "Read docs", url: "https://example.com/docs"},
      }),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Read docs"));
    });

    assert.strictEqual(clickMutation.mock.calls.length, 1);
    assert.deepEqual(clickMutation.mock.calls[0], [{announcementId: "announcement-1"}]);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("still opens the primary action URL when click tracking fails", async () => {
    const warnSpy = mock(() => undefined);
    const originalWarn = console.warn;
    console.warn = warnSpy;

    const openUrl = mock(() => Promise.resolve(true));
    Linking.canOpenURL = openUrl;
    Linking.openURL = mock(() => Promise.resolve());

    const {api, clickMutation} = createMockApi(
      {
        current: makeAnnouncement({
          primaryAction: {label: "Read docs", url: "https://example.com/docs"},
        }),
        remainingCount: 0,
      },
      undefined,
      [],
      async () => {
        throw new Error("click failed");
      }
    );

    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Read docs"));
      await Promise.resolve();
    });

    assert.strictEqual(clickMutation.mock.calls.length, 1);
    assert.isAtLeast(warnSpy.mock.calls.length, 1);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");

    console.warn = originalWarn;
  });

  it("renders children when the pending request is unauthorized", () => {
    const innerApi = {
      injectEndpoints: mock(() => ({
        useAcknowledgeAnnouncementMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useGetAnnouncementFeedQuery: mock(() => ({
          data: {data: []},
          error: undefined,
          isLoading: false,
          refetch: mock(() => Promise.resolve()),
        })),
        useGetPendingAnnouncementsQuery: mock(() => ({
          data: undefined,
          error: {status: 401},
          isLoading: false,
          refetch: mock(() => Promise.resolve()),
        })),
        useRecordAnnouncementClickMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useRecordAnnouncementImpressionMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
      })),
    };
    const onError = mock(() => undefined);
    const result = renderWithTheme(
      <AnnouncementNavigator api={{enhanceEndpoints: mock(() => innerApi)}} onError={onError}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    expect(result.getByTestId("app-content")).toBeTruthy();
    assert.isNull(result.queryByTestId("announcement-navigator-error"));
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError when acknowledging fails", async () => {
    const {api} = createMockApi(
      {
        current: makeAnnouncement(),
        remainingCount: 0,
      },
      undefined,
      [],
      undefined,
      {
        acknowledgeUnwrap: async () => {
          throw new Error("ack failed");
        },
      }
    );
    const onError = mock(() => undefined);
    const result = renderWithTheme(
      <AnnouncementNavigator api={api} onError={onError}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
      await Promise.resolve();
    });

    assert.strictEqual(onError.mock.calls.length, 1);
    assert.instanceOf(onError.mock.calls[0][0], Error);
  });

  it("keeps showing the announcement when recording the impression fails", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    const {api} = createMockApi(
      {
        current: makeAnnouncement({title: "Impression failure"}),
        remainingCount: 0,
      },
      undefined,
      [],
      undefined,
      {
        impressionUnwrap: async () => {
          throw new Error("impression failed");
        },
      }
    );

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
      await waitForFrequencyCheck();
      await waitForFrequencyCheck();

      expect(result.getByText("Impression failure")).toBeTruthy();
      const warned = warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("Failed to record impression")
      );
      assert.isTrue(warned);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when opening the primary action URL throws", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    Linking.canOpenURL = mock(() => Promise.reject(new Error("no handler")));
    Linking.openURL = mock(() => Promise.resolve());

    const {api} = createMockApi({
      current: makeAnnouncement({
        primaryAction: {label: "Read docs", url: "https://example.com/docs"},
      }),
      remainingCount: 0,
    });

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );

      await waitForFrequencyCheck();
      await act(async () => {
        fireEvent.press(result.getByText("Read docs"));
        await Promise.resolve();
      });

      const warned = warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("Failed to open primary-action URL")
      );
      assert.isTrue(warned);
      expect(Linking.openURL).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("fails open when the frequency check itself throws", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    const suppressSpy = spyOn(announcementFrequency, "shouldSuppressInterrupt").mockImplementation(
      async () => {
        throw new Error("frequency exploded");
      }
    );
    const recordSpy = spyOn(announcementFrequency, "recordInterruptShown").mockImplementation(
      async () => {
        throw new Error("record exploded");
      }
    );

    const {api, impressionMutation} = createMockApi({
      current: makeAnnouncement({title: "Still shown"}),
      remainingCount: 0,
    });

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
      await waitForFrequencyCheck();
      await waitForFrequencyCheck();

      expect(result.getByText("Still shown")).toBeTruthy();
      expect(impressionMutation).toHaveBeenCalledTimes(1);
      const messages = warnSpy.mock.calls.map((call) => String(call[0]));
      assert.isTrue(messages.some((message) => message.includes("Frequency check failed")));
      assert.isTrue(
        messages.some((message) => message.includes("Failed to record interrupt for frequency"))
      );
    } finally {
      suppressSpy.mockRestore();
      recordSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("does not record a click when the announcement has no primary action", async () => {
    const {api, clickMutation} = createMockApi({
      current: makeAnnouncement(),
      remainingCount: 0,
    });
    const result = renderWithTheme(
      <AnnouncementNavigator api={api}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
    });

    assert.strictEqual(clickMutation.mock.calls.length, 0);
  });

  it("renders children without calling onError when pending fails with 401", () => {
    const refetch = mock(() => Promise.resolve());
    const innerApi = {
      injectEndpoints: mock(() => ({
        useAcknowledgeAnnouncementMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useGetAnnouncementFeedQuery: mock(() => ({
          data: {data: []},
          error: undefined,
          isLoading: false,
          refetch,
        })),
        useGetPendingAnnouncementsQuery: mock(() => ({
          data: undefined,
          error: {status: 401},
          isLoading: false,
          refetch,
        })),
        useRecordAnnouncementClickMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
        useRecordAnnouncementImpressionMutation: mock(() => [
          mock(),
          {error: undefined, isLoading: false},
        ]),
      })),
    };
    const onError = mock(() => undefined);
    const result = renderWithTheme(
      <AnnouncementNavigator api={{enhanceEndpoints: mock(() => innerApi)}} onError={onError}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );
    expect(result.getByTestId("app-content")).toBeTruthy();
    expect(result.queryByTestId("announcement-navigator-error")).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports acknowledge failures through onError", async () => {
    const refetch = mock(() => Promise.reject(new Error("refetch failed")));
    const {api} = createMockApi({current: makeAnnouncement(), remainingCount: 0}, refetch);
    const onError = mock(() => undefined);
    const result = renderWithTheme(
      <AnnouncementNavigator api={api} onError={onError}>
        <Box testID="app-content">
          <Text>App</Text>
        </Box>
      </AnnouncementNavigator>
    );

    await waitForFrequencyCheck();
    await act(async () => {
      fireEvent.press(result.getByText("Got it"));
      await Promise.resolve();
    });

    assert.strictEqual(onError.mock.calls.length, 1);
    assert.instanceOf(onError.mock.calls[0][0], Error);
    assert.strictEqual((onError.mock.calls[0][0] as Error).message, "refetch failed");
  });

  it("warns but keeps showing the announcement when recording an impression fails", async () => {
    const warnSpy = mock(() => undefined);
    const originalWarn = console.warn;
    console.warn = warnSpy;

    const {api, impressionMutation} = createMockApi(
      {current: makeAnnouncement(), remainingCount: 0},
      undefined,
      [],
      undefined,
      {
        impressionUnwrap: async () => {
          throw new Error("impression failed");
        },
      }
    );

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );
      await waitForFrequencyCheck();
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.getByTestId("announcement-screen")).toBeTruthy();
      expect(impressionMutation).toHaveBeenCalledTimes(1);
      const impressionWarnings = warnSpy.mock.calls.filter(
        (call) => call[0] === "[AnnouncementNavigator] Failed to record impression"
      );
      assert.strictEqual(impressionWarnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("warns when opening the primary action URL fails", async () => {
    const warnSpy = mock(() => undefined);
    const originalWarn = console.warn;
    console.warn = warnSpy;
    const originalCanOpenURL = Linking.canOpenURL;
    Linking.canOpenURL = mock(() => Promise.reject(new Error("cannot open")));

    const {api, clickMutation} = createMockApi({
      current: makeAnnouncement({
        primaryAction: {label: "Read docs", url: "https://example.com/docs"},
      }),
      remainingCount: 0,
    });

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );

      await waitForFrequencyCheck();
      await act(async () => {
        fireEvent.press(result.getByText("Read docs"));
        await Promise.resolve();
      });

      assert.strictEqual(clickMutation.mock.calls.length, 1);
      const linkWarnings = warnSpy.mock.calls.filter(
        (call) => call[0] === "[AnnouncementNavigator] Failed to open primary-action URL"
      );
      assert.strictEqual(linkWarnings.length, 1);
    } finally {
      console.warn = originalWarn;
      Linking.canOpenURL = originalCanOpenURL;
    }
  });

  it("fails open when the frequency check itself throws", async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    let hasThrownFrequencyWarning = false;
    console.warn = (...args: unknown[]): void => {
      warnCalls.push(args);
      if (
        !hasThrownFrequencyWarning &&
        args[0] === "[announcementFrequency] Failed to read hasLaunched; allowing interrupt"
      ) {
        hasThrownFrequencyWarning = true;
        throw new Error("warn exploded");
      }
    };
    Unifier.storage.getItem = mock(async () => {
      throw new Error("storage read failed");
    });

    const {api, impressionMutation} = createMockApi({
      current: makeAnnouncement({title: "Still visible"}),
      remainingCount: 0,
    });

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api} frequency={{skipFirstLaunch: true}}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.getByTestId("announcement-screen")).toBeTruthy();
      expect(impressionMutation).toHaveBeenCalledTimes(1);
      const navigatorWarnings = warnCalls.filter(
        (call) => call[0] === "[AnnouncementNavigator] Frequency check failed; allowing interrupt"
      );
      assert.strictEqual(navigatorWarnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("warns when recording the interrupt for frequency throws", async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    let hasThrownPersistWarning = false;
    console.warn = (...args: unknown[]): void => {
      warnCalls.push(args);
      if (
        !hasThrownPersistWarning &&
        args[0] === "[announcementFrequency] Failed to persist lastInterruptAt"
      ) {
        hasThrownPersistWarning = true;
        throw new Error("warn exploded");
      }
    };
    Unifier.storage.setItem = mock(async () => {
      throw new Error("storage write failed");
    });

    const {api} = createMockApi({
      current: makeAnnouncement({title: "Still visible"}),
      remainingCount: 0,
    });

    try {
      const result = renderWithTheme(
        <AnnouncementNavigator api={api}>
          <Box testID="app-content">
            <Text>App</Text>
          </Box>
        </AnnouncementNavigator>
      );

      await waitForFrequencyCheck();
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.getByTestId("announcement-screen")).toBeTruthy();
      const navigatorWarnings = warnCalls.filter(
        (call) => call[0] === "[AnnouncementNavigator] Failed to record interrupt for frequency"
      );
      assert.strictEqual(navigatorWarnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
