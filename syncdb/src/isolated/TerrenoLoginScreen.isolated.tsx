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
});
