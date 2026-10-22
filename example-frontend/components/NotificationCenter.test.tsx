import {beforeEach, describe, it, mock} from "bun:test";
import {createApiClient} from "@terreno/syncdb/api";
import type {NotificationInboxItem} from "@terreno/ui";
import {assert} from "chai";
import React, {type ReactNode} from "react";
import {act, create, type ReactTestInstance, type ReactTestRenderer} from "react-test-renderer";

interface MockNotification {
  _id: string;
  archivedAt?: string | null;
  body: string;
  created: string;
  deleted?: boolean;
  href?: string;
  readAt?: string | null;
  title: string;
}

interface MockPreference {
  _id: string;
  deleted?: boolean;
  inapp: boolean;
  mail: boolean;
  push: boolean;
  sms: boolean;
}

const createHostComponent = (name: string): React.FC<Record<string, unknown>> => {
  const HostComponent: React.FC<Record<string, unknown>> = ({children, text, title, ...props}) => {
    const ReactNativeText = require("react-native").Text as React.ComponentType<{
      children?: ReactNode;
    }>;
    return React.createElement(
      name,
      props,
      typeof title === "string" ? React.createElement(ReactNativeText, null, title) : null,
      typeof text === "string" ? React.createElement(ReactNativeText, null, text) : null,
      children as ReactNode
    );
  };
  HostComponent.displayName = name;
  return HostComponent;
};

const notificationRows: MockNotification[] = [];
const preferenceRows: MockPreference[] = [];
let isSyncDbReady = true;

interface MockMutation {
  collection?: string;
  data: Record<string, unknown>;
  id: string;
  operation?: string;
}

const createPreference = mock((_mutation: MockMutation): void => {});
const reconcile = mock(async (): Promise<void> => {});
const routerBack = mock((): void => {});
const routerPush = mock((_href: string): void => {});
const syncMutate = mock((_mutation: MockMutation): void => {});
const updatePreference = mock((_mutation: MockMutation): void => {});

Object.assign(globalThis, {
  __DEV__: true,
  IS_REACT_ACT_ENVIRONMENT: true,
});

interface RecordedRequest {
  body: unknown;
  method: string;
  url: string;
}

// The generated mutation hooks send through the real request client; this fake fetch
// records each request and answers like the dev notify endpoint.
const requests: RecordedRequest[] = [];
const fakeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  requests.push({
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    method: init?.method ?? "GET",
    url: input,
  });
  return new Response(JSON.stringify({data: {notificationId: "notification-new"}}), {
    headers: {"Content-Type": "application/json"},
    status: 200,
  });
};
const apiClient = createApiClient({baseUrl: "http://localhost:4000", fetchImpl: fakeFetch});

// Spread the real module so ApiClientProvider and the request hooks stay real; only the
// local-first reads come from the in-memory rows above.
const actualSyncDbReact = await import("@terreno/syncdb/react");
const {ApiClientProvider} = actualSyncDbReact;

mock.module("@terreno/syncdb", () => ({
  generateMutationId: (): string => "generated-preference-id",
}));

mock.module("@terreno/syncdb/react", () => ({
  ...actualSyncDbReact,
  useQuery: (
    collection: string,
    options?: {
      filter?: (row: MockNotification | MockPreference) => boolean;
      sort?: (left: MockNotification, right: MockNotification) => number;
    }
  ): MockNotification[] | MockPreference[] => {
    if (collection === "notifications") {
      const filtered = options?.filter ? notificationRows.filter(options.filter) : notificationRows;
      return options?.sort ? [...filtered].sort(options.sort) : filtered;
    }
    return options?.filter ? preferenceRows.filter(options.filter) : preferenceRows;
  },
}));

mock.module("@terreno/ui", () => ({
  AreaChart: createHostComponent("AreaChart"),
  BarChart: createHostComponent("BarChart"),
  Box: createHostComponent("Box"),
  Button: createHostComponent("Button"),
  Card: createHostComponent("Card"),
  DashboardGrid: createHostComponent("DashboardGrid"),
  DashboardGridItem: createHostComponent("DashboardGridItem"),
  DonutChart: createHostComponent("DonutChart"),
  Heading: createHostComponent("Heading"),
  LineChart: createHostComponent("LineChart"),
  NotificationBell: createHostComponent("NotificationBell"),
  NotificationInbox: createHostComponent("NotificationInbox"),
  NotificationPreferences: createHostComponent("NotificationPreferences"),
  Page: createHostComponent("Page"),
  Scorecard: createHostComponent("Scorecard"),
  SideDrawer: ({children, renderContent, ...props}: Record<string, unknown>) =>
    React.createElement(
      "SideDrawer",
      props,
      children as ReactNode,
      (renderContent as () => ReactNode)()
    ),
  TerrenoProvider: createHostComponent("TerrenoProvider"),
  Text: createHostComponent("Text"),
  // Sibling suites import useStoredState from @terreno/ui under Bun's process-global mock.module.
  useStoredState: () => ["", async (): Promise<void> => undefined, false],
}));

