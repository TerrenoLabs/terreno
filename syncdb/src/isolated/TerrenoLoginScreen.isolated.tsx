/**
 * Isolated test for TerrenoLoginScreen. rtk's test preload stubs react-native, so `@terreno/ui`
 * cannot render here; it is replaced with components that record their props, which shows which
 * step renders and what it receives. The Expo plugin is replaced too (see
 * useLoginController.isolated.ts).
 */
import {afterEach, describe, expect, it, mock} from "bun:test";
import type {ReactElement} from "react";
import {act, create, type ReactTestRenderer} from "react-test-renderer";
import type {BetterAuthMethods} from "../auth/useAuthMethods";
import type {LoginControllerClient, LoginUser} from "../auth/useLoginController";

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

mock.module("@terreno/ui", () => ({
  Box: (props: {children?: ReactElement}): ReactElement | null => {
    rendered.push({name: "Box", props});
    return props.children ?? null;
  },
  LoginScreen: recorder("LoginScreen"),
  Spinner: recorder("Spinner"),
  TwoFactorChallengeScreen: recorder("TwoFactorChallengeScreen"),
}));

const {createRememberedAccountsStore} = await import("../auth/rememberedAccounts");
const {DEFAULT_LOGIN_FIELDS, TerrenoLoginScreen} = await import("../auth/TerrenoLoginScreen");

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: false,
  passkey: false,
  providers: ["github"],
  signUp: true,
  twoFactor: true,
};

const JANE: LoginUser = {email: "jane@example.com", id: "u1", name: "Jane"};

const memoryStore = (): ReturnType<typeof createRememberedAccountsStore> => {
  const values = new Map<string, string>();
  return createRememberedAccountsStore({
    rememberIdentity: false,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  });
};

const fakeClient = (methods: BetterAuthMethods = METHODS): LoginControllerClient => ({
  $fetch: async () => ({data: methods, error: null}),
  getSession: async () => ({data: null, error: null}),
  signIn: {
    email: async () => ({data: {twoFactorMethods: ["totp"], twoFactorRedirect: true}, error: null}),
    passkey: async () => ({data: null, error: null}),
    social: async () => ({data: null, error: null}),
  },
  twoFactor: {
    verifyBackupCode: async () => ({data: {user: JANE}, error: null}),
    verifyTotp: async () => ({data: {user: JANE}, error: null}),
  },
});

const find = (name: string): Record<string, unknown> | undefined => {
  return rendered.filter((entry) => entry.name === name).at(-1)?.props;
};

const last = (name: string): Record<string, unknown> => {
  const props = find(name);
  if (!props) {
    throw new Error(`${name} never rendered`);
  }
  return props;
};

