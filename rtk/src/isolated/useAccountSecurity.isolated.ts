/**
 * Isolated tests for useAccountSecurity, with a fake Better Auth client at the network boundary.
 * The hook imports betterAuthClient.ts (for the bearer-mode link handoff), whose Expo plugin
 * loads native modules, so the Expo plugin is replaced here, where the mock cannot leak into
 * other suites.
 */
import {afterEach, describe, expect, it, mock} from "bun:test";
import type {AccountPasskey, AccountSession, LinkedAccount} from "@terreno/ui";
import {act, renderHook, waitFor} from "@testing-library/react-native";

import type {
  AccountSecurityAccountRow,
  AccountSecurityClient,
  AccountSecurityClientResult,
  AccountSecurityUser,
  UseAccountSecurityOptions,
} from "../auth/useAccountSecurity";
import type {BetterAuthMethods} from "../useAuthMethods";

mock.module("../platform", () => ({IsWeb: true}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({id: "expo", name: "expo-plugin"}),
}));

const {
  LAST_SIGN_IN_METHOD_MESSAGE,
  NO_PASSWORD_YET_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  getLinkErrorMessage,
  useAccountSecurity,
} = await import("../auth/useAccountSecurity");
const {createBetterAuthClient} = await import("../betterAuthClient");

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: false,
  passkey: true,
  providers: ["github", "google"],
  signUp: true,
  twoFactor: true,
};

const CREATED = new Date("2026-01-02T03:04:05Z");

const GOOGLE: AccountSecurityAccountRow = {
  accountId: "google-sub",
  createdAt: CREATED,
  id: "acc-google",
  providerId: "google",
};
const CREDENTIAL: AccountSecurityAccountRow = {
  accountId: "u1",
  createdAt: CREATED,
  id: "acc-credential",
  providerId: "credential",
};

const CURRENT: AccountSession = {id: "s-current", token: "tok-current", userAgent: "Firefox"};
const OTHER: AccountSession = {id: "s-other", token: "tok-other", userAgent: "Safari"};

const PASSKEY: AccountPasskey = {createdAt: CREATED, id: "pk-1", name: "Laptop"};

interface FakeState {
  accounts: AccountSecurityAccountRow[];
  methods: BetterAuthMethods;
  passkeys: AccountPasskey[];
  sessions: AccountSession[];
  /** null when signed out. */
  user: AccountSecurityUser | null;
  sessionId: string;
}

type Failure = AccountSecurityClientResult<never>;

interface FakeOverrides {
  /** Make the named call resolve this error instead. */
  fail?: Partial<Record<string, Failure>>;
  /** What `twoFactor.enable` resolves. */
  enableData?: object;
  withoutPasskey?: boolean;
  withoutTwoFactor?: boolean;
}

type FakeClient = AccountSecurityClient & {
  calls: Record<string, unknown[]>;
  state: FakeState;
};

const ok = <Data>(data: Data): AccountSecurityClientResult<Data> => ({data, error: null});

