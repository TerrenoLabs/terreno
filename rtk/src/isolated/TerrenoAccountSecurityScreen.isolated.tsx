/**
 * Isolated test for TerrenoAccountSecurityScreen. rtk's test preload stubs react-native, so
 * `@terreno/ui` cannot render here; `AccountSecurityScreen` is replaced with a component that
 * records its props, which shows which cards the screen asks for. The Expo plugin is replaced too
 * (see useAccountSecurity.isolated.ts).
 */
import {afterEach, describe, expect, it, mock} from "bun:test";
import type {ReactNode} from "react";
import {act, create, type ReactTestRenderer} from "react-test-renderer";

import type {AccountSecurityClient} from "../auth/useAccountSecurity";
import type {BetterAuthMethods} from "../useAuthMethods";

// Tells React this process drives updates through act(), as @testing-library does.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("../platform", () => ({IsWeb: true}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({id: "expo", name: "expo-plugin"}),
}));

const rendered: Array<Record<string, unknown>> = [];

mock.module("@terreno/ui", () => ({
  AccountSecurityScreen: (props: Record<string, unknown> & {children?: ReactNode}): ReactNode => {
    rendered.push(props);
    return props.children ?? null;
  },
}));

const {TerrenoAccountSecurityScreen} = await import("../auth/TerrenoAccountSecurityScreen");

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: false,
  passkey: false,
  providers: ["github"],
  signUp: true,
  twoFactor: true,
};

const ok = <Data,>(data: Data): {data: Data; error: null} => ({data, error: null});

const fakeClient = (): AccountSecurityClient => ({
  $fetch: async () => ({data: METHODS, error: null}),
  changePassword: async () => ok({}),
  getSession: async () =>
    ok({session: {id: "s1"}, user: {email: "jane@example.com", id: "u1", twoFactorEnabled: true}}),
  linkSocial: async () => ({error: null}),
  listAccounts: async () => ok([{id: "acc-github", providerId: "github"}]),
  listSessions: async () => ok([{id: "s1", token: "t1"}]),
  revokeOtherSessions: async () => ok({}),
  revokeSession: async () => ok({}),
  twoFactor: {
    disable: async () => ok({}),
    enable: async () => ok({backupCodes: [], totpURI: "otpauth://totp/x?secret=A"}),
    generateBackupCodes: async () => ok({backupCodes: []}),
    verifyTotp: async () => ok({}),
  },
  unlinkAccount: async () => ok({}),
});

const lastProps = (): Record<string, unknown> => {
  const props = rendered.at(-1);
  if (!props) {
    throw new Error("AccountSecurityScreen never rendered");
  }
  return props;
};

// Lets the methods request and the section loads settle.
const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe("TerrenoAccountSecurityScreen", () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    rendered.length = 0;
    act(() => renderer?.unmount());
  });

  it("renders AccountSecurityScreen with the cards the server's methods turn on", async () => {
    await act(async () => {
      renderer = create(
        <TerrenoAccountSecurityScreen
          callbackURL="/security"
          client={fakeClient()}
          description="Manage how you sign in"
          maxWidth={640}
          testID="security"
          title="Account security"
          withPage={false}
        >
          extra
        </TerrenoAccountSecurityScreen>
      );
    });
    expect(rendered[0]?.isLoading).toBe(true);

    await flush();
    const props = lastProps();
    expect(props.isLoading).toBe(false);
    expect(props.title).toBe("Account security");
    expect(props.description).toBe("Manage how you sign in");
    expect(props.testID).toBe("security");
    expect(props.withPage).toBe(false);
    expect(props.maxWidth).toBe(640);
    expect(props.children).toBe("extra");
    expect(props.linkedAccounts).toBeDefined();
    expect(props.password).toBeDefined();
    expect(props.sessions).toBeDefined();
    expect((props.twoFactor as {enabled: boolean}).enabled).toBe(true);
    // The server has passkeys off, so the passkey card is left out.
    expect(props.passkeys).toBeUndefined();
  });
});
