/**
 * Isolated tests for TerrenoOAuthConsentScreen. `@terreno/ui` cannot render under the test
 * preload's react-native stub, so it is replaced with components that render a host element
 * carrying their props (so test ids, labels, `disabled`, and handlers are observable) and, for the
 * login steps, recorders like TerrenoLoginScreen.isolated.tsx. The session is a real
 * `SessionProvider` over a controllable source, and the consent endpoints are stubbed at the fetch
 * boundary of a real request client mounted through `ApiClientProvider`.
 */
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {createElement, type ReactElement, type ReactNode} from "react";
import {act, create, type ReactTestInstance, type ReactTestRenderer} from "react-test-renderer";

import {createApiClient, type FetchLike} from "../api/client";
import type {BetterAuthUser} from "../auth/betterAuthTypes";
import type {BetterAuthMethods} from "../auth/useAuthMethods";
import type {LoginControllerClient, LoginUser} from "../auth/useLoginController";
import {ApiClientProvider} from "../react/apiHooks";

// Tells React this process drives updates through act(), as @testing-library does.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("../auth/platform", () => ({IsWeb: true}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({id: "expo", name: "expo-plugin"}),
}));

const rendered: Array<{name: string; props: Record<string, unknown>}> = [];
const recorder =
  (name: string) =>
  (props: Record<string, unknown>): null => {
    rendered.push({name, props});
    return null;
  };

// Renders a host element with every prop, and the text-bearing props as children, so the text a
// screen shows through `text`, `title`, or `children` is readable from the tree.
const hostFake =
  (name: string) =>
  (props: Record<string, unknown>): ReactElement => {
    const {children, text, title, ...rest} = props;
    const parts = [title, text, children].filter(
      (part) => part !== undefined && part !== null && part !== false
    ) as ReactNode[];
    return createElement(name, rest, ...parts);
  };

// Like the real Box: a clickable Box renders its pressable as `${testID}-clickable`, so a test id
// promised on a clickable Box fails here the way it would in the app.
const boxFake = (props: Record<string, unknown>): ReactElement => {
  const {onClick, testID} = props;
  const resolved =
    onClick !== undefined && typeof testID === "string"
      ? {...props, testID: `${testID}-clickable`}
      : props;
  return hostFake("Box")(resolved);
};

// The preload's react-native stub has no Pressable; add one that renders a host element.
mock.module("react-native", () => ({
  AppState: {
    addEventListener: (): {remove: () => void} => ({remove: (): void => {}}),
    currentState: "active",
  },
  Linking: {openURL: async (): Promise<boolean> => true},
  Platform: {OS: "web"},
  Pressable: hostFake("Pressable"),
  StyleSheet: {create: (styles: unknown): unknown => styles},
}));

mock.module("@terreno/ui", () => ({
  Badge: hostFake("Badge"),
  Banner: hostFake("Banner"),
  BooleanField: hostFake("BooleanField"),
  Box: boxFake,
  Button: hostFake("Button"),
  Card: hostFake("Card"),
  CheckBox: hostFake("CheckBox"),
  ErrorPage: hostFake("ErrorPage"),
  Heading: hostFake("Heading"),
  Icon: hostFake("Icon"),
  IconButton: hostFake("IconButton"),
  Link: hostFake("Link"),
  LoginScreen: recorder("LoginScreen"),
  Page: hostFake("Page"),
  Spinner: hostFake("Spinner"),
  Text: hostFake("Text"),
  TwoFactorChallengeScreen: recorder("TwoFactorChallengeScreen"),
}));

const {createBetterAuthClient} = await import("../auth/betterAuthClient");
const {createRememberedAccountsStore} = await import("../auth/rememberedAccounts");
const {createSessionStore} = await import("../auth/session");
const {SessionProvider} = await import("../auth/SessionProvider");
const {MCP_OAUTH_CONSENT_ERROR_COPY, TerrenoOAuthConsentScreen} = await import(
  "../auth/TerrenoOAuthConsentScreen"
);

