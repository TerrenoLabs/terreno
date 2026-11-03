import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, waitFor} from "@testing-library/react-native";
import React from "react";
import {Text} from "react-native";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminSpaAppConfig} from "../appConfig";
import {publishAdminSpaServerContext} from "../serverContext";

// Isolated file: it registers module mocks that would leak into other suites. It renders the
// real root layout (AppConfigGate, StoreProvider, AdminGate, AdminProviderBridge) with a probe
// in place of the route Stack, and drives the shell payload through a mocked `useSsrPayload`.
// (`useSsrPayload` itself is covered by components/ssrPayload.test.tsx.)

const SERVER_KEY = Symbol.for("terreno.adminSpa.server");
const globalState = globalThis as unknown as {
  fetch: typeof fetch;
  window?: Record<string, unknown>;
  document?: unknown;
  [key: symbol]: unknown;
};
const hadWindow = "window" in globalState;
const originalWindow = globalState.window;
const originalFetch = globalState.fetch;

const INTERNAL_ORIGIN = "http://127.0.0.1:5123";

const ADMIN_USER = {
  createdAt: "2026-01-01T00:00:00.000Z",
  email: "admin@example.com",
  emailVerified: true,
  id: "ba1",
  image: null,
  name: "Admin",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const PLAIN_CONFIG = {
  models: [
    {
      defaultSort: "-created",
      displayName: "Users",
      fields: {email: {required: true, type: "string"}},
      listFields: ["email"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
};

// A windowed sync model: string `_id`, `adminBroadcast`, and a sync collection tag.
const WINDOWED_CONFIG = {
  models: [
    ...PLAIN_CONFIG.models,
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Notes",
      fields: {_id: {required: false, type: "string"}, body: {required: false, type: "string"}},
      listFields: ["body"],
      name: "Note",
      routePath: "/admin/notes",
      syncCollection: "notes",
    },
  ],
};

const ME = {data: {_id: "u1", admin: true, roles: ["admin"]}};

const APP_CONFIG: AdminSpaAppConfig = {
  brandName: "Hydrated Brand",
  primaryColor: "#2563EB",
  providers: ["email"],
};

interface ShellPayload {
  adminConfig: unknown;
  adminConfigStatus: number | null;
  appConfig: typeof APP_CONFIG;
  basePath: string;
  profile: unknown;
  session: {user: unknown; userId: string} | null;
}

const adminPayload = (adminConfig: unknown = PLAIN_CONFIG): ShellPayload => ({
  adminConfig,
  adminConfigStatus: 200,
  appConfig: APP_CONFIG,
  basePath: "/console",
  profile: ME,
  session: {user: ADMIN_USER, userId: "ba1"},
});

const OTHER_USER = {...ADMIN_USER, email: "other@example.com", id: "ba2", name: "Other"};

// What B (the live session) sees; distinguishable from the payload's config by model name.
const OTHER_CONFIG = {
  models: [{...PLAIN_CONFIG.models[0], displayName: "Others", name: "OtherModel"}],
};

const state: {
  adminConfigBody: unknown;
  liveUser: typeof ADMIN_USER;
  payload: ShellPayload | undefined;
  startRejects: boolean;
  useFakeSyncDb: boolean;
} = {
  adminConfigBody: undefined,
  liveUser: ADMIN_USER,
  payload: undefined,
  startRejects: false,
  useFakeSyncDb: true,
};

interface FirstRender {
  config: unknown;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  profile: unknown;
  userId: string | null;
}

let lateRenders: unknown[] = [];
let showLateReader: () => void = () => {};
let probeRenders: FirstRender[] = [];
let fetchCalls: string[] = [];
let createSyncDbConfigs: Array<{baseUrl?: string; collections?: string[]}> = [];
let authClientBaseUrls: Array<string | undefined> = [];
let apiClientBaseUrls: Array<string | undefined> = [];
let startResolvers: Array<() => void> = [];
let startCalls = 0;
let createdClients: unknown[] = [];
let probeSyncDbs: unknown[] = [];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

/** Stands in for every backend call a client could make; the tests assert on what was asked. */
const fakeFetch = (async (input: unknown): Promise<Response> => {
  const url = String(input);
  fetchCalls.push(url);
  if (url.endsWith("/get-session")) {
    return json({
      session: {expiresAt: "2099-01-01T00:00:00.000Z", id: "s1", userId: state.liveUser.id},
      user: state.liveUser,
    });
  }
  if (url.endsWith("/admin/config")) {
    if (state.adminConfigBody) {
      return json(state.adminConfigBody);
    }
    return json(state.useFakeSyncDb ? WINDOWED_CONFIG : PLAIN_CONFIG);
  }
  if (url.endsWith("/auth/me")) {
    return json(ME);
  }
  return json({title: "Not found"}, 404);
}) as typeof fetch;

/** A syncdb client whose `start()` stays pending until the test resolves it. */
const makeFakeSyncDb = (): unknown => {
  const members: Record<string, unknown> = {
    signOut: async (): Promise<void> => {},
    start: (): Promise<void> => {
      startCalls += 1;
      if (state.startRejects) {
        return Promise.reject(new Error("sync boom"));
      }
      return new Promise<void>((resolve) => {
        startResolvers.push(resolve);
      });
    },
    stop: async (): Promise<void> => {},
  };
  return new Proxy(members, {
    get: (target, key: string) => target[key] ?? ((): void => {}),
  });
};

const routerReplace = mock(() => {});

const Probe: React.FC = () => {
  // Resolved lazily: these modules load after the mocks below are registered.
  const {useSession} = require("@terreno/syncdb/auth") as typeof import("@terreno/syncdb/auth");
  const {useAdminConfig, useAdminContext} =
    require("@terreno/admin-frontend") as typeof import("@terreno/admin-frontend");
  const {useAdminSpaProfile} =
    require("../../components/adminSpaProfile") as typeof import("../../components/adminSpaProfile");
  const session = useSession();
  probeSyncDbs.push(useAdminContext()?.syncDb);
  const {config} = useAdminConfig("/admin");
  const {data: profile} = useAdminSpaProfile();
  probeRenders.push({
    config,
    isAuthenticated: session.isAuthenticated,
    isAuthLoading: session.isLoading,
    profile,
    userId: session.userId,
  });
  return (
    <>
      <Text testID="shell-probe">probe</Text>
      <LateReaderHost />
    </>
  );
};

const LateReader: React.FC = () => {
  const {useAdminConfig} =
    require("@terreno/admin-frontend") as typeof import("@terreno/admin-frontend");
  const {config} = useAdminConfig("/admin");
  lateRenders.push(config);
  return <Text testID="late-reader">late</Text>;
};

// Mounts a second config reader on demand, after the session has changed.
const LateReaderHost: React.FC = () => {
  const [isShown, setIsShown] = React.useState(false);
  showLateReader = (): void => setIsShown(true);
  return isShown ? <LateReader /> : null;
};

let RootLayout: React.FC;

beforeAll(async () => {
  const realRouter = {...(await import("expo-router"))};
  mock.module("expo-router", () => ({...realRouter, Stack: () => <Probe />}));
  mock.module("expo-secure-store", () => ({
    deleteItemAsync: async (): Promise<void> => {},
    getItem: (): null => null,
    setItem: (): void => {},
  }));
  mock.module("@better-auth/expo/client", () => ({expoClient: () => ({id: "expo"})}));

  mock.module(new URL("../../components/ssrPayload.ts", import.meta.url).pathname, () => ({
    useSsrPayload: (): ShellPayload | undefined => state.payload,
  }));

  const realSyncDb = {...(await import("@terreno/syncdb"))};
  mock.module("@terreno/syncdb", () => ({
    ...realSyncDb,
    createSyncDb: (config: {baseUrl?: string; collections?: string[]}): unknown => {
      createSyncDbConfigs.push(config);
      const client = state.useFakeSyncDb
        ? makeFakeSyncDb()
        : realSyncDb.createSyncDb(config as Parameters<typeof realSyncDb.createSyncDb>[0]);
      createdClients.push(client);
      return client;
    },
  }));
  const realReact = {...(await import("@terreno/syncdb/react"))};
  mock.module("@terreno/syncdb/react", () => ({
    ...realReact,
    SyncDbProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
    useConflicts: () => ({conflicts: [], resolve: async (): Promise<void> => {}}),
  }));
  const realApi = {...(await import("@terreno/syncdb/api"))};
  mock.module("@terreno/syncdb/api", () => ({
    ...realApi,
    createApiClient: (config: Parameters<typeof realApi.createApiClient>[0]) => {
      const client = realApi.createApiClient(config);
      apiClientBaseUrls.push(client.baseUrl);
      return client;
    },
  }));
  const realBetterAuth = {...(await import("better-auth/react"))};
  mock.module("better-auth/react", () => ({
    ...realBetterAuth,
    createAuthClient: (options: {baseURL?: string}) => {
      authClientBaseUrls.push(options?.baseURL);
      return realBetterAuth.createAuthClient(options as never);
    },
  }));

  ({default: RootLayout} = await import("../../app/_layout"));
});

const installClientWindow = (): void => {
  globalState.window = {
    __ADMIN_SPA_BASE__: "/console",
    __ADMIN_SPA_CONFIG__: APP_CONFIG,
    location: {origin: "http://localhost:4100"},
  };
};

const setRouter = async (pathname: string): Promise<void> => {
  const expoRouter = (await import("expo-router")) as unknown as {
    usePathname: {mockReturnValue: (value: string) => void};
    useRouter: {mockReturnValue: (value: unknown) => void};
    useLocalSearchParams: {mockReturnValue: (value: unknown) => void};
  };
  expoRouter.usePathname.mockReturnValue(pathname);
  expoRouter.useRouter.mockReturnValue({push: mock(() => {}), replace: routerReplace});
  expoRouter.useLocalSearchParams.mockReturnValue({});
};

const adminConfigFetches = (): string[] =>
  fetchCalls.filter((url) => url.endsWith("/admin/config"));

beforeEach(async () => {
  probeRenders = [];
  lateRenders = [];
  showLateReader = () => {};
  fetchCalls = [];
  createSyncDbConfigs = [];
  authClientBaseUrls = [];
  apiClientBaseUrls = [];
  startResolvers = [];
  startCalls = 0;
  createdClients = [];
  probeSyncDbs = [];
  routerReplace.mockClear();
  state.payload = undefined;
  state.useFakeSyncDb = true;
  state.adminConfigBody = undefined;
  state.liveUser = ADMIN_USER;
  state.startRejects = false;
  globalState.fetch = fakeFetch;
  delete globalState[SERVER_KEY];
  await setRouter("/");
  installClientWindow();
});

afterEach(async () => {
  globalState.fetch = originalFetch;
  delete globalState[SERVER_KEY];
  await setRouter("/");
  if (hadWindow) {
    globalState.window = originalWindow;
  } else {
    delete globalState.window;
  }
});

describe("root layout hydrating the shell payload (browser)", () => {
  it("renders the gated tree on the very first render from the payload, fetching /admin/config zero times", async () => {
    state.payload = adminPayload();

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    // Synchronously after render: the first thing the probe ever saw is already resolved.
    expect(queryByTestId("admin-spa-admin-gate-loading")).toBeNull();
    expect(queryByTestId("shell-probe")).not.toBeNull();
    expect(probeRenders[0]).toMatchObject({
      isAuthenticated: true,
      isAuthLoading: false,
      profile: ME.data,
    });
    expect((probeRenders[0].config as typeof PLAIN_CONFIG).models[0].name).toBe("User");

    // Let every effect and silent read settle, then prove nothing asked for the config again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(adminConfigFetches()).toEqual([]);
    expect(fetchCalls.filter((url) => url.endsWith("/auth/me"))).toEqual([]);
    expect(probeRenders.every((render) => render.isAuthLoading === false)).toBe(true);
  });

  it("without a payload keeps today's behavior: spinner, then the shell after the fetches", async () => {
    state.useFakeSyncDb = false;
    state.payload = undefined;

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    expect(queryByTestId("admin-spa-admin-gate-loading")).not.toBeNull();
    expect(queryByTestId("shell-probe")).toBeNull();
    await waitFor(() => expect(queryByTestId("shell-probe")).not.toBeNull());
    expect(adminConfigFetches().length).toBeGreaterThan(0);
  });

  it("a forbidden payload redirects to /forbidden without rendering the shell", async () => {
    state.payload = {...adminPayload(), adminConfig: null, adminConfigStatus: 403};

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/forbidden"));
    expect(queryByTestId("shell-probe")).toBeNull();
    expect(adminConfigFetches()).toEqual([]);
  });

  it("an anonymous payload redirects to /login without rendering the shell", async () => {
    state.payload = {
      ...adminPayload(),
      adminConfig: null,
      adminConfigStatus: null,
      profile: null,
      session: null,
    };

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/login"));
    expect(queryByTestId("shell-probe")).toBeNull();
  });
});

describe("root layout when the live session is not the payload's session", () => {
  it("probes /admin/config instead of trusting a 403 payload read for another user", async () => {
    state.payload = {...adminPayload(), adminConfig: null, adminConfigStatus: 403};
    state.liveUser = OTHER_USER;
    state.adminConfigBody = OTHER_CONFIG;

    const {queryByTestId} = renderWithTheme(<RootLayout />);
    // The first frame is the payload's own session; only the settled state is under test.
    routerReplace.mockClear();

    await waitFor(() => expect(queryByTestId("shell-probe")).not.toBeNull());
    expect(adminConfigFetches().length).toBeGreaterThanOrEqual(1);
    expect(routerReplace).not.toHaveBeenCalledWith("/forbidden");
  });

  it("fetches the live user's config instead of seeding the payload user's", async () => {
    state.payload = adminPayload();
    state.liveUser = OTHER_USER;
    state.adminConfigBody = OTHER_CONFIG;

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    // First render: the payload's own session, seeded, no config request.
    expect(queryByTestId("shell-probe")).not.toBeNull();
    expect((probeRenders[0].config as typeof PLAIN_CONFIG).models[0].name).toBe("User");
    expect(adminConfigFetches()).toEqual([]);

    // The silent session read lands on the other user.
    await waitFor(() => expect(probeRenders[probeRenders.length - 1].userId).toBe("ba2"));

    // A config reader that mounts now belongs to the live user, so it must not be seeded with the
    // payload user's config.
    await act(async () => {
      showLateReader();
    });
    await waitFor(() => expect(adminConfigFetches().length).toBeGreaterThanOrEqual(1));
    await waitFor(() => {
      const last = lateRenders[lateRenders.length - 1];
      expect((last as typeof PLAIN_CONFIG | undefined)?.models[0].name).toBe("OtherModel");
    });
    expect(
      lateRenders.some((config) => (config as typeof PLAIN_CONFIG)?.models[0].name === "User")
    ).toBe(false);
  });
});

describe("root layout with a windowed sync model", () => {
  it("keeps the shell and shows the sync error banner when client.start() rejects", async () => {
    state.payload = adminPayload(WINDOWED_CONFIG);
    state.startRejects = true;

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    expect(queryByTestId("shell-probe")).not.toBeNull();
    await waitFor(() => expect(queryByTestId("admin-spa-sync-error")).not.toBeNull());
    expect(queryByTestId("shell-probe")).not.toBeNull();
  });

  it("renders the children on the first render, before client.start() resolves", async () => {
    state.payload = adminPayload(WINDOWED_CONFIG);

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    expect(queryByTestId("shell-probe")).not.toBeNull();
    expect(createSyncDbConfigs).toHaveLength(1);
    expect(createSyncDbConfigs[0].collections).toEqual(["notes"]);
    expect(probeRenders[0].isAuthenticated).toBe(true);
    // The probe rendered although start() has not resolved (it never does in this test).
    await waitFor(() => expect(startCalls).toBeGreaterThan(0));
    expect(startResolvers.length).toBeGreaterThan(0);
    expect(queryByTestId("shell-probe")).not.toBeNull();
  });

  it("hands AdminProvider no syncDb until start() resolves, then the client", async () => {
    state.payload = adminPayload(WINDOWED_CONFIG);

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    // First render: the shell is up but windowed tables must not bind to an unstarted store.
    expect(queryByTestId("shell-probe")).not.toBeNull();
    expect(probeSyncDbs[0]).toBeUndefined();
    await waitFor(() => expect(startCalls).toBeGreaterThan(0));
    expect(probeSyncDbs.every((syncDb) => syncDb === undefined)).toBe(true);

    await act(async () => {
      for (const resolve of startResolvers) {
        resolve();
      }
    });

    await waitFor(() => expect(probeSyncDbs[probeSyncDbs.length - 1]).toBeDefined());
    expect(createdClients.length).toBeGreaterThan(0);
    expect(probeSyncDbs[probeSyncDbs.length - 1]).toBe(createdClients[createdClients.length - 1]);
  });

  it("without a payload keeps the spinner until start() resolves", async () => {
    state.payload = undefined;

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    await waitFor(() => expect(startCalls).toBeGreaterThan(0));
    expect(queryByTestId("shell-probe")).toBeNull();
    await act(async () => {
      for (const resolve of startResolvers) {
        resolve();
      }
    });
    await waitFor(() => expect(queryByTestId("shell-probe")).not.toBeNull());
  });
});

describe("root layout rendered on the server (no DOM globals)", () => {
  beforeEach(() => {
    delete globalState.window;
    delete globalState.document;
    state.useFakeSyncDb = false;
    publishAdminSpaServerContext({
      appConfig: APP_CONFIG,
      basePath: "/console",
      internalOrigin: INTERNAL_ORIGIN,
      ssrApiPrefixes: ["/admin", "/auth/me"],
    });
  });

  it("builds the syncdb client and the auth and request clients on internalOrigin, never localhost:4000", () => {
    state.payload = adminPayload(WINDOWED_CONFIG);
    expect(typeof globalState.window).toBe("undefined");
    expect(typeof globalState.document).toBe("undefined");
    expect(typeof (globalThis as {indexedDB?: unknown}).indexedDB).toBe("undefined");

    const {queryByTestId} = renderWithTheme(<RootLayout />);

    expect(queryByTestId("shell-probe")).not.toBeNull();
    expect(createSyncDbConfigs.map((config) => config.baseUrl)).toEqual([INTERNAL_ORIGIN]);
    expect(authClientBaseUrls).toEqual([INTERNAL_ORIGIN]);
    expect(apiClientBaseUrls).toEqual([INTERNAL_ORIGIN]);
  });

  it("makes no request and never starts the session store or the sync client", async () => {
    state.payload = adminPayload(WINDOWED_CONFIG);

    renderWithTheme(<RootLayout />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchCalls).toEqual([]);
    expect(startCalls).toBe(0);
  });
});
