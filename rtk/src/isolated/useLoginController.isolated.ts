/**
 * Isolated tests for useLoginController, with a fake Better Auth client at the network boundary
 * and a real remembered-accounts store on memory storage. The controller imports
 * betterAuthClient.ts (for bearer mode and the OAuth handoff), whose Expo plugin loads native
 * modules, so the Expo plugin is replaced here, where the mock cannot leak into other suites.
 */
import {afterEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";

import type {RememberedAccountsStorage, RememberedAccountsStore} from "../auth/rememberedAccounts";
import type {
  LoginClientResult,
  LoginControllerClient,
  LoginDeviceSession,
  LoginUser,
  UseLoginControllerOptions,
} from "../auth/useLoginController";
import type {BetterAuthMethods} from "../useAuthMethods";

mock.module("../platform", () => ({IsWeb: true}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({id: "expo", name: "expo-plugin"}),
}));

const {SIGN_UP_CLOSED_NOTICE_TEXT, VERIFY_EMAIL_NOTICE_TEXT} = await import("../auth/loginErrors");
const {createRememberedAccountsStore} = await import("../auth/rememberedAccounts");
const {recordRememberedSignIn, useLoginController} = await import("../auth/useLoginController");
const {createBetterAuthClient} = await import("../betterAuthClient");

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: true,
  passkey: true,
  providers: ["github", "google", "mock-oidc"],
  signUp: true,
  twoFactor: true,
};

const JANE: LoginUser = {email: "jane@example.com", id: "u1", image: null, name: "Jane"};
const BOB: LoginUser = {email: "bob@example.com", id: "u2", name: "Bob"};

const memoryStorage = (): RememberedAccountsStorage & {values: Map<string, string>} => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    removeItem: (key: string): void => {
      values.delete(key);
    },
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    values,
  };
};

const createStore = (rememberIdentity = true): RememberedAccountsStore => {
  return createRememberedAccountsStore({rememberIdentity, storage: memoryStorage()});
};

interface FakeClientState {
  methods: BetterAuthMethods;
  /** The live session getSession reports; null when signed out. */
  sessionUser: LoginUser | null;
  deviceSessions: LoginDeviceSession[];
}

type FakeClient = LoginControllerClient & {
  calls: {
    email: Array<{email: string; password: string}>;
    getSession: number;
    listDeviceSessions: number;
    passkey: Array<{autoFill?: boolean} | undefined>;
    setActive: Array<{sessionToken: string}>;
    social: Array<{provider: string; callbackURL?: string; errorCallbackURL?: string}>;
    verifyBackupCode: Array<{code: string; trustDevice?: boolean}>;
    verifyTotp: Array<{code: string; trustDevice?: boolean}>;
  };
  state: FakeClientState;
};

interface FakeClientOverrides {
  email?: () => Promise<
    LoginClientResult<{twoFactorRedirect?: boolean; twoFactorMethods?: string[]; user?: LoginUser}>
  >;
  social?: () => Promise<LoginClientResult<{url?: string; redirect?: boolean}>>;
  passkey?: () => Promise<LoginClientResult<{user?: LoginUser}>>;
  setActive?: () => Promise<LoginClientResult<unknown>>;
  verify?: () => Promise<LoginClientResult<{user?: LoginUser}>>;
  withoutPasskey?: boolean;
  withoutMultiSession?: boolean;
  withoutTwoFactor?: boolean;
}

// A fake Better Auth client at the network boundary: each call records its arguments and answers
// from `state` the way the real client resolves `{data, error}`.
const fakeClient = (
  initial: Partial<FakeClientState> = {},
  overrides: FakeClientOverrides = {}
): FakeClient => {
  const state: FakeClientState = {
    deviceSessions: [],
    methods: METHODS,
    sessionUser: null,
    ...initial,
  };
  const calls: FakeClient["calls"] = {
    email: [],
    getSession: 0,
    listDeviceSessions: 0,
    passkey: [],
    setActive: [],
    social: [],
    verifyBackupCode: [],
    verifyTotp: [],
  };
  const signedIn = (user: LoginUser): {user: LoginUser} => {
    state.sessionUser = user;
    return {user};
  };
  const client: FakeClient = {
    $fetch: async () => ({data: state.methods, error: null}),
    calls,
    getSession: async () => {
      calls.getSession += 1;
      return {
        data: state.sessionUser ? {session: {id: "s"}, user: state.sessionUser} : null,
        error: null,
      };
    },
    signIn: {
      email: async (body) => {
        calls.email.push(body);
        if (overrides.email) {
          return overrides.email();
        }
        return {data: signedIn(JANE), error: null};
      },
      social: async (body) => {
        calls.social.push(body);
        if (overrides.social) {
          return overrides.social();
        }
        // Native: the provider's browser flow finishes in-process and leaves a session.
        state.sessionUser = JANE;
        return {data: {redirect: false}, error: null};
      },
      ...(overrides.withoutPasskey
        ? {}
        : {
            passkey: async (options?: {autoFill?: boolean}) => {
              calls.passkey.push(options);
              if (overrides.passkey) {
                return overrides.passkey();
              }
              return {data: signedIn(BOB), error: null};
            },
          }),
    },
    state,
    ...(overrides.withoutMultiSession
      ? {}
      : {
          multiSession: {
            listDeviceSessions: async () => {
              calls.listDeviceSessions += 1;
              return {data: state.deviceSessions, error: null};
            },
            setActive: async (body: {sessionToken: string}) => {
              calls.setActive.push(body);
              if (overrides.setActive) {
                return overrides.setActive();
              }
              const match = state.deviceSessions.find(
                (device) => device.session.token === body.sessionToken
              );
              state.sessionUser = match?.user ?? null;
              return {data: {}, error: null};
            },
          },
        }),
    ...(overrides.withoutTwoFactor
      ? {}
      : {
          twoFactor: {
            verifyBackupCode: async (body: {code: string; trustDevice?: boolean}) => {
              calls.verifyBackupCode.push(body);
              return overrides.verify ? overrides.verify() : {data: signedIn(JANE), error: null};
            },
            verifyTotp: async (body: {code: string; trustDevice?: boolean}) => {
              calls.verifyTotp.push(body);
              return overrides.verify ? overrides.verify() : {data: signedIn(JANE), error: null};
            },
          },
        }),
  };
  return client;
};