// A fake Better Auth client at the network boundary: each call records its arguments and answers
// from `state` the way the real client resolves `{data, error}`.
const fakeClient = (
  initial: Partial<FakeState> = {},
  overrides: FakeOverrides = {}
): FakeClient => {
  const state: FakeState = {
    accounts: [GOOGLE, CREDENTIAL],
    methods: METHODS,
    passkeys: [PASSKEY],
    sessionId: CURRENT.id,
    sessions: [CURRENT, OTHER],
    user: {email: "jane@example.com", id: "u1", twoFactorEnabled: false},
    ...initial,
  };
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, arg?: unknown): Failure | undefined => {
    calls[name] = [...(calls[name] ?? []), arg];
    return overrides.fail?.[name];
  };
  const client: FakeClient = {
    $fetch: async (path: string, options?: {method?: string; body?: Record<string, unknown>}) => {
      const failure = record(`$fetch ${path}`, options);
      if (failure) {
        return {data: null, error: failure.error};
      }
      if (path === "/terreno/methods") {
        return {data: state.methods, error: null};
      }
      if (path === "/terreno/set-password") {
        state.accounts = state.accounts.some((account) => account.providerId === "credential")
          ? state.accounts
          : [...state.accounts, CREDENTIAL];
        return {data: {status: true}, error: null};
      }
      return {data: null, error: {message: "Not found", status: 404}};
    },
    calls,
    changePassword: async (body) => {
      const failure = record("changePassword", body);
      if (failure) {
        return failure;
      }
      if (body.revokeOtherSessions) {
        state.sessionId = "s-new";
        state.sessions = [{id: "s-new", token: "tok-new"}];
      }
      return ok({token: null});
    },
    getSession: async (options) => {
      const failure = record("getSession", options);
      if (failure) {
        return failure;
      }
      if (!state.user) {
        return ok(null);
      }
      return ok({session: {id: state.sessionId}, user: state.user});
    },
    linkSocial: async (body) => {
      record("linkSocial", body);
      const failure = overrides.fail?.linkSocial;
      if (failure?.error) {
        return {error: {...failure.error, status: failure.error.status ?? 400}};
      }
      state.accounts = [...state.accounts, {id: `acc-${body.provider}`, providerId: body.provider}];
      return {error: null};
    },
    listAccounts: async () => {
      return record("listAccounts") ?? ok(state.accounts);
    },
    listSessions: async () => {
      return record("listSessions") ?? ok(state.sessions);
    },
    revokeOtherSessions: async () => {
      const failure = record("revokeOtherSessions");
      if (failure) {
        return failure;
      }
      state.sessions = state.sessions.filter((session) => session.id === state.sessionId);
      return ok({status: true});
    },
    revokeSession: async (body) => {
      const failure = record("revokeSession", body);
      if (failure) {
        return failure;
      }
      state.sessions = state.sessions.filter((session) => session.token !== body.token);
      return ok({status: true});
    },
    state,
    unlinkAccount: async (body) => {
      const failure = record("unlinkAccount", body);
      if (failure) {
        return failure;
      }
      state.accounts = state.accounts.filter((account) => account.id !== body.accountId);
      return ok({status: true});
    },
    ...(overrides.withoutPasskey
      ? {}
      : {
          passkey: {
            addPasskey: async (options?: {name?: string}) => {
              const failure = record("addPasskey", options);
              if (failure) {
                return failure;
              }
              state.passkeys = [...state.passkeys, {id: "pk-2", name: options?.name}];
              return ok({});
            },
            deletePasskey: async (body: {id: string}) => {
              const failure = record("deletePasskey", body);
              if (failure) {
                return failure;
              }
              state.passkeys = state.passkeys.filter((passkey) => passkey.id !== body.id);
              return ok({status: true});
            },
            listUserPasskeys: async () => {
              return record("listUserPasskeys") ?? ok(state.passkeys);
            },
            updatePasskey: async (body: {id: string; name: string}) => {
              const failure = record("updatePasskey", body);
              if (failure) {
                return failure;
              }
              state.passkeys = state.passkeys.map((passkey) =>
                passkey.id === body.id ? {...passkey, name: body.name} : passkey
              );
              return ok({});
            },
          },
        }),
    ...(overrides.withoutTwoFactor
      ? {}
      : {
          twoFactor: {
            disable: async (body: {password: string}) => {
              const failure = record("disable", body);
              if (failure) {
                return failure;
              }
              state.user = state.user ? {...state.user, twoFactorEnabled: false} : null;
              state.sessionId = "s-after-disable";
              return ok({status: true});
            },
            enable: async (body: {password: string}) => {
              const failure = record("enable", body);
              if (failure) {
                return failure;
              }
              return ok(
                overrides.enableData ?? {
                  backupCodes: ["code-1", "code-2"],
                  totpURI: "otpauth://totp/Terreno:jane?secret=ABC",
                }
              );
            },
            generateBackupCodes: async (body: {password: string}) => {
              const failure = record("generateBackupCodes", body);
              if (failure) {
                return failure;
              }
              return ok({backupCodes: ["new-1", "new-2"], status: true});
            },
            verifyTotp: async (body: {code: string}) => {
              const failure = record("verifyTotp", body);
              if (failure) {
                return failure;
              }
              state.user = state.user ? {...state.user, twoFactorEnabled: true} : null;
              state.sessionId = "s-after-verify";
              return ok({token: "tok-after-verify"});
            },
          },
        }),
  };
  return client;
};

const countOf = (client: FakeClient, name: string): number => client.calls[name]?.length ?? 0;

/** How many times each section has loaded. */
const loadCounts = (
  client: FakeClient
): {accounts: number; passkeys: number; session: number; sessions: number} => ({
  accounts: countOf(client, "listAccounts"),
  passkeys: countOf(client, "listUserPasskeys"),
  session: countOf(client, "getSession"),
  sessions: countOf(client, "listSessions"),
});

