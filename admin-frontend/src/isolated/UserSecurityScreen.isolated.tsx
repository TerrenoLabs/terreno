import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {Page} from "@terreno/ui";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../AdminProvider";
import type {MemberSecuritySummary} from "../orgs/useMemberSecurityApi";
import type {AdminApi} from "../types";
import {
  UserSecurityLink,
  type UserSecurityLinkProps,
  UserSecurityScreen,
  type UserSecurityScreenProps,
  userSecurityRoute,
} from "../UserSecurityScreen";

const pushMock = mock((_href: string) => {});

// Own process (see scripts/run-tests.sh), so this replacement cannot leak into shared suites.
mock.module("expo-router", () => ({
  router: {back: mock(() => {}), push: pushMock},
}));

const api = {} as unknown as AdminApi;
const ORIGIN = "http://api.test";
const SECURITY_URL = `${ORIGIN}/users/user-1/security`;
const PANEL = "user-security-screen-panel";

interface RecordedCall {
  method: string;
  url: string;
}

interface StubResponse {
  body: unknown;
  status?: number;
}

const summaryFor = (disabled: boolean): MemberSecuritySummary => ({
  actions: [
    {destructive: true, id: "revoke-sessions", label: "Sign out everywhere"},
    {destructive: false, id: "send-password-reset", label: "Send password reset"},
    disabled
      ? {destructive: false, id: "enable", label: "Enable account"}
      : {destructive: true, id: "disable", label: "Disable account"},
  ],
  betterAuthLinked: true,
  disabled,
  emailVerified: true,
  lastSignIn: {at: null, method: "email"},
  legacyPassword: false,
  passkeys: {count: 0, items: []},
  password: true,
  providers: [],
  sessions: {active: disabled ? 0 : 1},
  twoFactor: {backupCodesRemaining: null, enabled: false},
  userId: "user-1",
});

