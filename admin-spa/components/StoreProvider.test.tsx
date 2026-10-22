import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import type {FetchLike} from "@terreno/syncdb/api";
import {act, waitFor} from "@testing-library/react-native";
import React from "react";
import {Text} from "react-native";
import {renderWithTheme} from "../../ui/src/test-utils";
import type {AdminSpaAppConfig} from "./AppConfigGate";
import {useAdminSpaProfile} from "./adminSpaProfile";

// `@terreno/syncdb/auth` also exports the Expo (native) client factory. The SPA never calls
// it, but loading it needs native modules the test runtime does not provide.
mock.module("expo-secure-store", () => ({
  deleteItemAsync: async (): Promise<void> => {},
  getItem: (): null => null,
  setItem: (): void => {},
}));
mock.module("@better-auth/expo/client", () => ({expoClient: () => ({id: "expo"})}));

interface RecordedRequest {
  credentials?: RequestCredentials;
  method: string;
  url: string;
}

interface FakeBackend {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
  /** Whether `get-session` reports a signed-in session. */
  state: {isSignedIn: boolean};
}

const SESSION_USER = {
  createdAt: "2026-01-01T00:00:00.000Z",
  email: "admin@example.com",
  emailVerified: true,
  id: "user-1",
  image: null,
  name: "Admin",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

/** One fake backend for the auth client (get-session, sign-out) and the request client. */
const createFakeBackend = (): FakeBackend => {
  const requests: RecordedRequest[] = [];
  const state = {isSignedIn: true};
  const fetchImpl: FetchLike = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    requests.push({credentials: init?.credentials, method, url});
    if (url.endsWith("/get-session")) {
      return json(
        state.isSignedIn
          ? {
              session: {expiresAt: "2099-01-01T00:00:00.000Z", id: "s1", userId: "user-1"},
              user: SESSION_USER,
            }
          : null
      );
    }
    if (url.endsWith("/sign-out")) {
      state.isSignedIn = false;
      return json({success: true});
    }
    if (url === "/auth/me") {
      return json({data: {_id: "user-1", roles: ["operator"]}});
    }
    return json({title: "Not found"}, 404);
  };
  return {fetchImpl, requests, state};
};

const appConfigState: {appConfig: AdminSpaAppConfig} = {
  appConfig: {brandName: "Admin", primaryColor: "#000000", providers: ["email"]},
};

let useSession: typeof import("@terreno/syncdb/auth").useSession;
let StoreProvider: typeof import("./StoreProvider").StoreProvider;
let createAdminSpaClients: typeof import("./StoreProvider").createAdminSpaClients;
let resolveAdminSpaOrigin: typeof import("./StoreProvider").resolveAdminSpaOrigin;
let useAuthClient: typeof import("./StoreProvider").useAuthClient;

const SessionProbe: React.FC = () => {
  const {isAuthenticated, isLoading, logout, userId} = useSession();
  const {data: profile} = useAdminSpaProfile();
  const authClient = useAuthClient();
  const label = isLoading ? "loading" : isAuthenticated ? `signed-in:${userId}` : "signed-out";
  return (
    <>
      <Text testID="probe-session">{label}</Text>
      <Text testID="probe-roles">{(profile?.roles ?? []).join(",")}</Text>
      <Text testID="probe-has-auth-client">{String(typeof authClient.signIn.email)}</Text>
      <Text onPress={(): void => void logout()} testID="probe-logout">
        Log out
      </Text>
    </>
  );
};

const textOf = (node: {props: {children?: unknown}}): string => String(node.props.children);

