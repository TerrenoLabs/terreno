import {afterAll, beforeAll, describe, expect, it, mock} from "bun:test";
import type {FetchLike} from "@terreno/syncdb/api";
import {act, waitFor} from "@testing-library/react-native";
import React, {useLayoutEffect} from "react";
import {Text} from "react-native";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {serializeForHtml} from "../serverContext";

// Isolated file: it mocks AppConfigGate and installs a fake `document`. It uses the REAL
// `useSsrPayload` (the layout tests mock it), because the regression is about its behavior
// across a StoreProvider remount: a login page's payload says "signed out", and after the
// operator signs in, a remount must read live state, not that payload.

mock.module("expo-secure-store", () => ({
  deleteItemAsync: async (): Promise<void> => {},
  getItem: (): null => null,
  setItem: (): void => {},
}));
mock.module("@better-auth/expo/client", () => ({expoClient: () => ({id: "expo"})}));
mock.module(new URL("../../components/AppConfigGate.tsx", import.meta.url).pathname, () => ({
  useAppConfig: () => ({
    appConfig: {brandName: "Admin", primaryColor: "#000000", providers: ["email"]},
    basePath: "",
  }),
}));

const globals = globalThis as unknown as Record<string, unknown>;
const hadDocument = "document" in globals;
const originalDocument = globals.document;

const SESSION_USER = {
  createdAt: "2026-01-01T00:00:00.000Z",
  email: "member@example.com",
  emailVerified: true,
  id: "user-1",
  image: null,
  name: "Member",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LOGIN_PAYLOAD = {
  adminConfig: null,
  adminConfigStatus: null,
  appConfig: {brandName: "Admin", primaryColor: "#000000", providers: ["email"]},
  basePath: "/console",
  profile: null,
  session: null,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

const state = {isSignedIn: false};
const fetchImpl: FetchLike = async (input) => {
  const url = String(input);
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
  return json({title: "Not found"}, 404);
};

const labels: string[] = [];
let refreshSession: () => Promise<void> = async () => undefined;

let useSession: typeof import("@terreno/syncdb/auth").useSession;
let StoreProvider: typeof import("../../components/StoreProvider").StoreProvider;

const Probe: React.FC = () => {
  const session = useSession();
  refreshSession = session.refresh;
  const label = session.isLoading
    ? "loading"
    : session.isAuthenticated
      ? `signed-in:${session.userId}`
      : "signed-out";
  // What each committed render showed, so a transient signed-out frame cannot hide.
  useLayoutEffect(() => {
    labels.push(label);
  });
  return <Text testID="probe-session">{label}</Text>;
};

beforeAll(async () => {
  let scriptRemoved = false;
  globals.document = {
    getElementById: (id: string): unknown => {
      if (id !== "admin-spa-ssr" || scriptRemoved) {
        return null;
      }
      return {
        remove: (): void => {
          scriptRemoved = true;
        },
        textContent: serializeForHtml(LOGIN_PAYLOAD),
      };
    },
    querySelectorAll: (): unknown[] => [],
  };
  ({useSession} = await import("@terreno/syncdb/auth"));
  ({StoreProvider} = await import("../../components/StoreProvider"));
});

afterAll(() => {
  if (hadDocument) {
    globals.document = originalDocument;
  } else {
    delete globals.document;
  }
});

describe("StoreProvider remounted after sign-in on a server-rendered login page", () => {
  it("never reports signed-out once the member has signed in", async () => {
    const tree = (key: string): React.ReactElement => (
      <StoreProvider fetchImpl={fetchImpl} key={key}>
        <Probe />
      </StoreProvider>
    );
    const {getByTestId, rerender} = renderWithTheme(tree("first"));
    // The login page's payload seeds a signed-out session.
    expect(String(getByTestId("probe-session").props.children)).toBe("signed-out");

    state.isSignedIn = true;
    await act(async () => {
      await refreshSession();
    });
    await waitFor(() => {
      expect(String(getByTestId("probe-session").props.children)).toBe("signed-in:user-1");
    });

    const signedInAt = labels.length;
    // The layout remounts the provider (for example after the redirect away from /login).
    rerender(tree("second"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => {
      expect(String(getByTestId("probe-session").props.children)).toBe("signed-in:user-1");
    });
    expect(labels.slice(signedInAt)).not.toContain("signed-out");
  });
});