const adminConfig = {
  models: [
    {
      defaultSort: "-created",
      displayName: "Users",
      fields: {},
      listFields: ["email"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
};

const jsonResponse = ({body, status = 200}: StubResponse): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

describe("UserSecurityScreen", () => {
  const originalFetch = globalThis.fetch;
  let calls: RecordedCall[];
  let isDisabled: boolean;
  let configResponse: StubResponse;
  let userResponse: StubResponse;
  let securityResponse: StubResponse | undefined;

  beforeEach(() => {
    pushMock.mockClear();
    calls = [];
    isDisabled = false;
    securityResponse = undefined;
    configResponse = {body: adminConfig};
    userResponse = {body: {data: {_id: "user-1", email: "ada@example.com", name: "Ada Lovelace"}}};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({method, url});
      if (url === `${ORIGIN}/admin/config`) {
        return jsonResponse(configResponse);
      }
      if (url === `${ORIGIN}/admin/users/user-1`) {
        return jsonResponse(userResponse);
      }
      if (method === "GET" && url === SECURITY_URL) {
        return jsonResponse(securityResponse ?? {body: {data: summaryFor(isDisabled)}});
      }
      if (method === "POST" && url === `${SECURITY_URL}/disable`) {
        isDisabled = true;
        return jsonResponse({body: {data: {action: "disable", changed: true}}});
      }
      return jsonResponse({body: {title: "Not found"}, status: 404});
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const renderScreen = (props: Partial<UserSecurityScreenProps> = {}) =>
    renderWithTheme(
      <AdminProvider
        api={api}
        apiBase="/admin"
        apiOrigin={ORIGIN}
        getAuthHeaders={async () => ({authorization: "Bearer test"})}
        routeBase="/admin"
      >
        <UserSecurityScreen userId="user-1" {...props} />
      </AdminProvider>
    );

  const renderLoaded = async (props: Partial<UserSecurityScreenProps> = {}) => {
    const screen = renderScreen(props);
    await waitFor(() => {
      expect(screen.getByTestId(`${PANEL}-sessions`)).toBeTruthy();
    });
    return screen;
  };

  it("shows the user from the admin record and the panel against the platform routes", async () => {
    const screen = await renderLoaded();

    await waitFor(() => {
      expect(screen.getByTestId("user-security-screen-user-name")).toBeTruthy();
    });
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getAllByTestId("user-security-screen-user-email").length).toBeGreaterThan(0);
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(calls.some((call) => call.method === "GET" && call.url === SECURITY_URL)).toBe(true);
    expect(calls.some((call) => call.url.includes("/orgs/"))).toBe(false);
    expect(screen.getByTestId(`${PANEL}-action-disable`)).toBeTruthy();
    expect(screen.queryByTestId("user-security-screen-user-error")).toBeNull();
  });

  it("clears the previous name while the next user's record is loading", async () => {
    const screen = await renderLoaded();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();

    let releaseBea: ((response: Response) => void) | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({method, url});
      if (url === `${ORIGIN}/admin/config`) {
        return jsonResponse(configResponse);
      }
      if (url === `${ORIGIN}/admin/users/user-2`) {
        return await new Promise<Response>((resolve) => {
          releaseBea = resolve;
        });
      }
      if (method === "GET" && url.endsWith("/security")) {
        return jsonResponse({body: {data: summaryFor(false)}});
      }
      return jsonResponse({body: {title: "Not found"}, status: 404});
    }) as typeof fetch;

    screen.rerender(
      <AdminProvider
        api={api}
        apiBase="/admin"
        apiOrigin={ORIGIN}
        getAuthHeaders={async () => ({authorization: "Bearer test"})}
        routeBase="/admin"
      >
        <UserSecurityScreen userId="user-2" />
      </AdminProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText("Ada Lovelace")).toBeNull();
      expect(screen.getByTestId("user-security-screen-user-loading")).toBeTruthy();
    });

    await act(async () => {
      releaseBea?.(
        jsonResponse({
          body: {data: {_id: "user-2", email: "bea@example.com", name: "Bea"}},
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Bea")).toBeTruthy();
    });
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
  });

  it("posts disable to /users/:id/security/disable after confirming and shows the new state", async () => {
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`${PANEL}-action-disable`));
    });
    expect(
      screen.getByText("The account is disabled and signed out on every device.")
    ).toBeTruthy();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);

    await act(async () => {
      fireEvent.press(screen.getByTestId(`${PANEL}-confirm.primary`));
    });

    await waitFor(() => {
      expect(screen.getByText("Account disabled")).toBeTruthy();
    });
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {method: "POST", url: `${SECURITY_URL}/disable`},
    ]);
    await waitFor(() => {
      expect(screen.getByTestId(`${PANEL}-disabled`)).toBeTruthy();
    });
    expect(screen.getByTestId(`${PANEL}-action-enable`)).toBeTruthy();
  });

  it("goes back to the admin user record by default and to backHref when set", async () => {
    const screen = await renderLoaded();
    act(() => {
      screen.UNSAFE_root.findByType(Page).props.onBack();
    });
    expect(pushMock).toHaveBeenLastCalledWith("/admin/User/user-1");

    screen.unmount();
    const custom = await renderLoaded({backHref: "/admin/people"});
    act(() => {
      custom.UNSAFE_root.findByType(Page).props.onBack();
    });
    expect(pushMock).toHaveBeenLastCalledWith("/admin/people");
  });

  it("falls back to the email when the record has no name", async () => {
    userResponse = {body: {email: "grace@example.com"}};
    const screen = await renderLoaded();

    await waitFor(() => {
      expect(screen.getByText("grace@example.com")).toBeTruthy();
    });
    expect(screen.queryByTestId("user-security-screen-user-email")).toBeNull();
  });

  it("falls back to the id when the record has neither name nor email", async () => {
    userResponse = {body: {data: {_id: "user-1", email: "  "}}};
    const screen = await renderLoaded();

    await waitFor(() => {
      expect(calls.some((call) => call.url === `${ORIGIN}/admin/users/user-1`)).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText("user-1")).toBeTruthy();
    });
    expect(screen.queryByTestId("user-security-screen-user-email")).toBeNull();
    expect(screen.queryByTestId("user-security-screen-user-error")).toBeNull();
  });

  it("shows the server's refusal in the panel and keeps the header when the target is out of reach", async () => {
    securityResponse = {body: {title: "Target holds permissions you lack"}, status: 403};
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId(`${PANEL}-error`)).toBeTruthy();
    });
    expect(screen.getByText("Target holds permissions you lack")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    });
    expect(screen.queryByTestId(`${PANEL}-action-disable`)).toBeNull();
    expect(screen.queryByTestId("user-security-screen-user-error")).toBeNull();
  });

  it("names the user by id when the user model is not in the admin config", async () => {
    configResponse = {body: {models: []}};
    const screen = await renderLoaded();

    await waitFor(() => {
      expect(screen.getByTestId("user-security-screen-user-name")).toBeTruthy();
    });
    expect(screen.getByText("user-1")).toBeTruthy();
    expect(calls.some((call) => call.url.includes("/admin/users/"))).toBe(false);
  });

  it("reads the record from a custom user model and shows an error when it fails to load", async () => {
    configResponse = {
      body: {models: [{...adminConfig.models[0], name: "Account", routePath: "/admin/users"}]},
    };
    userResponse = {body: {title: "Forbidden"}, status: 403};
    const screen = await renderLoaded({userModelName: "Account"});

    await waitFor(() => {
      expect(screen.getByTestId("user-security-screen-user-error")).toBeTruthy();
    });
    expect(screen.getByText("Could not load the user record.")).toBeTruthy();
    expect(screen.getByText("user-1")).toBeTruthy();
    // The panel still loads: the security routes do not depend on the admin record.
    expect(screen.getByTestId(`${PANEL}-action-disable`)).toBeTruthy();
  });

  it("shows a loading state while the user record loads", () => {
    const screen = renderScreen();
    expect(screen.getByTestId("user-security-screen-user-loading")).toBeTruthy();
  });
});