mock.module("expo-router", () => ({
  // Include useLocalSearchParams so this incomplete mock does not break sibling
  // suites that import it from "expo-router" under Bun's process-global mock.module.
  useLocalSearchParams: () => ({}),
  useRouter: () => ({back: routerBack, push: routerPush}),
}));

mock.module("@/hooks/useSyncDbReady", () => ({
  useSyncDbReady: (): boolean => isSyncDbReady,
}));

mock.module("@/store/syncdb", () => ({
  syncDb: {mutate: syncMutate, reconcile},
}));

mock.module("@/store/syncDbSdk", () => ({
  useCreateNotificationPreference: () => [createPreference],
  useTodos: () => ({data: []}),
  useUpdateNotificationPreference: () => [updatePreference],
}));

const {NotificationCenter, NotificationCenterBell} = await import("./NotificationCenter");
const {default: NotificationSettingsScreen} = await import("../app/settings/notifications");
const {default: AllNotificationsScreen} = await import("../app/notifications");

// The UI stand-ins render host elements named after the component, so match on the
// host type string.
const findHost = (renderer: ReactTestRenderer, type: string): ReactTestInstance =>
  renderer.root.find((node) => node.type === type);

const findHosts = (renderer: ReactTestRenderer, type: string): ReactTestInstance[] =>
  renderer.root.findAll((node) => node.type === type);

const renderNotificationCenter = (): ReactTestRenderer =>
  create(
    <ApiClientProvider client={apiClient}>
      <NotificationCenter>
        <NotificationCenterBell />
      </NotificationCenter>
    </ApiClientProvider>
  );

describe("NotificationCenter", () => {
  beforeEach(() => {
    isSyncDbReady = true;
    notificationRows.splice(
      0,
      notificationRows.length,
      {
        _id: "notification-1",
        body: "Newest body",
        created: "2026-09-11T12:00:00.000Z",
        href: "/profile",
        title: "Newest",
      },
      {
        _id: "notification-2",
        body: "Older body",
        created: "2026-09-10T12:00:00.000Z",
        title: "Older",
      }
    );
    preferenceRows.splice(0);
    createPreference.mockClear();
    reconcile.mockClear();
    routerPush.mockClear();
    requests.splice(0);
    syncMutate.mockClear();
  });

  it("opens the inbox and applies notification actions", async (): Promise<void> => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = renderNotificationCenter();
    });

    act(() => {
      findHosts(renderer, "NotificationBell")[0]?.props.onPress();
    });
    const drawer = findHost(renderer, "SideDrawer");
    assert.isTrue(drawer.props.isOpen);

    act(() => {
      findHosts(renderer, "NotificationBell")[1]?.props.onPress();
    });
    assert.isFalse(findHost(renderer, "SideDrawer").props.isOpen);

    act(() => {
      findHosts(renderer, "NotificationBell")[0]?.props.onPress();
    });
    const inbox = findHost(renderer, "NotificationInbox");
    const item = inbox.props.items[0];
    act(() => {
      inbox.props.onMarkRead(item);
      inbox.props.onMarkUnread(item);
      inbox.props.onDismiss(item);
      inbox.props.onOpen(item);
    });

    assert.deepInclude(syncMutate.mock.calls[0]?.[0], {
      collection: "notifications",
      operation: "update",
    });
    assert.deepInclude(syncMutate.mock.calls[1]?.[0], {
      data: {readAt: null},
    });
    assert.deepInclude(syncMutate.mock.calls[2]?.[0], {
      collection: "notifications",
      operation: "update",
    });
    assert.equal(typeof syncMutate.mock.calls[2]?.[0].data.archivedAt, "string");
    assert.equal(routerPush.mock.calls[0]?.[0], "/profile");

    assert.isFalse(findHost(renderer, "SideDrawer").props.isOpen);
  });

  it("sends a test notification and reconciles", async (): Promise<void> => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = renderNotificationCenter();
    });

    await act(async () => {
      const sendButton = findHosts(renderer, "Button").find(
        (button) => button.props.testID === "notification-send-test-button"
      );
      await sendButton?.props.onClick();
    });

    assert.deepEqual(requests, [
      {
        body: {
          body: "Sent from the example todos screen.",
          href: "/",
          title: "Terreno test notification",
        },
        method: "POST",
        url: "http://localhost:4000/notifications/dev/notify",
      },
    ]);
    assert.equal(reconcile.mock.calls.length, 1);
  });

  it("opens the full notification history from the drawer", async (): Promise<void> => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = renderNotificationCenter();
    });

    await act(async () => {
      const viewAllButton = findHosts(renderer, "Button").find(
        (button) => button.props.testID === "notification-view-all-button"
      );
      await viewAllButton?.props.onClick();
    });

    assert.equal(reconcile.mock.calls.length, 1);
    assert.equal(routerPush.mock.calls[0]?.[0], "/notifications");
    assert.isFalse(findHost(renderer, "SideDrawer").props.isOpen);
  });
});

