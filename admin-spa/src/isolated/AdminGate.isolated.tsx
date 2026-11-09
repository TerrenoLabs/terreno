import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {Text} from "@terreno/ui";
import {waitFor} from "@testing-library/react-native";
import {usePathname} from "expo-router";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

// Isolated file: it registers mocks that would leak into other suites. `@terreno/syncdb/auth`
// also exports the Expo (native) client factory, whose native modules the test runtime lacks.
type GateComponent = React.FC<{children: React.ReactNode}>;

const globalState = globalThis as unknown as {window?: Record<string, unknown>};
const hadWindow = "window" in globalState;
const originalWindow = globalState.window;

let AdminGate: GateComponent;
let AppConfigGate: GateComponent;
let SessionProvider: React.FC<{children: React.ReactNode; store: unknown}>;
let createPendingStore: () => unknown;

beforeAll(async () => {
  // The admin probe resolves as a 200 (admin) once there is a session; the real hook would
  // fetch `/admin/config`, and a relative URL has no origin in the test runtime.
  const realAdminFrontend = await import("@terreno/admin-frontend");
  mock.module("@terreno/admin-frontend", () => ({
    ...realAdminFrontend,
    useAdminRpcQuery: ({skip}: {skip?: boolean}) => ({
      data: skip ? undefined : {models: []},
      error: null,
      isLoading: false,
    }),
  }));
  mock.module("expo-secure-store", () => ({
    deleteItemAsync: async (): Promise<void> => {},
    getItem: (): null => null,
    setItem: (): void => {},
  }));
  mock.module("@better-auth/expo/client", () => ({expoClient: () => ({id: "expo"})}));
  const auth = await import("@terreno/syncdb/auth");
  SessionProvider = auth.SessionProvider as unknown as typeof SessionProvider;
  // A session read that never settles keeps `useSession().isLoading` true for the whole test.
  createPendingStore = (): unknown =>
    auth.createSessionStore({
      pollIntervalMs: 0,
      source: {
        getSession: () => new Promise<null>(() => {}),
        signOut: async (): Promise<void> => {},
      },
    });
  ({AdminGate} = await import("../../components/AdminGate"));
  ({AppConfigGate} = await import("../../components/AppConfigGate"));
});

const renderGate = (pathname: string): ReturnType<typeof renderWithTheme> => {
  (usePathname as unknown as {mockReturnValue: (value: string) => void}).mockReturnValue(pathname);
  return renderWithTheme(
    <AppConfigGate>
      <SessionProvider store={createPendingStore()}>
        <AdminGate>
          <Text testID="gate-child">child</Text>
        </AdminGate>
      </SessionProvider>
    </AppConfigGate>
  );
};

beforeEach(() => {
  globalState.window = {
    __ADMIN_SPA_BASE__: "/console",
    __ADMIN_SPA_CONFIG__: {brandName: "Injected Brand", primaryColor: "#2563EB", providers: []},
  };
});

afterEach(() => {
  (usePathname as unknown as {mockReturnValue: (value: string) => void}).mockReturnValue("/");
  if (hadWindow) {
    globalState.window = originalWindow;
  } else {
    delete globalState.window;
  }
});

describe("AdminGate while the session is loading", () => {
  it("renders the children on /login so the server-rendered login form is not replaced", () => {
    const {queryByTestId} = renderGate("/login");
    expect(queryByTestId("gate-child")).not.toBeNull();
    expect(queryByTestId("admin-spa-admin-gate-loading")).toBeNull();
  });

  it("renders the spinner on /", () => {
    const {queryByTestId} = renderGate("/");
    expect(queryByTestId("admin-spa-admin-gate-loading")).not.toBeNull();
    expect(queryByTestId("gate-child")).toBeNull();
  });

  it("renders the spinner on another protected route", () => {
    const {queryByTestId} = renderGate("/forbidden");
    expect(queryByTestId("admin-spa-admin-gate-loading")).not.toBeNull();
    expect(queryByTestId("gate-child")).toBeNull();
  });
});

describe("AdminGate for an admin on /login", () => {
  // Fake session + admin config so the gate resolves to "admin" on first render.
  const renderAdminOnLogin = async (
    returnTo: string | string[] | undefined
  ): Promise<{replace: ReturnType<typeof mock>}> => {
    const replace = mock(() => {});
    const expoRouter = (await import("expo-router")) as unknown as {
      useGlobalSearchParams: {mockReturnValue: (value: unknown) => void};
      useRouter: {mockReturnValue: (value: unknown) => void};
      usePathname: {mockReturnValue: (value: string) => void};
    };
    expoRouter.usePathname.mockReturnValue("/login");
    expoRouter.useRouter.mockReturnValue({replace});
    expoRouter.useGlobalSearchParams.mockReturnValue({returnTo});
    const auth = await import("@terreno/syncdb/auth");
    const store = auth.createSessionStore({
      pollIntervalMs: 0,
      source: {
        getSession: async () => ({user: {id: "ba1"}, userId: "ba1"}),
        signOut: async (): Promise<void> => {},
      },
    } as never);
    renderWithTheme(
      <AppConfigGate>
        <SessionProvider store={store}>
          <AdminGate>
            <Text testID="gate-child">child</Text>
          </AdminGate>
        </SessionProvider>
      </AppConfigGate>
    );
    await waitFor(() => expect(replace).toHaveBeenCalled());
    return {replace};
  };

  it("sends the admin to a valid returnTo", async () => {
    const {replace} = await renderAdminOnLogin("/todos");
    expect(replace).toHaveBeenCalledWith("/todos");
  });

  it("sends the admin to / when returnTo is unsafe", async () => {
    const {replace} = await renderAdminOnLogin("//evil.example");
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("sends the admin to / when there is no returnTo", async () => {
    const {replace} = await renderAdminOnLogin(undefined);
    expect(replace).toHaveBeenCalledWith("/");
  });
});