describe("StoreProvider", () => {
  beforeAll(async () => {
    // StoreProvider reads the loaded app-config; serve it without fetching app-config.json.
    mock.module(new URL("./AppConfigGate.tsx", import.meta.url).pathname, () => ({
      useAppConfig: () => ({appConfig: appConfigState.appConfig, basePath: ""}),
    }));
    ({useSession} = await import("@terreno/syncdb/auth"));
    ({createAdminSpaClients, resolveAdminSpaOrigin, StoreProvider, useAuthClient} = await import(
      "./StoreProvider"
    ));
  });

  beforeEach(() => {
    appConfigState.appConfig = {brandName: "Admin", primaryColor: "#000000", providers: ["email"]};
  });

  it("resolves the cookie session and loads /auth/me with same-origin credentials", async () => {
    const backend = createFakeBackend();
    const {getByTestId} = renderWithTheme(
      <StoreProvider fetchImpl={backend.fetchImpl}>
        <SessionProbe />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(textOf(getByTestId("probe-session"))).toBe("signed-in:user-1");
      expect(textOf(getByTestId("probe-roles"))).toBe("operator");
    });
    expect(textOf(getByTestId("probe-has-auth-client"))).toBe("function");
    expect(backend.requests).toContainEqual({
      credentials: "same-origin",
      method: "GET",
      url: "/auth/me",
    });
    const sessionRequest = backend.requests.find((request) => request.url.endsWith("/get-session"));
    expect(sessionRequest?.url).toBe(`${resolveAdminSpaOrigin()}/api/auth/get-session`);
  });

  it("reports a signed-out visitor when Better Auth has no session", async () => {
    const backend = createFakeBackend();
    backend.state.isSignedIn = false;
    const {getByTestId} = renderWithTheme(
      <StoreProvider fetchImpl={backend.fetchImpl}>
        <SessionProbe />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(textOf(getByTestId("probe-session"))).toBe("signed-out");
    });
  });

  it("uses the app-config authBasePath for Better Auth requests", async () => {
    appConfigState.appConfig = {...appConfigState.appConfig, authBasePath: "/console/api/auth"};
    const backend = createFakeBackend();
    const {getByTestId} = renderWithTheme(
      <StoreProvider fetchImpl={backend.fetchImpl}>
        <SessionProbe />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(textOf(getByTestId("probe-session"))).toBe("signed-in:user-1");
    });
    expect(
      backend.requests.some((request) => request.url.endsWith("/console/api/auth/get-session"))
    ).toBe(true);
  });

  it("logout signs out of Better Auth, clears the session, and drops cached requests", async () => {
    const backend = createFakeBackend();
    const {getByTestId} = renderWithTheme(
      <StoreProvider fetchImpl={backend.fetchImpl}>
        <SessionProbe />
      </StoreProvider>
    );
    await waitFor(() => {
      expect(textOf(getByTestId("probe-roles"))).toBe("operator");
    });
    const profileRequestsBefore = backend.requests.filter((r) => r.url === "/auth/me").length;

    await act(async () => {
      getByTestId("probe-logout").props.onPress();
    });

    await waitFor(() => {
      expect(textOf(getByTestId("probe-session"))).toBe("signed-out");
    });
    expect(backend.requests.some((request) => request.url.endsWith("/sign-out"))).toBe(true);
    // The reset cache entry is refetched for the still-mounted profile subscriber.
    await waitFor(() => {
      expect(backend.requests.filter((r) => r.url === "/auth/me").length).toBe(
        profileRequestsBefore + 1
      );
    });
  });

  it("useAuthClient throws outside StoreProvider", () => {
    const Orphan: React.FC = () => {
      useAuthClient();
      return null;
    };
    const originalError = console.error;
    console.error = (): void => {};
    try {
      expect(() => renderWithTheme(<Orphan />)).toThrow(
        "useAuthClient must be used within <StoreProvider>"
      );
    } finally {
      console.error = originalError;
    }
  });
});

describe("createAdminSpaClients", () => {
  it("defaults the auth base path to /api/auth on the given origin", async () => {
    const backend = createFakeBackend();
    const {authClient} = createAdminSpaClients({
      fetchImpl: backend.fetchImpl,
      origin: "https://admin.example.com",
    });

    await authClient.getSession();

    expect(backend.requests[0]?.url).toBe("https://admin.example.com/api/auth/get-session");
  });

  it("builds a request client that sends relative URLs with the session cookie", async () => {
    const backend = createFakeBackend();
    const {apiClient} = createAdminSpaClients({
      authBasePath: "/auth",
      fetchImpl: backend.fetchImpl,
      origin: "https://admin.example.com",
    });

    const profile = await apiClient.request<{roles: string[]}>({url: "/auth/me"});

    expect(profile.roles).toEqual(["operator"]);
    expect(backend.requests).toEqual([
      {credentials: "same-origin", method: "GET", url: "/auth/me"},
    ]);
  });
});
