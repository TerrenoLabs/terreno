/**
 * Isolated test for useAccountSecurity on native (`IsWeb` false): React Native has no WebAuthn,
 * so the passkeys card is hidden and passkeys are never loaded, even when the server and the
 * client both have the feature on. Platform and the Expo plugin are replaced here, where the mocks
 * cannot leak into other suites.
 */
import {describe, expect, it, mock} from "bun:test";
import {renderHook, waitFor} from "@testing-library/react-native";

import type {AccountSecurityClient} from "../auth/useAccountSecurity";
import type {BetterAuthMethods} from "../useAuthMethods";

mock.module("../platform", () => ({IsWeb: false}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({id: "expo", name: "expo-plugin"}),
}));

const {useAccountSecurity} = await import("../auth/useAccountSecurity");

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: false,
  passkey: true,
  providers: ["google"],
  signUp: true,
  twoFactor: true,
};

const ok = <Data>(data: Data): {data: Data; error: null} => ({data, error: null});

describe("useAccountSecurity on native", () => {
  it("hides the passkeys card and never lists passkeys", async () => {
    const listUserPasskeys = mock(async () => ok([{id: "pk-1"}]));
    const client: AccountSecurityClient = {
      $fetch: async () => ({data: METHODS, error: null}),
      changePassword: async () => ok({}),
      getSession: async () => ok({session: {id: "s1"}, user: {id: "u1"}}),
      linkSocial: async () => ({error: null}),
      listAccounts: async () => ok([{id: "acc-google", providerId: "google"}]),
      listSessions: async () => ok([{id: "s1", token: "t1"}]),
      passkey: {
        addPasskey: async () => ok({}),
        deletePasskey: async () => ok({}),
        listUserPasskeys,
        updatePasskey: async () => ok({}),
      },
      revokeOtherSessions: async () => ok({}),
      revokeSession: async () => ok({}),
      unlinkAccount: async () => ok({}),
    };

    const {result} = renderHook(() => useAccountSecurity({callbackURL: "/security", client}));
    await waitFor(() => expect(result.current.screenProps.isLoading).toBe(false));

    expect(result.current.screenProps.passkeys).toBeUndefined();
    expect(result.current.screenProps.linkedAccounts).toBeDefined();
    expect(result.current.screenProps.sessions).toBeDefined();
    expect(listUserPasskeys).not.toHaveBeenCalled();
  });
});