const HREF = "https://app.test/oauth/consent?request=abc";
const REQUEST_PATH = "/oauth/authorize/abc";
const REDIRECT_URL = "https://claude.ai/callback?code=granted";
const DENY_URL = "https://claude.ai/callback?error=access_denied";

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: false,
  passkey: false,
  providers: ["google", "github"],
  signUp: true,
  twoFactor: true,
};

const JANE: LoginUser = {email: "jane@example.com", id: "u1", name: "Jane"};
const JANE_SESSION = {user: JANE as unknown as BetterAuthUser, userId: "u1"};

const CONSENT = {
  clientId: "client-1",
  clientName: "Claude" as string | null,
  expiresAt: "2026-11-16T12:00:00.000Z",
  grants: [
    {access: "read" as const, description: "See your todos", label: "Read", scope: "mcp:read"},
    {access: "write" as const, description: null, label: "Write", scope: "mcp:write"},
  ],
  redirectHost: "claude.ai",
  redirectUri: "https://claude.ai/callback",
  requestId: "abc",
  resource: "https://api.test/mcp",
  scope: "mcp:read mcp:write",
};

interface Calls {
  fetches: Array<{body: unknown; method: string; path: string}>;
  redirects: string[];
  refresh: ReturnType<typeof mock>;
  social: Array<Record<string, unknown>>;
  assign: ReturnType<typeof mock>;
}

interface Setup {
  consent?: typeof CONSENT;
  getStatus?: number;
  signedIn?: boolean;
  requestId?: string;
  search?: string;
  testID?: string;
  grantLabels?: Record<string, {label: string; description?: string}>;
  loginProps?: Record<string, unknown>;
  webAuth?: "cookie" | "bearer";
  client?: LoginControllerClient;
  methods?: BetterAuthMethods;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {"Content-Type": "application/json"},
    status,
  });

const memoryStorage = (): Record<string, unknown> => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    removeItem: (key: string): void => {
      values.delete(key);
    },
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
};

const memoryRemembered = (): ReturnType<typeof createRememberedAccountsStore> =>
  createRememberedAccountsStore({
    rememberIdentity: false,
    storage: memoryStorage() as never,
  });

const globalWithWindow = globalThis as unknown as {window?: unknown};
const originalFetch = globalThis.fetch;

const leaves = (node: ReactTestInstance): string[] =>
  node.children.flatMap((child) => (typeof child === "string" ? [child] : leaves(child)));