describe("AllNotificationsScreen", () => {
  beforeEach(() => {
    isSyncDbReady = true;
    notificationRows.splice(
      0,
      notificationRows.length,
      {
        _id: "active-notification",
        body: "Active body",
        created: "2026-09-11T12:00:00.000Z",
        href: "/",
        title: "Active",
      },
      {
        _id: "archived-notification",
        archivedAt: "2026-09-10T13:00:00.000Z",
        body: "Archived body",
        created: "2026-09-10T12:00:00.000Z",
        readAt: "2026-09-10T13:00:00.000Z",
        title: "Archived",
      }
    );
  });

  it("shows active and archived notifications separately", async (): Promise<void> => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AllNotificationsScreen />);
    });

    const inboxes = findHosts(renderer, "NotificationInbox");
    assert.deepEqual(
      inboxes.map((inbox) => inbox.props.items.map((item: NotificationInboxItem) => item.id)),
      [["active-notification"], ["archived-notification"]]
    );
    assert.isTrue(inboxes[1]?.props.items[0].archived);
  });

  it("keeps archived inbox loading until syncdb is ready", async (): Promise<void> => {
    isSyncDbReady = false;
    notificationRows.splice(0, notificationRows.length);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AllNotificationsScreen />);
    });

    const archivedInbox = findHosts(renderer, "NotificationInbox").find(
      (inbox) => inbox.props.testID === "all-notifications-archived"
    );
    assert.isOk(archivedInbox);
    assert.isTrue(archivedInbox?.props.isLoading);
    assert.equal(
      renderer.root.findAllByProps({testID: "all-notifications-archived-empty"}).length,
      0
    );
  });

  it("applies history actions and navigates back", async (): Promise<void> => {
    syncMutate.mockClear();
    routerBack.mockClear();
    routerPush.mockClear();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AllNotificationsScreen />);
    });

    const activeInbox = findHosts(renderer, "NotificationInbox").find(
      (inbox) => inbox.props.testID === "all-notifications-active"
    );
    const item = activeInbox?.props.items[0];
    act(() => {
      activeInbox?.props.onMarkRead(item);
      activeInbox?.props.onMarkUnread(item);
      activeInbox?.props.onDismiss(item);
      activeInbox?.props.onOpen(item);
    });
    act(() => {
      renderer.root.findByProps({testID: "notifications-back-button"}).props.onClick();
    });

    assert.deepInclude(syncMutate.mock.calls[0]?.[0], {
      collection: "notifications",
      operation: "update",
    });
    assert.deepInclude(syncMutate.mock.calls[1]?.[0], {data: {readAt: null}});
    assert.equal(typeof syncMutate.mock.calls[2]?.[0].data.archivedAt, "string");
    assert.equal(routerPush.mock.calls[0]?.[0], "/");
    assert.equal(routerBack.mock.calls.length, 1);
  });

  it("ignores history mutations until syncdb is ready", async (): Promise<void> => {
    isSyncDbReady = false;
    syncMutate.mockClear();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AllNotificationsScreen />);
    });
    const activeInbox = findHosts(renderer, "NotificationInbox").find(
      (inbox) => inbox.props.testID === "all-notifications-active"
    );
    const item = activeInbox?.props.items[0];
    act(() => {
      activeInbox?.props.onMarkRead(item);
      activeInbox?.props.onMarkUnread(item);
      activeInbox?.props.onDismiss(item);
    });
    assert.equal(syncMutate.mock.calls.length, 0);
  });
});

describe("NotificationSettingsScreen", () => {
  beforeEach(() => {
    isSyncDbReady = true;
    preferenceRows.splice(0);
    createPreference.mockClear();
    routerBack.mockClear();
    updatePreference.mockClear();
  });

  it("creates defaults on the first preference change and navigates back", async (): Promise<void> => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<NotificationSettingsScreen />);
    });

    act(() => {
      findHost(renderer, "NotificationPreferences").props.onChange("mail", false);
      findHost(renderer, "Button").props.onClick();
    });

    assert.deepInclude(createPreference.mock.calls[0]?.[0], {
      id: "generated-preference-id",
    });
    assert.isFalse(createPreference.mock.calls[0]?.[0].data.mail);
    assert.equal(routerBack.mock.calls.length, 1);
  });

  it("updates an existing preference", async (): Promise<void> => {
    preferenceRows.push({
      _id: "preference-1",
      inapp: true,
      mail: true,
      push: true,
      sms: true,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<NotificationSettingsScreen />);
    });

    act(() => {
      findHost(renderer, "NotificationPreferences").props.onChange("sms", false);
    });

    assert.deepEqual(updatePreference.mock.calls[0]?.[0], {
      data: {sms: false},
      id: "preference-1",
    });
  });
});