const renderController = (
  options: Partial<UseLoginControllerOptions> & {client: LoginControllerClient}
): ReturnType<typeof renderHook<ReturnType<typeof useLoginController>, unknown>> & {
  onSignedIn: ReturnType<typeof mock>;
  store: RememberedAccountsStore;
} => {
  const onSignedIn = mock(() => {});
  const store = options.rememberedAccounts ?? createStore();
  const rendered = renderHook(() =>
    useLoginController({onSignedIn, rememberedAccounts: store, webAuth: "cookie", ...options})
  );
  return {...rendered, onSignedIn, store};
};

// Waits until the live-session check and the methods request have both settled.
const waitForLoginScreen = async (
  result: {current: ReturnType<typeof useLoginController>},
  methods = true
): Promise<void> => {
  await waitFor(() => expect(result.current.step).toBe("login"));
  if (methods) {
    await waitFor(() => expect(result.current.methods).toBeDefined());
  }
};

const globalWithWindow = globalThis as {window?: unknown};

describe("useLoginController", () => {
  afterEach(() => {
    delete globalWithWindow.window;
    // Restores console methods a test spied on.
    for (const method of [console.warn, console.error, console.info]) {
      (method as unknown as {mockRestore?: () => void}).mockRestore?.();
    }
  });

  it("lets a device session take precedence over a remembered account for the same user", async () => {
    const store = createStore();
    await store.record({method: "google", userId: JANE.id});
    await store.record({method: "email", userId: BOB.id});
    const client = fakeClient({deviceSessions: [{session: {token: "tok-jane"}, user: JANE}]});

    const {result} = renderController({client, rememberedAccounts: store});
    await waitForLoginScreen(result);
    await waitFor(() => expect(result.current.screenProps.currentSessions).toHaveLength(1));

    expect(result.current.screenProps.currentSessions).toEqual([
      {email: "jane@example.com", id: "tok-jane", method: "google", name: "Jane"},
    ]);
    expect(result.current.screenProps.rememberedAccounts).toEqual([{id: "u2", method: "email"}]);
    expect(result.current.screenProps.lastUsedMethod).toBe("email");
  });

  it("skips multiSession in bearer mode and offers remembered accounts instead", async () => {
    const store = createStore();
    await store.record({method: "google", userId: JANE.id});
    const client = fakeClient({deviceSessions: [{session: {token: "tok-jane"}, user: JANE}]});

    const {result} = renderController({
      client,
      getBearerToken: () => null,
      rememberedAccounts: store,
      webAuth: "bearer",
    });
    await waitForLoginScreen(result);

    // No token means signed out without asking the server.
    expect(client.calls.getSession).toBe(0);
    expect(client.calls.listDeviceSessions).toBe(0);
    expect(result.current.screenProps.currentSessions).toEqual([]);
    expect(result.current.screenProps.rememberedAccounts).toEqual([{id: "u1", method: "google"}]);
  });

  it("skips the screen when a live bearer session exists", async () => {
    const client = fakeClient({sessionUser: JANE});
    const {result, onSignedIn} = renderController({
      client,
      getBearerToken: () => "bearer-token",
      webAuth: "bearer",
    });

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(onSignedIn.mock.calls[0]).toEqual([{method: undefined, user: JANE}]);
    expect(result.current.step).toBe("signedIn");
  });

  it("records the method of a live cookie session the server reports, and shows the screen on an 'add account' route", async () => {
    const user = {...JANE, lastLoginMethod: "github"};
    const store = createStore();
    const live = renderController({
      client: fakeClient({sessionUser: user}),
      rememberedAccounts: store,
    });
    await waitFor(() => expect(live.onSignedIn).toHaveBeenCalledTimes(1));
    expect(live.onSignedIn.mock.calls[0]).toEqual([{method: "github", user}]);
    expect(store.list().map(({method, userId}) => ({method, userId}))).toEqual([
      {method: "github", userId: "u1"},
    ]);

    const addAccount = renderController({
      client: fakeClient({sessionUser: user}),
      skipWhenSignedIn: false,
    });
    await waitForLoginScreen(addAccount.result);
    expect(addAccount.onSignedIn).not.toHaveBeenCalled();
  });

  it("shows the screen when the session check throws", async () => {
    spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient();
    client.getSession = async () => {
      throw new Error("offline");
    };
    const {result} = renderController({client});
    await waitForLoginScreen(result);
  });

  it("records a remembered account after a successful email sign-in", async () => {
    const store = createStore(true);
    const client = fakeClient();
    const {result, onSignedIn} = renderController({client, rememberedAccounts: store});
    await waitForLoginScreen(result);

    await act(async () => {
      await result.current.screenProps.onSubmit({email: " jane@example.com ", password: "pw"});
    });

    expect(client.calls.email).toEqual([{email: "jane@example.com", password: "pw"}]);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "email", user: JANE}]);
    expect(store.list()).toEqual([
      expect.objectContaining({
        email: "j***@e***.com",
        method: "email",
        name: "Jane",
        userId: "u1",
      }),
    ]);
    expect(result.current.step).toBe("signedIn");
  });

  it("records only the method when rememberIdentity is false", async () => {
    const store = createStore(true);
    const {result} = renderController({
      client: fakeClient(),
      rememberedAccounts: store,
      rememberIdentity: false,
    });
    await waitForLoginScreen(result);
    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    expect(store.list()).toEqual([{lastUsedAt: expect.any(String), method: "email", userId: "u1"}]);
  });

  it("fires onTwoFactorRequired on a two-factor redirect instead of signing in", async () => {
    const onTwoFactorRequired = mock(() => {});
    const client = fakeClient(
      {},
      {
        email: async () => ({
          data: {twoFactorMethods: ["totp"], twoFactorRedirect: true},
          error: null,
        }),
      }
    );
    const {result, onSignedIn, store} = renderController({client, onTwoFactorRequired});
    await waitForLoginScreen(result);

    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });

    expect(onTwoFactorRequired).toHaveBeenCalledWith({method: "email", twoFactorMethods: ["totp"]});
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(result.current.step).toBe("login");
    expect(store.list()).toEqual([]);
  });

  it("runs the inline two-factor challenge when no onTwoFactorRequired is given", async () => {
    let verifyResult: LoginClientResult<{user?: LoginUser}> = {
      data: null,
      error: {code: "INVALID_CODE", message: "Invalid code", status: 401},
    };
    const client = fakeClient(
      {},
      {
        email: async () => ({
          data: {twoFactorMethods: ["totp"], twoFactorRedirect: true},
          error: null,
        }),
        verify: async () => verifyResult,
      }
    );
    const {result, onSignedIn, store} = renderController({client});
    await waitForLoginScreen(result);

    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    expect(result.current.step).toBe("twoFactor");
    expect(result.current.twoFactor.twoFactorMethods).toEqual(["totp"]);

    await act(async () => {
      await result.current.twoFactor.onSubmit({code: "000000", kind: "totp", trustDevice: false});
    });
    expect(result.current.twoFactor.error).toBe("Invalid code");

    act(() => result.current.twoFactor.onCancel());
    expect(result.current.step).toBe("login");

    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    verifyResult = {data: {user: JANE}, error: null};
    await act(async () => {
      await result.current.twoFactor.onSubmit({
        code: "abcde-12345",
        kind: "backup",
        trustDevice: true,
      });
    });

    expect(client.calls.verifyTotp).toEqual([{code: "000000", trustDevice: false}]);
    expect(client.calls.verifyBackupCode).toEqual([{code: "abcde-12345", trustDevice: true}]);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "email", user: JANE}]);
    expect(store.list()[0]).toEqual(expect.objectContaining({method: "email", userId: "u1"}));
  });

  it("reports a two-factor failure when the client has no twoFactor, throws, or returns no user", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    const bare = renderController({client: fakeClient({}, {withoutTwoFactor: true})});
    await waitForLoginScreen(bare.result);
    await act(async () => {
      await bare.result.current.twoFactor.onSubmit({code: "1", kind: "totp", trustDevice: false});
    });
    expect(bare.result.current.twoFactor.error).toBe("That code didn't work. Please try again.");

    const throwing = renderController({
      client: fakeClient(
        {},
        {
          verify: async () => {
            throw new Error("network");
          },
        }
      ),
    });
    await waitForLoginScreen(throwing.result);
    await act(async () => {
      await throwing.result.current.twoFactor.onSubmit({
        code: "1",
        kind: "totp",
        trustDevice: false,
      });
    });
    expect(throwing.result.current.twoFactor.error).toBe(
      "That code didn't work. Please try again."
    );

    const noUser = renderController({
      client: fakeClient({}, {verify: async () => ({data: {}, error: null})}),
    });
    await waitForLoginScreen(noUser.result);
    await act(async () => {
      await noUser.result.current.twoFactor.onSubmit({code: "1", kind: "totp", trustDevice: false});
    });
    expect(noUser.result.current.twoFactor.error).toBe("That code didn't work. Please try again.");
    expect(noUser.onSignedIn).not.toHaveBeenCalled();
  });

  it("turns account_not_linked into guidance for each linking mode", async () => {
    const texts: string[] = [];
    for (const mode of ["verified-email", "explicit", "never"] as const) {
      const store = createStore();
      await store.record({method: "google", userId: JANE.id});
      const {result} = renderController({
        client: fakeClient({methods: {...METHODS, accountLinking: {mode}}}),
        error: "account_not_linked",
        rememberedAccounts: store,
      });
      await waitForLoginScreen(result);
      expect(result.current.screenProps.notice?.tone).toBe("warning");
      expect(result.current.screenProps.error).toBeUndefined();
      texts.push(result.current.screenProps.notice?.text ?? "");
    }
    expect(texts[0]).toContain("Verify your email address, then sign in again to link");
    expect(texts[1]).toBe(
      "An account with this email already exists. Sign in with Google, then link this sign-in method from Security."
    );
    expect(texts[2]).toBe("This email already has an account. Sign in with Google instead.");
  });

  it("names a remembered method or a provider id that matches an Object.prototype key as text", async () => {
    const texts: string[] = [];
    for (const method of ["__proto__", "constructor"]) {
      const store = createStore();
      await store.record({method, userId: JANE.id});
      const {result} = renderController({
        client: fakeClient({
          methods: {...METHODS, accountLinking: {mode: "never"}, providers: [method]},
        }),
        error: "account_not_linked",
        providerLabels: {"mock-oidc": "Mock OIDC"},
        rememberedAccounts: store,
      });
      await waitForLoginScreen(result);
      texts.push(result.current.screenProps.notice?.text ?? "");
      const labels = result.current.screenProps.genericProviders?.map(({label}) => label) ?? [];
      expect(labels.every((label) => typeof label === "string")).toBe(true);
    }
    expect(texts).toEqual([
      "This email already has an account. Sign in with Proto instead.",
      "This email already has an account. Sign in with Constructor instead.",
    ]);
  });

  it("maps the ID-token refusal 'account not linked' from a sign-in response", async () => {
    const client = fakeClient(
      {methods: {...METHODS, accountLinking: {mode: "never"}}},
      {social: async () => ({data: null, error: {message: "account not linked", status: 401}})}
    );
    const {result} = renderController({client});
    await waitForLoginScreen(result);
    await act(async () => {
      await result.current.signInSocial("github");
    });
    expect(result.current.screenProps.notice?.text).toBe(
      "This email already has an account. Sign in the way you did before instead."
    );
  });

  it("tells the user to verify their email on VERIFY_EMAIL_TO_USE_ACCOUNT", async () => {
    const client = fakeClient(
      {},
      {
        email: async () => ({
          data: null,
          error: {
            code: "VERIFY_EMAIL_TO_USE_ACCOUNT",
            message: "Verify your email to use this account",
            status: 409,
          },
        }),
      }
    );
    const {result, onSignedIn} = renderController({client});
    await waitForLoginScreen(result);
    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    expect(result.current.screenProps.notice).toEqual({
      text: VERIFY_EMAIL_NOTICE_TEXT,
      tone: "warning",
    });
    expect(onSignedIn).not.toHaveBeenCalled();

    const fromUrl = renderController({
      client: fakeClient(),
      error: ["VERIFY_EMAIL_TO_USE_ACCOUNT"],
    });
    await waitForLoginScreen(fromUrl.result);
    expect(fromUrl.result.current.screenProps.notice?.text).toBe(VERIFY_EMAIL_NOTICE_TEXT);
  });

  it("shows the administrator notice and hides sign-up on signup_disabled", async () => {
    const onSignUpPress = mock(() => {});
    const {result} = renderController({
      client: fakeClient(),
      error: "signup_disabled",
      onSignUpPress,
    });
    await waitForLoginScreen(result);
    expect(result.current.screenProps.notice).toEqual({
      text: SIGN_UP_CLOSED_NOTICE_TEXT,
      tone: "warning",
    });
    expect(result.current.screenProps.onSignUpPress).toBeUndefined();
  });

  it("offers sign-up only while the server's sign-up is open", async () => {
    const onSignUpPress = mock(() => {});
    const open = renderController({client: fakeClient(), onSignUpPress});
    await waitForLoginScreen(open.result);
    expect(open.result.current.screenProps.onSignUpPress).toBe(onSignUpPress);

    const closed = renderController({
      client: fakeClient({methods: {...METHODS, signUp: false}}),
      onSignUpPress,
    });
    await waitForLoginScreen(closed.result);
    expect(closed.result.current.screenProps.onSignUpPress).toBeUndefined();
  });

  it("follows a new ?error= and never shows URL text for an unknown code", async () => {
    let error = "provider_not_found";
    const onSignedIn = mock(() => {});
    const store = createStore();
    const client = fakeClient();
    const {result, rerender} = renderHook(() =>
      useLoginController({client, error, onSignedIn, rememberedAccounts: store, webAuth: "cookie"})
    );
    await waitForLoginScreen(result);
    expect(result.current.screenProps.error).toBe("That sign-in provider is not available.");

    error = "<script>alert(1)</script>";
    rerender({});
    await waitFor(() =>
      expect(result.current.screenProps.error).toBe("Sign in failed. Please try again.")
    );
  });

  it("shows the server's message for other refused sign-ins, and a generic one when sign-in throws", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    const refused = renderController({
      client: fakeClient(
        {},
        {
          email: async () => ({
            data: null,
            error: {message: "Invalid email or password", status: 401},
          }),
        }
      ),
    });
    await waitForLoginScreen(refused.result);
    await act(async () => {
      await refused.result.current.signInEmail({email: "a@b.co", password: "x"});
    });
    expect(refused.result.current.screenProps.error).toBe("Invalid email or password");
    expect(refused.result.current.screenProps.loading).toBe(false);

    const throwing = renderController({
      client: fakeClient(
        {},
        {
          email: async () => {
            throw new Error("network down");
          },
        }
      ),
    });
    await waitForLoginScreen(throwing.result);
    await act(async () => {
      await throwing.result.current.signInEmail({});
    });
    expect(throwing.result.current.screenProps.error).toBe("Sign in failed. Please try again.");

    const noSession = renderController({
      client: fakeClient({}, {email: async () => ({data: {}, error: null})}),
    });
    await waitForLoginScreen(noSession.result);
    await act(async () => {
      await noSession.result.current.signInEmail({email: "a@b.co", password: "x"});
    });
    expect(noSession.result.current.screenProps.error).toBe("Sign in failed. Please try again.");
    expect(noSession.onSignedIn).not.toHaveBeenCalled();
  });

  it("splits branded and generic providers and signs in with signIn.social outside bearer mode", async () => {
    const store = createStore();
    const client = fakeClient();
    const {result, onSignedIn} = renderController({
      callbackURL: "/login",
      client,
      errorCallbackURL: "/login",
      providerLabels: {"mock-oidc": "Mock OIDC"},
      rememberedAccounts: store,
    });
    await waitForLoginScreen(result);

    expect(result.current.screenProps.oauthProviders?.map(({provider}) => provider)).toEqual([
      "google",
      "github",
    ]);
    expect(
      result.current.screenProps.genericProviders?.map(({id, label}) => ({id, label}))
    ).toEqual([{id: "mock-oidc", label: "Mock OIDC"}]);

    await act(async () => {
      await result.current.screenProps.genericProviders?.[0].onPress();
    });
    expect(client.calls.social).toEqual([
      {callbackURL: "/login", errorCallbackURL: "/login", provider: "mock-oidc"},
    ]);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "mock-oidc", user: JANE}]);
    expect(store.list()[0]).toEqual(expect.objectContaining({method: "mock-oidc"}));
  });

  it("labels an unlabelled generic provider from its id and presses branded buttons", async () => {
    const client = fakeClient();
    const {result} = renderController({client});
    await waitForLoginScreen(result);
    expect(result.current.screenProps.genericProviders?.[0].label).toBe("Mock Oidc");
    await act(async () => {
      await result.current.screenProps.oauthProviders?.[0].onPress();
    });
    expect(client.calls.social).toEqual([{provider: "google"}]);
  });

  it("waits for a browser redirect instead of reading the session", async () => {
    globalWithWindow.window = {};
    const client = fakeClient(
      {},
      {social: async () => ({data: {redirect: true, url: "https://github.com/login"}, error: null})}
    );
    const {result, onSignedIn} = renderController({client});
    await waitForLoginScreen(result);
    const sessionChecks = client.calls.getSession;
    await act(async () => {
      await result.current.signInSocial("github");
    });
    expect(client.calls.getSession).toBe(sessionChecks);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(result.current.screenProps.loading).toBe(false);
  });

  it("records the provider a redirecting sign-in started with when the page returns signed in", async () => {
    const values = new Map<string, string>();
    globalWithWindow.window = {
      sessionStorage: {
        getItem: (key: string): string | null => values.get(key) ?? null,
        removeItem: (key: string): void => {
          values.delete(key);
        },
        setItem: (key: string, value: string): void => {
          values.set(key, value);
        },
      },
    };
    const leaving = renderController({
      client: fakeClient({}, {social: async () => ({data: {url: "https://x"}, error: null})}),
    });
    await waitForLoginScreen(leaving.result);
    await act(async () => {
      await leaving.result.current.signInSocial("github");
    });
    expect(values.get("terreno_login_pending_method")).toBe("github");

    // The provider sends the page back with a session.
    const store = createStore();
    const returned = renderController({
      client: fakeClient({sessionUser: JANE}),
      rememberedAccounts: store,
    });
    await waitFor(() => expect(returned.onSignedIn).toHaveBeenCalledTimes(1));
    expect(returned.onSignedIn.mock.calls[0]).toEqual([{method: "github", user: JANE}]);
    expect(values.has("terreno_login_pending_method")).toBe(false);
  });

  it("routes social sign-in through the OAuth handoff in bearer mode", async () => {
    const assign = mock((_url: string) => {});
    const sessionStorage = memoryStorage();
    globalWithWindow.window = {
      localStorage: memoryStorage(),
      location: {assign, href: "http://app.test/login"},
      sessionStorage,
    };
    const originalFetch = globalThis.fetch;
    // The real client's requests: only the methods endpoint answers; nothing is signed in.
    globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      return url.includes("/terreno/methods") ? Response.json(METHODS) : Response.json(null);
    }) as typeof fetch;
    try {
      const client = createBetterAuthClient({
        baseURL: "http://api.test",
        features: {multiSession: true, passkey: true, twoFactor: true},
        scheme: "terreno",
        webAuth: "bearer",
      });
      const onSignedIn = mock(() => {});
      const {result} = renderHook(() =>
        useLoginController({
          callbackURL: "/login",
          client,
          onSignedIn,
          rememberedAccounts: createStore(),
        })
      );
      await waitForLoginScreen(result);
      await act(async () => {
        await result.current.signInSocial("github");
      });

      const started = new URL(assign.mock.calls[0][0]);
      expect(started.origin).toBe("http://api.test");
      expect(started.pathname).toBe("/api/auth/oauth-handoff/start");
      expect(started.searchParams.get("provider")).toBe("github");
      expect(new URL(started.searchParams.get("callbackURL") ?? "").pathname).toBe("/login");
      expect(sessionStorage.values.get("terreno_login_pending_method")).toBe("github");
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // signIn.social answered without a redirect URL, which happens on native once the provider's
  // browser flow is over. On native a refused sign-in comes back the same way: Better Auth's Expo
  // plugin consumes the `?error=` deep link, so there is nothing to show (see the how-to).
  it("does nothing more when signIn.social returns no redirect URL and leaves no session", async () => {
    const client = fakeClient({}, {social: async () => ({data: {redirect: false}, error: null})});
    const {result, onSignedIn} = renderController({client});
    await waitForLoginScreen(result);
    await act(async () => {
      await result.current.signInSocial("github");
    });
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(result.current.screenProps.error).toBeUndefined();
  });

  it("signs in with a passkey from the button and reports failures", async () => {
    let passkeyResult: LoginClientResult<{user?: LoginUser}> = {
      data: null,
      error: {code: "AUTH_CANCELLED", message: "Authentication cancelled", status: 400},
    };
    const client = fakeClient({}, {passkey: async () => passkeyResult});
    const {result, onSignedIn, store} = renderController({client});
    await waitForLoginScreen(result);
    expect(result.current.screenProps.passkeyAutofill).toBe(true);

    await act(async () => {
      await result.current.screenProps.onPasskeyPress?.();
    });
    expect(result.current.screenProps.error).toBe("Authentication cancelled");

    passkeyResult = {data: null, error: {status: 400}};
    await act(async () => {
      await result.current.signInPasskey();
    });
    expect(result.current.screenProps.error).toBe("Passkey sign-in failed. Please try again.");

    passkeyResult = {data: {user: BOB}, error: null};
    await act(async () => {
      await result.current.signInPasskey();
    });
    expect(client.calls.passkey).toEqual([undefined, undefined, undefined]);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "passkey", user: BOB}]);
    expect(store.list()[0]).toEqual(expect.objectContaining({method: "passkey", userId: "u2"}));
  });

  it("reports a thrown passkey sign-in and hides passkeys the client or server lacks", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    const throwing = renderController({
      client: fakeClient(
        {},
        {
          passkey: async () => {
            throw new Error("webauthn");
          },
        }
      ),
    });
    await waitForLoginScreen(throwing.result);
    await act(async () => {
      await throwing.result.current.signInPasskey();
    });
    expect(throwing.result.current.screenProps.error).toBe(
      "Passkey sign-in failed. Please try again."
    );

    const noPlugin = renderController({client: fakeClient({}, {withoutPasskey: true})});
    await waitForLoginScreen(noPlugin.result);
    expect(noPlugin.result.current.screenProps.onPasskeyPress).toBeUndefined();
    await act(async () => {
      await noPlugin.result.current.signInPasskey();
    });

    const serverOff = renderController({
      client: fakeClient({methods: {...METHODS, passkey: false}}),
    });
    await waitForLoginScreen(serverOff.result);
    expect(serverOff.result.current.screenProps.onPasskeyPress).toBeUndefined();
    expect(serverOff.result.current.screenProps.passkeyAutofill).toBe(false);
  });

  it("starts passkey autofill on web when the browser supports conditional mediation", async () => {
    globalWithWindow.window = {
      PublicKeyCredential: {isConditionalMediationAvailable: async (): Promise<boolean> => true},
    };
    const client = fakeClient();
    const {result, onSignedIn} = renderController({client});
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(client.calls.passkey).toEqual([{autoFill: true}]);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "passkey", user: BOB}]);
    expect(result.current.step).toBe("signedIn");
  });

  it("ends autofill quietly, and skips it when unsupported or turned off", async () => {
    const infoSpy = spyOn(console, "info").mockImplementation(() => {});
    globalWithWindow.window = {
      PublicKeyCredential: {isConditionalMediationAvailable: async (): Promise<boolean> => true},
    };
    const aborted = renderController({
      client: fakeClient(
        {},
        {passkey: async () => ({data: null, error: {code: "ERROR_CEREMONY_ABORTED", status: 400}})}
      ),
    });
    await waitForLoginScreen(aborted.result);
    await waitFor(() => expect(infoSpy).toHaveBeenCalled());
    expect(aborted.result.current.screenProps.error).toBeUndefined();

    const turnedOffClient = fakeClient();
    const turnedOff = renderController({client: turnedOffClient, passkeyAutofill: false});
    await waitForLoginScreen(turnedOff.result);
    expect(turnedOff.result.current.screenProps.passkeyAutofill).toBe(false);
    expect(turnedOffClient.calls.passkey).toEqual([]);

    globalWithWindow.window = {
      PublicKeyCredential: {
        isConditionalMediationAvailable: async (): Promise<boolean> => {
          throw new Error("no");
        },
      },
    };
    const failing = renderController({client: fakeClient()});
    await waitForLoginScreen(failing.result);
    await waitFor(() =>
      expect(infoSpy.mock.calls.some(([text]) => String(text).includes("unavailable"))).toBe(true)
    );

    globalWithWindow.window = {};
    const unsupported = fakeClient();
    const noApi = renderController({client: unsupported});
    await waitForLoginScreen(noApi.result);
    expect(unsupported.calls.passkey).toEqual([]);
  });

  it("finishes a bearer social return before reading the token, and records the provider", async () => {
    const sessionStorage = memoryStorage();
    const localStorage = memoryStorage();
    sessionStorage.values.set("terreno_oauth_handoff_nonce", "nonce-1");
    sessionStorage.values.set("terreno_login_pending_method", "github");
    const replaceState = mock((_state: unknown, _title: string, _url: string) => {});
    globalWithWindow.window = {
      history: {replaceState, state: null},
      localStorage,
      location: {href: "http://app.test/login?handoff=nonce-1#ott=one-time"},
      sessionStorage,
    };
    const originalFetch = globalThis.fetch;
    const verified: string[] = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("/terreno/methods")) {
        return Response.json(METHODS);
      }
      if (request.url.includes("/one-time-token/verify")) {
        verified.push(((await request.json()) as {token: string}).token);
        return Response.json(
          {session: {id: "s"}, user: JANE},
          {headers: {"set-auth-token": "bearer-1"}}
        );
      }
      if (request.url.includes("/get-session")) {
        const isAuthorized = request.headers.get("authorization") === "Bearer bearer-1";
        return Response.json(isAuthorized ? {session: {id: "s"}, user: JANE} : null);
      }
      return Response.json(null);
    }) as typeof fetch;
    try {
      const client = createBetterAuthClient({
        baseURL: "http://api.test",
        features: {multiSession: true, passkey: true, twoFactor: true},
        scheme: "terreno",
        webAuth: "bearer",
      });
      const store = createStore();
      const onSignedIn = mock(() => {});
      renderHook(() => useLoginController({client, onSignedIn, rememberedAccounts: store}));

      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(verified).toEqual(["one-time"]);
      expect(localStorage.values.get("terreno_bearer_token")).toBe("bearer-1");
      expect(onSignedIn.mock.calls[0]).toEqual([
        {method: "github", user: expect.objectContaining({id: "u1"})},
      ]);
      expect(store.list()[0]).toEqual(expect.objectContaining({method: "github", userId: "u1"}));
      expect(sessionStorage.values.has("terreno_login_pending_method")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns to the login step with an error when onSignedIn throws", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    let signedInCalls = 0;
    const onSignedIn = async (): Promise<void> => {
      signedInCalls += 1;
      throw new Error("navigation failed");
    };
    const {result} = renderController({client: fakeClient(), onSignedIn});
    await waitForLoginScreen(result);
    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    expect(signedInCalls).toBe(1);
    expect(result.current.step).toBe("login");
    expect(result.current.screenProps.error).toBe("Sign in failed. Please try again.");
  });

  it("leaves out the email form, forgot-password and email cards when the server has email and password off", async () => {
    const onForgotPasswordPress = mock(() => {});
    const store = createStore();
    await store.record({method: "email", userId: JANE.id});
    const {result} = renderController({
      client: fakeClient({methods: {...METHODS, emailPassword: false}}),
      onForgotPasswordPress,
      rememberedAccounts: store,
    });
    await waitForLoginScreen(result);
    expect(result.current.isEmailPasswordEnabled).toBe(false);
    expect(result.current.screenProps.onForgotPasswordPress).toBeUndefined();

    await act(async () => {
      await result.current.continueAs({id: "u1", method: "email"}, "remembered");
    });
    expect(result.current.screenProps.error).toBe(
      "That sign-in method is no longer available. Choose another way to sign in."
    );

    const on = renderController({client: fakeClient(), onForgotPasswordPress});
    await waitForLoginScreen(on.result);
    expect(on.result.current.isEmailPasswordEnabled).toBe(true);
    expect(on.result.current.screenProps.onForgotPasswordPress).toBe(onForgotPasswordPress);
  });

  it("treats a remembered passkey card as unavailable when passkeys are off", async () => {
    const client = fakeClient({methods: {...METHODS, passkey: false}});
    const {result} = renderController({client});
    await waitForLoginScreen(result);
    await act(async () => {
      await result.current.continueAs({id: "u2", method: "passkey"}, "remembered");
    });
    expect(client.calls.passkey).toEqual([]);
    expect(result.current.screenProps.error).toBe(
      "That sign-in method is no longer available. Choose another way to sign in."
    );
  });

  it("clears a pending social provider when another sign-in method runs", async () => {
    const values = new Map<string, string>([["terreno_login_pending_method", "github"]]);
    globalWithWindow.window = {
      sessionStorage: {
        getItem: (key: string): string | null => values.get(key) ?? null,
        removeItem: (key: string): void => {
          values.delete(key);
        },
        setItem: (key: string, value: string): void => {
          values.set(key, value);
        },
      },
    };
    // A live-session check that found nothing already drops a stale entry.
    const {result, onSignedIn} = renderController({client: fakeClient()});
    await waitForLoginScreen(result);
    expect(values.has("terreno_login_pending_method")).toBe(false);

    values.set("terreno_login_pending_method", "github");
    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    expect(values.has("terreno_login_pending_method")).toBe(false);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "email", user: JANE}]);
  });

  it("drops passkey autofill that resolves after the screen unmounts", async () => {
    globalWithWindow.window = {
      PublicKeyCredential: {isConditionalMediationAvailable: async (): Promise<boolean> => true},
    };
    let resolvePasskey: (value: LoginClientResult<{user?: LoginUser}>) => void = () => {};
    const client = fakeClient(
      {},
      {
        passkey: () =>
          new Promise((resolve) => {
            resolvePasskey = resolve;
          }),
      }
    );
    const {unmount, onSignedIn} = renderController({client});
    await waitFor(() => expect(client.calls.passkey).toEqual([{autoFill: true}]));
    unmount();
    await act(async () => {
      resolvePasskey({data: {user: BOB}, error: null});
      await Promise.resolve();
    });
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("restarts passkey autofill when the screen returns to the login step", async () => {
    globalWithWindow.window = {
      PublicKeyCredential: {isConditionalMediationAvailable: async (): Promise<boolean> => true},
    };
    const client = fakeClient(
      {},
      {
        email: async () => ({
          data: {twoFactorMethods: ["totp"], twoFactorRedirect: true},
          error: null,
        }),
        // Autofill waits until the browser offers a passkey, which never happens here.
        passkey: () => new Promise(() => {}),
      }
    );
    const {result} = renderController({client});
    await waitFor(() => expect(client.calls.passkey).toHaveLength(1));
    await act(async () => {
      await result.current.signInEmail({email: "jane@example.com", password: "pw"});
    });
    expect(result.current.step).toBe("twoFactor");
    act(() => result.current.twoFactor.onCancel());
    await waitFor(() => expect(client.calls.passkey).toHaveLength(2));
    expect(client.calls.passkey).toEqual([{autoFill: true}, {autoFill: true}]);
  });

  it("switches to a device session when its card is pressed", async () => {
    const store = createStore();
    await store.record({method: "github", userId: BOB.id});
    const client = fakeClient({deviceSessions: [{session: {token: "tok-bob"}, user: BOB}]});
    const {result, onSignedIn} = renderController({client, rememberedAccounts: store});
    await waitForLoginScreen(result);
    await waitFor(() => expect(result.current.screenProps.currentSessions).toHaveLength(1));

    const [card] = result.current.screenProps.currentSessions ?? [];
    await act(async () => {
      await result.current.screenProps.onContinue(card, "session");
    });
    expect(client.calls.setActive).toEqual([{sessionToken: "tok-bob"}]);
    expect(onSignedIn.mock.calls[0]).toEqual([{method: "github", user: BOB}]);
  });

  it("reports a refused, empty, or thrown session switch", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    const account = {id: "tok", method: "email"};
    const refused = renderController({
      client: fakeClient(
        {},
        {setActive: async () => ({data: null, error: {message: "Nope", status: 401}})}
      ),
    });
    await waitForLoginScreen(refused.result);
    await act(async () => {
      await refused.result.current.continueAs(account, "session");
    });
    expect(refused.result.current.screenProps.error).toBe("Nope");

    const empty = renderController({client: fakeClient()});
    await waitForLoginScreen(empty.result);
    await act(async () => {
      await empty.result.current.continueAs(account, "session");
    });
    expect(empty.result.current.screenProps.error).toBe("Sign in failed. Please try again.");

    const throwing = renderController({
      client: fakeClient(
        {},
        {
          setActive: async () => {
            throw new Error("x");
          },
        }
      ),
    });
    await waitForLoginScreen(throwing.result);
    await act(async () => {
      await throwing.result.current.continueAs(account, "session");
    });
    expect(throwing.result.current.screenProps.error).toBe("Sign in failed. Please try again.");

    const noPlugin = renderController({client: fakeClient({}, {withoutMultiSession: true})});
    await waitForLoginScreen(noPlugin.result);
    await act(async () => {
      await noPlugin.result.current.continueAs(account, "session");
    });
    expect(noPlugin.result.current.screenProps.error).toBeUndefined();
  });

  it("re-authenticates a remembered account with its method", async () => {
    const store = createStore(true);
    const client = fakeClient();
    const {result, onSignedIn} = renderController({client, rememberedAccounts: store});
    await waitForLoginScreen(result);

    await act(async () => {
      await result.current.continueAs({id: "u1", method: "google"}, "remembered");
    });
    expect(client.calls.social).toEqual([{provider: "google"}]);

    await act(async () => {
      await result.current.continueAs({id: "u2", method: "passkey"}, "remembered");
    });
    expect(client.calls.passkey).toEqual([undefined]);
    expect(onSignedIn).toHaveBeenCalledTimes(2);
  });

  it("prefills or prompts for the email of a remembered email account", async () => {
    const {result} = renderController({client: fakeClient(), initialEmail: "start@example.com"});
    await waitForLoginScreen(result);
    expect(result.current.screenProps.initialValues).toEqual({email: "start@example.com"});

    await act(async () => {
      await result.current.continueAs(
        {email: "j***@e***.com", id: "u1", method: "email", name: "Jane"},
        "remembered"
      );
    });
    expect(result.current.screenProps.notice).toEqual({
      text: "Enter your email and password to continue as Jane.",
      tone: "info",
    });

    await act(async () => {
      await result.current.continueAs({id: "u1", method: "email"}, "remembered");
    });
    expect(result.current.screenProps.notice?.text).toBe(
      "Enter your email and password to continue."
    );

    await act(async () => {
      await result.current.continueAs(
        {email: "jane@example.com", id: "u1", method: "email"},
        "remembered"
      );
    });
    expect(result.current.screenProps.initialValues).toEqual({email: "jane@example.com"});
    expect(result.current.screenProps.notice).toBeUndefined();
  });

  it("explains a remembered method the server no longer offers, and forgets accounts", async () => {
    const store = createStore();
    await store.record({method: "apple", userId: "u9"});
    const {result} = renderController({client: fakeClient(), rememberedAccounts: store});
    await waitForLoginScreen(result);

    await act(async () => {
      await result.current.continueAs({id: "u9", method: "apple"}, "remembered");
    });
    expect(result.current.screenProps.error).toBe(
      "That sign-in method is no longer available. Choose another way to sign in."
    );

    await act(async () => {
      await result.current.screenProps.onForget({id: "u9", method: "apple"});
    });
    expect(store.list()).toEqual([]);
    expect(result.current.screenProps.rememberedAccounts).toEqual([]);
  });

  it("keeps working when the device-session list fails or the methods do not load", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const client = fakeClient();
    if (client.multiSession) {
      client.multiSession.listDeviceSessions = async () => {
        throw new Error("boom");
      };
    }
    const {result} = renderController({client});
    await waitForLoginScreen(result);
    await waitFor(() =>
      expect(warnSpy.mock.calls.some(([text]) => String(text).includes("sessions"))).toBe(true)
    );
    expect(result.current.screenProps.currentSessions).toEqual([]);

    const noMethods = fakeClient();
    noMethods.$fetch = async () => ({data: null, error: {message: "down"}});
    const offline = renderController({client: noMethods});
    await waitForLoginScreen(offline.result, false);
    expect(offline.result.current.screenProps.oauthProviders).toEqual([]);
    expect(offline.result.current.screenProps.genericProviders).toEqual([]);
  });
});

describe("recordRememberedSignIn", () => {
  it("swallows a store failure", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore();
    store.record = async () => {
      throw new Error("disk full");
    };
    await recordRememberedSignIn({method: "email", store, user: JANE});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