describe("UserSecurityLink", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  const renderLink = (props: Partial<UserSecurityLinkProps> = {}, routeBase?: string) => {
    const link = <UserSecurityLink userId="user 1" {...props} />;
    if (!routeBase) {
      return renderWithTheme(link);
    }
    return renderWithTheme(
      <AdminProvider api={api} apiBase="/admin" routeBase={routeBase}>
        {link}
      </AdminProvider>
    );
  };

  it("builds the security route under the admin route base", () => {
    expect(userSecurityRoute({userId: "abc"})).toBe("/admin/users/abc/security");
    expect(userSecurityRoute({routeBase: "/staff", userId: "a/b"})).toBe(
      "/staff/users/a%2Fb/security"
    );
  });

  it("opens the security screen under the provider's route base", async () => {
    const screen = renderLink({}, "/staff");
    await act(async () => {
      fireEvent.press(screen.getByTestId("admin-user-security-link"));
    });
    expect(pushMock).toHaveBeenLastCalledWith("/staff/users/user%201/security");
  });

  it("defaults to /admin without a provider and honors href", async () => {
    const screen = renderLink();
    await act(async () => {
      fireEvent.press(screen.getByTestId("admin-user-security-link"));
    });
    expect(pushMock).toHaveBeenLastCalledWith("/admin/users/user%201/security");

    screen.unmount();
    const custom = renderLink({href: "/elsewhere", testID: "custom-link"});
    await act(async () => {
      fireEvent.press(custom.getByTestId("custom-link"));
    });
    expect(pushMock).toHaveBeenLastCalledWith("/elsewhere");
  });
});