describe("TerrenoOAuthConsentScreen", () => {
  let renderer: ReactTestRenderer | undefined;
  let calls: Calls;
  // Whether the fake auth server holds a session; sign-in calls flip it.
  let isSignedInOnServer = false;

  const hostsWithTestId = (id: string): ReactTestInstance[] =>
    renderer?.root.findAll((node) => typeof node.type === "string" && node.props.testID === id) ??
    [];
  const byId = (id: string): ReactTestInstance => {
    const [node] = hostsWithTestId(id);
    if (!node) {
      throw new Error(`No element with testID ${id}`);
    }
    return node;
  };
  const hasId = (id: string): boolean => hostsWithTestId(id).length > 0;
  const family = (node: ReactTestInstance): ReactTestInstance[] => [
    node,
    ...node.findAll((child) => typeof child.type === "string" && child !== node),
  ];
  const checkedOf = (node: ReactTestInstance): boolean | undefined => {
    for (const member of family(node)) {
      for (const key of ["selected", "value", "checked", "isChecked", "isSelected"]) {
        if (typeof member.props[key] === "boolean") {
          return member.props[key] as boolean;
        }
      }
    }
    return undefined;
  };
  const isDisabled = (node: ReactTestInstance): boolean =>
    family(node).some((member) => member.props.disabled === true);
  const handlerOf = (node: ReactTestInstance): ((...args: unknown[]) => unknown) => {
    for (const member of family(node)) {
      for (const key of ["onClick", "onPress", "onChange", "onValueChange"]) {
        if (typeof member.props[key] === "function") {
          return member.props[key] as (...args: unknown[]) => unknown;
        }
      }
    }
    throw new Error("Element has no press handler");
  };
  const press = async (id: string, ...args: unknown[]): Promise<void> => {
    const node = byId(id);
    const checked = checkedOf(node);
    await act(async () => {
      await handlerOf(node)(
        ...(args.length ? args : [checked === undefined ? undefined : !checked])
      );
    });
    await flush();
  };
  const lastRecorded = (name: string): Record<string, unknown> => {
    const props = rendered.filter((entry) => entry.name === name).at(-1)?.props;
    if (!props) {
      throw new Error(`${name} never rendered`);
    }
    return props;
  };
  const flush = async (): Promise<void> => {
    for (let index = 0; index < 10; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  };

  const fakeClient = (methods: BetterAuthMethods): LoginControllerClient => ({
    $fetch: async () => ({data: methods, error: null}),
    getSession: async () =>
      isSignedInOnServer
        ? ({data: {session: {}, user: JANE}, error: null} as never)
        : {data: null, error: null},
    signIn: {
      email: async () => {
        isSignedInOnServer = true;
        return {data: {user: JANE}, error: null} as never;
      },
      passkey: async () => ({data: null, error: null}),
      social: async (options) => {
        calls.social.push(options as Record<string, unknown>);
        return {data: {redirect: false}, error: null} as never;
      },
    },
    twoFactor: {
      verifyBackupCode: async () => ({data: {user: JANE}, error: null}),
      verifyTotp: async () => {
        isSignedInOnServer = true;
        return {data: {user: JANE}, error: null} as never;
      },
    },
  });

  const mount = async (setup: Setup = {}): Promise<void> => {
    const consent = setup.consent ?? CONSENT;
    const fetchImpl: FetchLike = async (input, init) => {
      const method = init?.method ?? "GET";
      const path = new URL(input).pathname;
      calls.fetches.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method,
        path,
      });
      if (method === "GET") {
        const status = setup.getStatus ?? 200;
        return status === 200 ? json(200, {data: consent}) : json(status, {title: "failed"});
      }
      if (path.endsWith("/approve")) {
        return json(200, {data: {redirectUrl: REDIRECT_URL}});
      }
      return json(200, {data: {redirectUrl: DENY_URL}});
    };
    const apiClient = createApiClient({baseUrl: "http://api.test", fetchImpl});
    isSignedInOnServer = Boolean(setup.signedIn);
    const store = createSessionStore({
      initialSession: setup.signedIn ? JANE_SESSION : null,
      pollIntervalMs: 0,
      source: {
        getSession: async () => (isSignedInOnServer ? JANE_SESSION : null),
        signOut: async () => {},
      },
    });
    const realRefresh = store.refresh;
    calls.refresh = mock(() => realRefresh());
    store.refresh = calls.refresh as never;

    const loginProps = {
      client: setup.client ?? fakeClient(setup.methods ?? METHODS),
      rememberedAccounts: memoryRemembered(),
      webAuth: setup.webAuth ?? "cookie",
      ...setup.loginProps,
    };
    await act(async () => {
      renderer = create(
        <SessionProvider store={store}>
          <ApiClientProvider client={apiClient}>
            <TerrenoOAuthConsentScreen
              grantLabels={setup.grantLabels}
              loginProps={loginProps as never}
              onRedirect={(url: string) => calls.redirects.push(url)}
              requestId={setup.requestId}
              testID={setup.testID}
            />
          </ApiClientProvider>
        </SessionProvider>
      );
    });
    await flush();
  };

  beforeEach(() => {
    rendered.length = 0;
    calls = {
      assign: mock((_url: string) => {}),
      fetches: [],
      redirects: [],
      refresh: mock(() => Promise.resolve()),
      social: [],
    };
    globalWithWindow.window = {
      localStorage: memoryStorage(),
      location: {assign: calls.assign, href: HREF, search: "?request=abc"},
      sessionStorage: memoryStorage(),
    };
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    globalThis.fetch = originalFetch;
    delete globalWithWindow.window;
  });

  describe("MCP_OAUTH_CONSENT_ERROR_COPY", () => {
    it("holds the exact title and message for all six error kinds", () => {
      expect(MCP_OAUTH_CONSENT_ERROR_COPY).toEqual({
        decided: {
          message:
            "This request was already approved or denied. Start the connection again from your app.",
          title: "Request already decided",
        },
        expired: {
          message: "Authorization requests expire after a few minutes. Start the connection again.",
          title: "Request expired",
        },
        missingRequest: {
          message:
            "This link has no authorization request. Start the connection again from your app.",
          title: "Missing authorization request",
        },
        notFound: {
          message: "This authorization request does not exist. Check the link or start again.",
          title: "Request not found",
        },
        signedOut: {
          message: "Your session ended, or this browser cannot decide this request. Sign in again.",
          title: "Sign in required",
        },
        unknown: {
          message: "Something went wrong loading or deciding this request. Try again.",
          title: "Could not complete the request",
        },
      });
    });
  });

  describe("signed out", () => {
    it("renders the login screen with loginProps.methods applied and no consent card", async () => {
      await mount({
        loginProps: {methods: {providers: ["google"]}},
        methods: {...METHODS, providers: ["google", "github", "apple"]},
      });
      const login = lastRecorded("LoginScreen");
      expect(
        (login.oauthProviders as Array<{provider: string}>).map(({provider}) => provider)
      ).toEqual(["google"]);
      expect(hasId("oauth-consent-client-name")).toBe(false);
      expect(hasId("oauth-consent-approve-button")).toBe(false);
      expect(calls.fetches).toEqual([]);
    });

    it("passes loginProps title through to the login screen", async () => {
      await mount({loginProps: {title: "Sign in to connect"}});
      expect(lastRecorded("LoginScreen").title).toBe("Sign in to connect");
    });

    it("signs in inline: refresh once, then the consent card renders", async () => {
      await mount();
      const login = lastRecorded("LoginScreen");
      await act(async () => {
        await (login.onSubmit as (values: Record<string, string>) => Promise<void>)({
          email: "jane@example.com",
          password: "pw",
        });
      });
      await flush();
      expect(calls.refresh).toHaveBeenCalledTimes(1);
      expect(hasId("oauth-consent-client-name")).toBe(true);
      expect(leaves(byId("oauth-consent-client-name"))).toContain("Claude");
      expect(calls.assign).not.toHaveBeenCalled();
      expect(calls.redirects).toEqual([]);
    });

    it("shows the two-factor challenge inline, then the consent card, with no navigation", async () => {
      const client = fakeClient(METHODS);
      client.signIn.email = (async () => ({
        data: {twoFactorMethods: ["totp"], twoFactorRedirect: true},
        error: null,
      })) as never;
      await mount({client});
      const login = lastRecorded("LoginScreen");
      await act(async () => {
        await (login.onSubmit as (values: Record<string, string>) => Promise<void>)({
          email: "jane@example.com",
          password: "pw",
        });
      });
      await flush();
      const challenge = lastRecorded("TwoFactorChallengeScreen");
      expect(hasId("oauth-consent-client-name")).toBe(false);

      await act(async () => {
        await (challenge.onSubmit as (values: unknown) => Promise<void>)({
          code: "123456",
          kind: "totp",
          trustDevice: false,
        });
      });
      await flush();
      expect(calls.refresh).toHaveBeenCalledTimes(1);
      expect(hasId("oauth-consent-client-name")).toBe(true);
      expect(calls.assign).not.toHaveBeenCalled();
      expect(calls.redirects).toEqual([]);
    });

    it("defaults the social callbackURL to the current href including ?request=abc", async () => {
      await mount();
      const login = lastRecorded("LoginScreen");
      await act(async () => {
        await (login.oauthProviders as Array<{onPress: () => Promise<void>}>)[0].onPress();
      });
      expect(calls.social).toHaveLength(1);
      expect(calls.social[0].callbackURL).toBe(HREF);
    });

    it("defaults the callbackURL to the href in bearer mode too", async () => {
      globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        return url.includes("/terreno/methods") ? Response.json(METHODS) : Response.json(null);
      }) as typeof fetch;
      const client = createBetterAuthClient({
        baseURL: "http://api.test",
        features: {twoFactor: true},
        scheme: "terreno",
        webAuth: "bearer",
      });
      await mount({client: client as never, webAuth: "bearer"});
      const login = lastRecorded("LoginScreen");
      await act(async () => {
        await (login.oauthProviders as Array<{onPress: () => Promise<void>}>)[0].onPress();
      });
      const started = new URL(calls.assign.mock.calls[0][0] as string);
      expect(started.pathname).toBe("/api/auth/oauth-handoff/start");
      const callback = new URL(started.searchParams.get("callbackURL") ?? "");
      expect(callback.pathname).toBe("/oauth/consent");
      // The handoff adds its own `handoff` nonce; `request` must survive.
      expect(callback.searchParams.get("request")).toBe("abc");
    });

    it("passes loginProps.callbackURL through unchanged", async () => {
      await mount({loginProps: {callbackURL: "/custom/return?x=1"}});
      const login = lastRecorded("LoginScreen");
      await act(async () => {
        await (login.oauthProviders as Array<{onPress: () => Promise<void>}>)[0].onPress();
      });
      expect(calls.social[0].callbackURL).toBe("/custom/return?x=1");
    });
  });

  describe("signed in", () => {
    it("shows the screen root, client name, redirect host, signed-in email, and both buttons", async () => {
      await mount({signedIn: true});
      expect(hasId("oauth-consent-screen")).toBe(true);
      expect(leaves(byId("oauth-consent-client-name"))).toContain("Claude");
      expect(leaves(byId("oauth-consent-screen")).join(" ")).toContain("claude.ai");
      expect(leaves(byId("oauth-consent-signed-in-as")).join(" ")).toContain("jane@example.com");
      expect(hasId("oauth-consent-approve-button")).toBe(true);
      expect(hasId("oauth-consent-deny-button")).toBe(true);
      expect(hasId("oauth-consent-error")).toBe(false);
      expect(calls.fetches[0]).toMatchObject({method: "GET", path: REQUEST_PATH});
    });

    it("shows 2 checked checkboxes with the server labels", async () => {
      await mount({signedIn: true});
      const read = byId("oauth-consent-grant-mcp:read");
      const write = byId("oauth-consent-grant-mcp:write");
      expect(checkedOf(read)).toBe(true);
      expect(checkedOf(write)).toBe(true);
      expect(leaves(read)).toContain("Read");
      expect(leaves(read)).toContain("See your todos");
      expect(leaves(write)).toContain("Write");
    });

    it("shows the grantLabels override instead of the server label", async () => {
      await mount({
        grantLabels: {"mcp:read": {description: "Look at todos", label: "View todos"}},
        signedIn: true,
      });
      const read = leaves(byId("oauth-consent-grant-mcp:read"));
      expect(read).toContain("View todos");
      expect(read).toContain("Look at todos");
      expect(read).not.toContain("Read");
      expect(leaves(byId("oauth-consent-grant-mcp:write"))).toContain("Write");
    });

    it("disables Approve when both grants are unchecked", async () => {
      await mount({signedIn: true});
      expect(isDisabled(byId("oauth-consent-approve-button"))).toBe(false);
      await press("oauth-consent-grant-mcp:read");
      await press("oauth-consent-grant-mcp:write");
      expect(checkedOf(byId("oauth-consent-grant-mcp:read"))).toBe(false);
      expect(checkedOf(byId("oauth-consent-grant-mcp:write"))).toBe(false);
      expect(isDisabled(byId("oauth-consent-approve-button"))).toBe(true);
    });

    it("Approve calls onRedirect with the server URL", async () => {
      await mount({signedIn: true});
      await press("oauth-consent-approve-button");
      expect(calls.redirects).toEqual([REDIRECT_URL]);
      expect(calls.fetches.find((call) => call.method === "POST")).toMatchObject({
        body: {scope: "mcp:read mcp:write"},
        path: `${REQUEST_PATH}/approve`,
      });
    });

    it("Approve after unchecking one grant narrows the approved scope", async () => {
      await mount({signedIn: true});
      await press("oauth-consent-grant-mcp:write");
      await press("oauth-consent-approve-button");
      expect(calls.fetches.find((call) => call.method === "POST")?.body).toEqual({
        scope: "mcp:read",
      });
      expect(calls.redirects).toEqual([REDIRECT_URL]);
    });

    it("Deny calls onRedirect with the deny URL", async () => {
      await mount({signedIn: true});
      await press("oauth-consent-deny-button");
      expect(calls.redirects).toEqual([DENY_URL]);
      expect(calls.fetches.find((call) => call.method === "POST")?.path).toBe(
        `${REQUEST_PATH}/deny`
      );
    });

    it("shows 'An unnamed MCP client' when clientName is null", async () => {
      await mount({consent: {...CONSENT, clientName: null}, signedIn: true});
      expect(leaves(byId("oauth-consent-client-name"))).toContain("An unnamed MCP client");
    });

    it("uses an explicit requestId prop over the URL", async () => {
      await mount({requestId: "other", signedIn: true});
      expect(calls.fetches[0].path).toBe("/oauth/authorize/other");
    });

    it("prefixes every test id with a custom testID", async () => {
      await mount({signedIn: true, testID: "connect"});
      for (const id of [
        "connect-screen",
        "connect-client-name",
        "connect-grant-mcp:read",
        "connect-approve-button",
        "connect-deny-button",
        "connect-signed-in-as",
      ]) {
        expect(hasId(id)).toBe(true);
      }
    });
  });

  describe("errors", () => {
    const cases: Array<{kind: keyof typeof MCP_OAUTH_CONSENT_ERROR_COPY; setup: Setup}> = [
      {kind: "missingRequest", setup: {}},
      {kind: "notFound", setup: {getStatus: 404}},
      {kind: "decided", setup: {getStatus: 409}},
      {kind: "expired", setup: {getStatus: 400}},
      {kind: "signedOut", setup: {getStatus: 401}},
      {kind: "unknown", setup: {getStatus: 500}},
    ];

    for (const {kind, setup} of cases) {
      it(`${kind} shows its exact title and message in oauth-consent-error`, async () => {
        if (kind === "missingRequest") {
          // No ?request= in the URL and no requestId prop.
          (globalWithWindow.window as {location: {href: string; search: string}}).location.href =
            "https://app.test/oauth/consent";
          (globalWithWindow.window as {location: {search: string}}).location.search = "";
        }
        await mount({...setup, signedIn: true});
        const copy = MCP_OAUTH_CONSENT_ERROR_COPY[kind];
        const shown = leaves(byId("oauth-consent-error"));
        expect(shown).toContain(copy.title);
        expect(shown).toContain(copy.message);
        expect(hasId("oauth-consent-approve-button")).toBe(false);
      });
    }

    it("missingRequest makes no consent request", async () => {
      (globalWithWindow.window as {location: {search: string}}).location.search = "";
      await mount({signedIn: true});
      expect(calls.fetches).toEqual([]);
    });
  });
});