// Lets the session check and the methods request settle.
const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe("TerrenoLoginScreen", () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    rendered.length = 0;
    act(() => renderer?.unmount());
  });

  it("shows a spinner while checking, then the login screen, then the inline two-factor step", async () => {
    const onSignedIn = mock(() => {});
    await act(async () => {
      renderer = create(
        <TerrenoLoginScreen
          client={fakeClient()}
          onSignedIn={onSignedIn}
          rememberedAccounts={memoryStore()}
          testID="login"
          title="Sign in"
          trustDeviceDays={30}
          webAuth="cookie"
        />
      );
    });
    expect(
      rendered.some((entry) => entry.name === "Box" && entry.props.testID === "login-checking")
    ).toBe(true);

    await flush();
    const login = last("LoginScreen");
    expect(login.fields).toBe(DEFAULT_LOGIN_FIELDS);
    expect(login.testID).toBe("login");
    expect(login.title).toBe("Sign in");
    expect(
      (login.oauthProviders as Array<{provider: string}>).map(({provider}) => provider)
    ).toEqual(["github"]);

    await act(async () => {
      await (login.onSubmit as (values: Record<string, string>) => Promise<void>)({
        email: "jane@example.com",
        password: "pw",
      });
    });
    const challenge = last("TwoFactorChallengeScreen");
    expect(challenge.trustDeviceDays).toBe(30);
    expect(challenge.initialTrustDevice).toBeUndefined();

    await act(async () => {
      await (challenge.onSubmit as (values: unknown) => Promise<void>)({
        code: "123456",
        kind: "totp",
        trustDevice: false,
      });
    });
    expect(onSignedIn).toHaveBeenCalledWith({method: "email", user: JANE});
  });

  it("starts the trust checkbox unchecked when initialTrustDevice is false", async () => {
    await act(async () => {
      renderer = create(
        <TerrenoLoginScreen
          client={fakeClient()}
          initialTrustDevice={false}
          onSignedIn={mock(() => {})}
          rememberedAccounts={memoryStore()}
          trustDeviceDays={30}
          webAuth="cookie"
        />
      );
    });
    await flush();
    const login = last("LoginScreen");
    await act(async () => {
      await (login.onSubmit as (values: Record<string, string>) => Promise<void>)({
        email: "jane@example.com",
        password: "pw",
      });
    });
    expect(last("TwoFactorChallengeScreen").initialTrustDevice).toBe(false);
  });

  it("reports each step it moves to", async () => {
    const onStepChange = mock((_step: string) => {});
    await act(async () => {
      renderer = create(
        <TerrenoLoginScreen
          client={fakeClient()}
          onSignedIn={mock(() => {})}
          onStepChange={onStepChange}
          rememberedAccounts={memoryStore()}
          webAuth="cookie"
        />
      );
    });
    await flush();
    const login = last("LoginScreen");
    await act(async () => {
      await (login.onSubmit as (values: Record<string, string>) => Promise<void>)({
        email: "jane@example.com",
        password: "pw",
      });
    });

    expect(onStepChange.mock.calls.map(([step]) => step)).toEqual([
      "checking",
      "login",
      "twoFactor",
    ]);
  });

  it("passes no fields when the server has email and password off", async () => {
    await act(async () => {
      renderer = create(
        <TerrenoLoginScreen
          client={fakeClient({...METHODS, emailPassword: false})}
          onForgotPasswordPress={mock(() => {})}
          onSignedIn={mock(() => {})}
          rememberedAccounts={memoryStore()}
          webAuth="cookie"
        />
      );
    });
    await flush();
    const login = last("LoginScreen");
    expect(login.fields).toEqual([]);
    expect(login.onForgotPasswordPress).toBeUndefined();
  });

  it("leaves the two-factor step to the app when onTwoFactorRequired is set", async () => {
    const onTwoFactorRequired = mock(() => {});
    await act(async () => {
      renderer = create(
        <TerrenoLoginScreen
          client={fakeClient()}
          onSignedIn={mock(() => {})}
          onTwoFactorRequired={onTwoFactorRequired}
          rememberedAccounts={memoryStore()}
          webAuth="cookie"
        />
      );
    });
    await flush();
    const login = last("LoginScreen");
    expect(login.testID).toBe("login-screen");
    await act(async () => {
      await (login.onSubmit as (values: Record<string, string>) => Promise<void>)({
        email: "jane@example.com",
        password: "pw",
      });
    });
    expect(onTwoFactorRequired).toHaveBeenCalledWith({method: "email", twoFactorMethods: ["totp"]});
    expect(find("TwoFactorChallengeScreen")).toBeUndefined();
  });

  describe("methods allowlist", () => {
    const renderScreen = async (
      serverMethods: BetterAuthMethods,
      methods?: {providers?: string[]; emailPassword?: boolean; passkey?: boolean}
    ): Promise<Record<string, unknown>> => {
      await act(async () => {
        renderer = create(
          <TerrenoLoginScreen
            client={fakeClient(serverMethods)}
            methods={methods}
            onSignedIn={mock(() => {})}
            rememberedAccounts={memoryStore()}
            webAuth="cookie"
          />
        );
      });
      await flush();
      return last("LoginScreen");
    };
    const branded = (login: Record<string, unknown>): string[] =>
      ((login.oauthProviders ?? []) as Array<{provider: string}>).map(({provider}) => provider);
    const generic = (login: Record<string, unknown>): string[] =>
      ((login.genericProviders ?? []) as Array<{id: string}>).map(({id}) => id);

    it("renders only the Google button when the server offers google, github, apple", async () => {
      const login = await renderScreen(
        {...METHODS, providers: ["google", "github", "apple"]},
        {providers: ["google"]}
      );
      expect(branded(login)).toEqual(["google"]);
      expect(generic(login)).toEqual([]);
    });

    it("renders only the mock-oidc generic button for providers mock-oidc and apple", async () => {
      const login = await renderScreen(
        {...METHODS, providers: ["google", "mock-oidc"]},
        {providers: ["mock-oidc", "apple"]}
      );
      expect(branded(login)).toEqual([]);
      expect(generic(login)).toEqual(["mock-oidc"]);
    });

    it("renders no social buttons but keeps the email form for providers []", async () => {
      const login = await renderScreen(
        {...METHODS, providers: ["google", "mock-oidc"]},
        {providers: []}
      );
      expect(branded(login)).toEqual([]);
      expect(generic(login)).toEqual([]);
      expect(login.fields).toBe(DEFAULT_LOGIN_FIELDS);
    });

    it("renders no email form with emailPassword false while the server has it on", async () => {
      const login = await renderScreen({...METHODS, emailPassword: true}, {emailPassword: false});
      expect(login.fields).toEqual([]);
    });

    it("renders no email form with emailPassword true while the server has it off, and the form when both agree", async () => {
      const off = await renderScreen({...METHODS, emailPassword: false}, {emailPassword: true});
      expect(off.fields).toEqual([]);
      act(() => renderer?.unmount());
      rendered.length = 0;
      const on = await renderScreen({...METHODS, emailPassword: true}, {emailPassword: true});
      expect(on.fields).toBe(DEFAULT_LOGIN_FIELDS);
    });

    it("renders no passkey button with passkey false while the server has it on", async () => {
      const login = await renderScreen({...METHODS, passkey: true}, {passkey: false});
      expect(login.onPasskeyPress).toBeUndefined();
    });

    it("renders the passkey button with passkey true only when the server has it on", async () => {
      const off = await renderScreen({...METHODS, passkey: false}, {passkey: true});
      expect(off.onPasskeyPress).toBeUndefined();
      act(() => renderer?.unmount());
      rendered.length = 0;
      const on = await renderScreen({...METHODS, passkey: true}, {passkey: true});
      expect(on.onPasskeyPress).toBeDefined();
    });

    it("renders every server method when methods is undefined", async () => {
      const login = await renderScreen(
        {...METHODS, passkey: true, providers: ["google", "github", "mock-oidc"]},
        undefined
      );
      expect(branded(login)).toEqual(["google", "github"]);
      expect(generic(login)).toEqual(["mock-oidc"]);
      expect(login.fields).toBe(DEFAULT_LOGIN_FIELDS);
      expect(login.onPasskeyPress).toBeDefined();
    });
  });
});