const renderSecurity = (
  client: FakeClient,
  options: Partial<UseAccountSecurityOptions> = {}
): ReturnType<typeof renderHook<ReturnType<typeof useAccountSecurity>, unknown>> => {
  return renderHook(() =>
    useAccountSecurity({callbackURL: "/security", client, passkeySupported: true, ...options})
  );
};

const waitForLoaded = async (result: {
  current: ReturnType<typeof useAccountSecurity>;
}): Promise<void> => {
  await waitFor(() => expect(result.current.screenProps.isLoading).toBe(false));
};

const linkedAccountsOf = (result: {
  current: ReturnType<typeof useAccountSecurity>;
}): NonNullable<ReturnType<typeof useAccountSecurity>["screenProps"]["linkedAccounts"]> => {
  const props = result.current.screenProps.linkedAccounts;
  if (!props) {
    throw new Error("linkedAccounts is hidden");
  }
  return props;
};

const globalWithWindow = globalThis as {window?: unknown};

describe("useAccountSecurity", () => {
  afterEach(() => {
    delete globalWithWindow.window;
  });

  it("loads every section and builds each card's props", async () => {
    const client = fakeClient();
    const {result} = renderSecurity(client);
    expect(result.current.screenProps.isLoading).toBe(true);

    await waitForLoaded(result);

    const {screenProps} = result.current;
    expect(screenProps.error).toBeUndefined();
    expect(screenProps.linkedAccounts?.accounts).toEqual([
      {accountId: "google-sub", id: "acc-google", linkedAt: CREATED, providerId: "google"},
      {accountId: "u1", id: "acc-credential", linkedAt: CREATED, providerId: "credential"},
    ] satisfies LinkedAccount[]);
    expect(screenProps.linkedAccounts?.providers).toEqual([{id: "github"}, {id: "google"}]);
    expect(screenProps.password?.hasPassword).toBe(true);
    expect(screenProps.passkeys?.passkeys).toEqual([PASSKEY]);
    expect(screenProps.passkeys?.supported).toBe(true);
    expect(screenProps.twoFactor?.enabled).toBe(false);
    expect(screenProps.twoFactor?.hasPassword).toBe(true);
    expect(screenProps.sessions?.sessions).toEqual([CURRENT, OTHER]);
    expect(screenProps.sessions?.currentSessionId).toBe("s-current");
    expect(result.current.user?.email).toBe("jane@example.com");
    // The session is read past the cookie cache, so a 2FA change shows at once.
    expect(client.calls.getSession).toEqual([{query: {disableCookieCache: true}}]);
    expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 1, sessions: 1});
  });

  it("shows only the cards the server's methods turn on", async () => {
    const client = fakeClient({
      methods: {
        ...METHODS,
        emailPassword: false,
        passkey: false,
        providers: [],
        twoFactor: false,
      },
    });
    const {result} = renderSecurity(client);
    await waitForLoaded(result);

    expect(result.current.screenProps.linkedAccounts).toBeUndefined();
    expect(result.current.screenProps.password).toBeUndefined();
    expect(result.current.screenProps.passkeys).toBeUndefined();
    expect(result.current.screenProps.twoFactor).toBeUndefined();
    expect(result.current.screenProps.sessions).toBeDefined();
    expect(countOf(client, "listUserPasskeys")).toBe(0);
  });

  it("hides the passkey and two-factor cards when the client lacks those features", async () => {
    const client = fakeClient({}, {withoutPasskey: true, withoutTwoFactor: true});
    const {result} = renderSecurity(client);
    await waitForLoaded(result);

    expect(result.current.screenProps.passkeys).toBeUndefined();
    expect(result.current.screenProps.twoFactor).toBeUndefined();
  });

  it("uses methods the app passes instead of requesting them", async () => {
    const client = fakeClient();
    const {result} = renderSecurity(client, {methods: {...METHODS, providers: ["github"]}});
    await waitForLoaded(result);

    expect(countOf(client, "$fetch /terreno/methods")).toBe(0);
    expect(linkedAccountsOf(result).providers).toEqual([{id: "github"}]);
  });

  it("labels providers and offers no Link button when linking is off", async () => {
    const client = fakeClient({
      methods: {...METHODS, accountLinking: {mode: "never"}, providers: ["mock-oidc"]},
    });
    const {result} = renderSecurity(client, {providerLabels: {"mock-oidc": "Mock OIDC"}});
    await waitForLoaded(result);

    expect(linkedAccountsOf(result).providers).toEqual([{id: "mock-oidc", label: "Mock OIDC"}]);
    expect(linkedAccountsOf(result).onLink).toBeUndefined();
    expect(linkedAccountsOf(result).onUnlink).toBeDefined();
  });

  it("leaves a provider unlabelled when its id matches an Object.prototype key", async () => {
    const client = fakeClient({methods: {...METHODS, providers: ["__proto__", "constructor"]}});
    const {result} = renderSecurity(client, {providerLabels: {"mock-oidc": "Mock OIDC"}});
    await waitForLoaded(result);

    expect(linkedAccountsOf(result).providers).toEqual([{id: "__proto__"}, {id: "constructor"}]);
  });

  describe("linked accounts", () => {
    it("never calls the client to unlink the last sign-in method", async () => {
      const client = fakeClient({accounts: [GOOGLE], passkeys: [PASSKEY]});
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      const google = linkedAccountsOf(result).accounts[0];

      await expect(linkedAccountsOf(result).onUnlink?.("google", google)).rejects.toThrow(
        LAST_SIGN_IN_METHOD_MESSAGE
      );

      expect(countOf(client, "unlinkAccount")).toBe(0);
      expect(countOf(client, "listAccounts")).toBe(1);
    });

    it("unlinks by the Better Auth account id and refetches only the accounts", async () => {
      const client = fakeClient({
        accounts: [GOOGLE, {id: "acc-github", providerId: "github"}, CREDENTIAL],
      });
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      const github = linkedAccountsOf(result).accounts[1];

      await act(async () => {
        await linkedAccountsOf(result).onUnlink?.("github", github);
      });

      expect(client.calls.unlinkAccount).toEqual([{accountId: "acc-github"}]);
      expect(loadCounts(client)).toEqual({accounts: 2, passkeys: 1, session: 1, sessions: 1});
      expect(linkedAccountsOf(result).accounts.map((account) => account.providerId)).toEqual([
        "google",
        "credential",
      ]);
    });

    it("throws the server's message, or a fallback, when unlinking fails", async () => {
      const failing = fakeClient(
        {},
        {fail: {unlinkAccount: {error: {code: "X", message: "Nope", status: 400}}}}
      );
      const {result} = renderSecurity(failing);
      await waitForLoaded(result);
      const google = linkedAccountsOf(result).accounts[0];
      await expect(linkedAccountsOf(result).onUnlink?.("google", google)).rejects.toThrow("Nope");
      expect(countOf(failing, "listAccounts")).toBe(1);

      const silent = fakeClient({}, {fail: {unlinkAccount: {error: {status: 500}}}});
      const second = renderSecurity(silent);
      await waitForLoaded(second.result);
      const account = linkedAccountsOf(second.result).accounts[0];
      await expect(linkedAccountsOf(second.result).onUnlink?.("google", account)).rejects.toThrow(
        "Couldn't unlink that account."
      );
    });

    it("links through linkSocial in cookie mode, then refetches the accounts", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client, {errorCallbackURL: "/security?failed=1"});
      await waitForLoaded(result);

      await act(async () => {
        await linkedAccountsOf(result).onLink?.("github");
      });

      expect(client.calls.linkSocial).toEqual([
        {callbackURL: "/security", errorCallbackURL: "/security?failed=1", provider: "github"},
      ]);
      expect(countOf(client, "listAccounts")).toBe(2);
      expect(linkedAccountsOf(result).accounts.map((account) => account.providerId)).toContain(
        "github"
      );
    });

    it("explains a refused link", async () => {
      const client = fakeClient(
        {},
        {fail: {linkSocial: {error: {code: "LINKING_DISABLED", message: "Off", status: 403}}}}
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(linkedAccountsOf(result).onLink?.("github")).rejects.toThrow(
        "This app does not link sign-in methods."
      );
      expect(countOf(client, "listAccounts")).toBe(1);
    });

    it("links through the OAuth handoff in bearer mode", async () => {
      const submitted: Array<{action: string; method: string; token: string}> = [];
      const form = {
        action: "",
        appendChild: (field: {value: string}): void => {
          form.token = field.value;
        },
        method: "",
        style: {display: ""},
        submit: (): void => {
          submitted.push({action: form.action, method: form.method, token: form.token});
        },
        token: "",
      };
      const storage = new Map<string, string>();
      const memoryStorage = {
        getItem: (key: string): string | null => storage.get(key) ?? null,
        removeItem: (key: string): void => {
          storage.delete(key);
        },
        setItem: (key: string, value: string): void => {
          storage.set(key, value);
        },
      };
      globalWithWindow.window = {
        document: {
          body: {appendChild: (): void => {}},
          createElement: (tag: string): unknown =>
            tag === "form" ? form : {name: "", type: "", value: ""},
        },
        localStorage: memoryStorage,
        location: {href: "http://app.test/security"},
        sessionStorage: memoryStorage,
      };
      const requests: Array<{body: unknown; url: string}> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const body = input instanceof Request ? await input.text() : init?.body;
        requests.push({body: body ? JSON.parse(String(body)) : undefined, url});
        if (url.includes("/oauth-handoff/link-intent")) {
          return Response.json({
            startURL: "http://api.test/api/auth/oauth-handoff/link-start",
            token: "link-token",
          });
        }
        return Response.json(null);
      }) as typeof fetch;
      try {
        const realClient = createBetterAuthClient({
          baseURL: "http://api.test",
          features: {passkey: true, twoFactor: true},
          scheme: "terreno",
          webAuth: "bearer",
        });
        // The real client's loads all answer null; the methods are passed in.
        const {result} = renderHook(() =>
          useAccountSecurity({callbackURL: "/security", client: realClient, methods: METHODS})
        );
        await waitForLoaded(result);
        // Linking is driven from the real client so its bearer config applies.
        await act(async () => {
          await result.current.screenProps.linkedAccounts?.onLink?.("github");
        });

        const intent = requests.find((request) => request.url.includes("link-intent"));
        expect(intent?.body).toEqual({
          callbackURL: "http://app.test/security",
          errorCallbackURL: "http://app.test/security",
          provider: "github",
        });
        expect(submitted).toEqual([
          {
            action: "http://api.test/api/auth/oauth-handoff/link-start",
            method: "POST",
            token: "link-token",
          },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("turns a link's ?error= return into a readable card error", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client, {
        linkError: "account_already_linked_to_different_user",
      });
      await waitForLoaded(result);

      expect(linkedAccountsOf(result).error).toBe(
        "That account is already linked to another user."
      );
      expect(getLinkErrorMessage(["<script>"])).toBe(
        "Couldn't link that account. Please try again."
      );
      expect(getLinkErrorMessage(null)).toBeUndefined();
    });

    it("shows the generic link error for a ?error= that matches an Object.prototype key", async () => {
      for (const code of ["__proto__", "constructor"]) {
        expect(getLinkErrorMessage(code)).toBe("Couldn't link that account. Please try again.");
      }
      const client = fakeClient();
      const {result} = renderSecurity(client, {linkError: "__proto__"});
      await waitForLoaded(result);
      expect(linkedAccountsOf(result).error).toBe("Couldn't link that account. Please try again.");
    });
  });

  describe("password", () => {
    it("sets a first password for an OAuth-only user through the Terreno endpoint", async () => {
      const client = fakeClient({accounts: [GOOGLE]});
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      expect(result.current.screenProps.password?.hasPassword).toBe(false);
      expect(result.current.screenProps.twoFactor?.hasPassword).toBe(false);

      await act(async () => {
        await result.current.screenProps.password?.onSubmit({
          mode: "set",
          newPassword: "first-password-1",
          revokeOtherSessions: false,
        });
      });

      expect(client.calls["$fetch /terreno/set-password"]).toEqual([
        {body: {newPassword: "first-password-1"}, method: "POST"},
      ]);
      expect(countOf(client, "changePassword")).toBe(0);
      expect(loadCounts(client)).toEqual({accounts: 2, passkeys: 1, session: 1, sessions: 1});
      expect(result.current.screenProps.password?.hasPassword).toBe(true);
    });

    it("shows the set-password endpoint's refusal", async () => {
      const client = fakeClient(
        {accounts: [GOOGLE]},
        {
          fail: {
            "$fetch /terreno/set-password": {
              error: {code: "PASSWORD_ALREADY_SET", message: "User already has a password set"},
            },
          },
        }
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(
        result.current.screenProps.password?.onSubmit({
          mode: "set",
          newPassword: "first-password-1",
          revokeOtherSessions: false,
        })
      ).rejects.toThrow("User already has a password set");
    });

    it("changes the password and reloads the sessions it signed out", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client, {minPasswordLength: 12});
      await waitForLoaded(result);
      expect(result.current.screenProps.password?.minLength).toBe(12);

      await act(async () => {
        await result.current.screenProps.password?.onSubmit({
          currentPassword: "old-password",
          mode: "change",
          newPassword: "new-password-1",
          revokeOtherSessions: false,
        });
      });
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 1, sessions: 1});

      await act(async () => {
        await result.current.screenProps.password?.onSubmit({
          currentPassword: "new-password-1",
          mode: "change",
          newPassword: "newer-password-1",
          revokeOtherSessions: true,
        });
      });

      expect(client.calls.changePassword).toEqual([
        {
          currentPassword: "old-password",
          newPassword: "new-password-1",
          revokeOtherSessions: false,
        },
        {
          currentPassword: "new-password-1",
          newPassword: "newer-password-1",
          revokeOtherSessions: true,
        },
      ]);
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 2, sessions: 2});
      expect(result.current.screenProps.sessions?.currentSessionId).toBe("s-new");
    });

    it("switches to set mode when the credential row has no password", async () => {
      const client = fakeClient(
        {},
        {
          fail: {
            changePassword: {
              error: {
                code: "CREDENTIAL_ACCOUNT_NOT_FOUND",
                message: "Credential account not found",
              },
            },
          },
        }
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      expect(result.current.screenProps.password?.hasPassword).toBe(true);

      await act(async () => {
        await expect(
          result.current.screenProps.password?.onSubmit({
            currentPassword: "anything",
            mode: "change",
            newPassword: "new-password-1",
            revokeOtherSessions: false,
          })
        ).rejects.toThrow(NO_PASSWORD_YET_MESSAGE);
      });
      expect(result.current.screenProps.password?.hasPassword).toBe(false);
      expect(result.current.screenProps.twoFactor?.hasPassword).toBe(false);

      await act(async () => {
        await result.current.screenProps.password?.onSubmit({
          mode: "set",
          newPassword: "first-password-1",
          revokeOtherSessions: false,
        });
      });
      expect(client.calls["$fetch /terreno/set-password"]).toHaveLength(1);
      expect(result.current.screenProps.password?.hasPassword).toBe(true);
    });

    it("throws Better Auth's message for a wrong current password", async () => {
      const client = fakeClient(
        {},
        {fail: {changePassword: {error: {code: "INVALID_PASSWORD", message: "Invalid password"}}}}
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(
        result.current.screenProps.password?.onSubmit({
          currentPassword: "wrong",
          mode: "change",
          newPassword: "new-password-1",
          revokeOtherSessions: false,
        })
      ).rejects.toThrow("Invalid password");
    });
  });

  describe("passkeys", () => {
    it("adds, renames and removes passkeys, refetching only the passkeys", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await act(async () => {
        await result.current.screenProps.passkeys?.onAdd?.("Phone");
      });
      await act(async () => {
        await result.current.screenProps.passkeys?.onRename?.("pk-1", "Work laptop");
      });
      await act(async () => {
        await result.current.screenProps.passkeys?.onRemove?.(PASSKEY);
      });

      expect(client.calls.addPasskey).toEqual([{name: "Phone"}]);
      expect(client.calls.updatePasskey).toEqual([{id: "pk-1", name: "Work laptop"}]);
      expect(client.calls.deletePasskey).toEqual([{id: "pk-1"}]);
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 4, session: 1, sessions: 1});
      expect(result.current.screenProps.passkeys?.passkeys).toEqual([{id: "pk-2", name: "Phone"}]);
    });

    it("adds an unnamed passkey without a name", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await act(async () => {
        await result.current.screenProps.passkeys?.onAdd?.();
      });

      expect(client.calls.addPasskey).toEqual([undefined]);
    });

    it("never removes the last sign-in method", async () => {
      const client = fakeClient({accounts: [], passkeys: [PASSKEY]});
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(result.current.screenProps.passkeys?.onRemove?.(PASSKEY)).rejects.toThrow(
        LAST_SIGN_IN_METHOD_MESSAGE
      );
      expect(countOf(client, "deletePasskey")).toBe(0);
    });

    it("throws when adding a passkey fails, such as a cancelled prompt", async () => {
      const client = fakeClient(
        {},
        {fail: {addPasskey: {error: {message: "Registration cancelled", status: 400}}}}
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(result.current.screenProps.passkeys?.onAdd?.("Phone")).rejects.toThrow(
        "Registration cancelled"
      );
      expect(countOf(client, "listUserPasskeys")).toBe(1);
    });

    it("reports WebAuthn support from the browser", async () => {
      globalWithWindow.window = {PublicKeyCredential: (): void => {}};
      const client = fakeClient();
      const {result} = renderSecurity(client, {passkeySupported: undefined});
      await waitForLoaded(result);
      expect(result.current.screenProps.passkeys?.supported).toBe(true);

      delete globalWithWindow.window;
      const other = renderSecurity(fakeClient(), {passkeySupported: undefined});
      await waitForLoaded(other.result);
      expect(other.result.current.screenProps.passkeys?.supported).toBe(false);
    });
  });

  describe("two-factor", () => {
    it("returns the backup codes to the card when enrolling", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      let enrollment: unknown;
      await act(async () => {
        enrollment = await result.current.screenProps.twoFactor?.onStartEnroll("password-1");
      });

      expect(client.calls.enable).toEqual([{password: "password-1"}]);
      expect(enrollment).toEqual({
        backupCodes: ["code-1", "code-2"],
        totpURI: "otpauth://totp/Terreno:jane?secret=ABC",
      });
      // Enabling only stores the secret; nothing reloads until the code is verified.
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 1, sessions: 1});
    });

    it("refuses the OTP branch of enable, which has no authenticator URI", async () => {
      const client = fakeClient({}, {enableData: {method: "otp"}});
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(result.current.screenProps.twoFactor?.onStartEnroll()).rejects.toThrow(
        "Couldn't start two-factor setup."
      );
      expect(client.calls.enable).toEqual([{password: ""}]);
    });

    it("verifies the code, then reloads the session and sessions it replaced", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await act(async () => {
        await result.current.screenProps.twoFactor?.onVerify("123456");
      });

      expect(client.calls.verifyTotp).toEqual([{code: "123456"}]);
      expect(result.current.screenProps.twoFactor?.enabled).toBe(true);
      expect(result.current.screenProps.sessions?.currentSessionId).toBe("s-after-verify");
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 2, sessions: 2});
    });

    it("throws for a wrong code without reloading", async () => {
      const client = fakeClient(
        {},
        {fail: {verifyTotp: {error: {code: "INVALID_CODE", message: "Invalid code"}}}}
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(result.current.screenProps.twoFactor?.onVerify("000000")).rejects.toThrow(
        "Invalid code"
      );
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 1, sessions: 1});
    });

    it("creates new backup codes and turns two-factor off", async () => {
      const client = fakeClient({
        user: {email: "jane@example.com", id: "u1", twoFactorEnabled: true},
      });
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      expect(result.current.screenProps.twoFactor?.enabled).toBe(true);

      let codes: string[] | undefined;
      await act(async () => {
        codes = await result.current.screenProps.twoFactor?.onRegenerateBackupCodes?.("pw");
      });
      expect(codes).toEqual(["new-1", "new-2"]);
      expect(client.calls.generateBackupCodes).toEqual([{password: "pw"}]);

      await act(async () => {
        await result.current.screenProps.twoFactor?.onDisable?.("pw");
      });

      expect(client.calls.disable).toEqual([{password: "pw"}]);
      expect(result.current.screenProps.twoFactor?.enabled).toBe(false);
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 2, sessions: 2});
    });
  });

  describe("sessions", () => {
    it("signs out everywhere else with revokeOtherSessions and reloads only the sessions", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await act(async () => {
        await result.current.screenProps.sessions?.onRevokeOthers?.();
      });

      expect(countOf(client, "revokeOtherSessions")).toBe(1);
      expect(countOf(client, "revokeSession")).toBe(0);
      expect(loadCounts(client)).toEqual({accounts: 1, passkeys: 1, session: 1, sessions: 2});
      expect(result.current.screenProps.sessions?.sessions).toEqual([CURRENT]);
    });

    it("signs out one session by its token", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await act(async () => {
        await result.current.screenProps.sessions?.onRevoke?.(OTHER);
      });

      expect(client.calls.revokeSession).toEqual([{token: "tok-other"}]);
      expect(result.current.screenProps.sessions?.sessions).toEqual([CURRENT]);
      await expect(
        result.current.screenProps.sessions?.onRevoke?.({id: "no-token"})
      ).rejects.toThrow("Couldn't sign out that session.");
    });

    it("throws when signing out other sessions fails", async () => {
      const client = fakeClient(
        {},
        {fail: {revokeOtherSessions: {error: {message: "Session expired", status: 401}}}}
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await expect(result.current.screenProps.sessions?.onRevokeOthers?.()).rejects.toThrow(
        "Session expired"
      );
    });
  });

  describe("loading and errors", () => {
    it("shows a failed section's error on its card and keeps the other cards", async () => {
      const client = fakeClient(
        {},
        {
          fail: {
            listAccounts: {error: {message: "Accounts down"}},
            listSessions: {error: {code: "UNAUTHORIZED", message: "Sessions down"}},
            listUserPasskeys: {error: {status: 500}},
          },
        }
      );
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      expect(result.current.screenProps.error).toBeUndefined();
      expect(result.current.screenProps.linkedAccounts?.error).toBe("Accounts down");
      expect(result.current.screenProps.sessions?.error).toBe("Sessions down");
      expect(result.current.screenProps.passkeys?.error).toBe("Couldn't load your passkeys.");
      expect(result.current.screenProps.twoFactor).toBeDefined();
    });

    it("asks the user to sign in again when Better Auth needs a fresh session", async () => {
      const stale = {
        error: {code: "SESSION_NOT_FRESH", message: "Session is not fresh", status: 403},
      };
      const client = fakeClient(
        {accounts: [GOOGLE]},
        {fail: {"$fetch /terreno/set-password": stale, listSessions: stale, unlinkAccount: stale}}
      );
      client.state.accounts = [GOOGLE, {id: "acc-github", providerId: "github"}];
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      expect(result.current.screenProps.sessions?.error).toBe(SIGN_IN_AGAIN_MESSAGE);
      const google = linkedAccountsOf(result).accounts[0];
      await expect(linkedAccountsOf(result).onUnlink?.("google", google)).rejects.toThrow(
        SIGN_IN_AGAIN_MESSAGE
      );
      await expect(
        result.current.screenProps.password?.onSubmit({
          mode: "set",
          newPassword: "first-password-1",
          revokeOtherSessions: false,
        })
      ).rejects.toThrow(SIGN_IN_AGAIN_MESSAGE);
    });

    it("keeps loaded rows when a refetch after a change fails", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      client.listSessions = async () => {
        throw new Error("Network request failed");
      };

      await act(async () => {
        await result.current.screenProps.sessions?.onRevokeOthers?.();
      });

      expect(result.current.screenProps.sessions?.error).toBe("Network request failed");
      expect(result.current.screenProps.sessions?.sessions).toEqual([CURRENT, OTHER]);
    });

    it("shows a page error when no one is signed in", async () => {
      const client = fakeClient({user: null});
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      expect(result.current.screenProps.error).toBe("Sign in to manage your security settings.");
    });

    it("shows a page error when the session fails to load, and retries every section", async () => {
      const client = fakeClient();
      const original = client.getSession;
      client.getSession = async () => {
        throw new Error("Offline");
      };
      const {result} = renderSecurity(client);
      await waitForLoaded(result);
      expect(result.current.screenProps.error).toBe("Offline");

      client.getSession = original;
      act(() => {
        result.current.screenProps.onRetry();
      });
      await waitFor(() => expect(result.current.screenProps.error).toBeUndefined());
      await waitForLoaded(result);
      expect(loadCounts(client)).toEqual({accounts: 2, passkeys: 2, session: 1, sessions: 2});
    });

    it("shows the methods error and requests the methods again on retry", async () => {
      const client = fakeClient();
      const original = client.$fetch;
      client.$fetch = async () => ({data: null, error: {message: "Methods unavailable"}});
      const warn = console.warn;
      console.warn = (): void => {};
      try {
        const {result} = renderSecurity(client);
        await waitForLoaded(result);
        expect(result.current.screenProps.error).toBe("Methods unavailable");
        expect(result.current.screenProps.sessions).toBeUndefined();
        expect(countOf(client, "listAccounts")).toBe(0);

        client.$fetch = original;
        act(() => {
          result.current.screenProps.onRetry();
        });
        await waitFor(() => expect(result.current.methods).toEqual(METHODS));
        await waitForLoaded(result);
        expect(result.current.screenProps.error).toBeUndefined();
        expect(countOf(client, "listAccounts")).toBe(1);
      } finally {
        console.warn = warn;
      }
    });

    it("reloads every section through refetch", async () => {
      const client = fakeClient();
      const {result} = renderSecurity(client);
      await waitForLoaded(result);

      await act(async () => {
        await result.current.refetch();
      });

      expect(loadCounts(client)).toEqual({accounts: 2, passkeys: 2, session: 2, sessions: 2});
    });
  });
});
