/**
 * Isolated test for the remembered-accounts default storage on native. It mocks the platform
 * as native and replaces expo-secure-store, which would leak into the web suites if it shared
 * their process.
 */
import {describe, expect, it, mock} from "bun:test";

mock.module("../auth/platform", () => ({IsWeb: false}));

const secureValues = new Map<string, string>();
const secureCalls: Array<{key: string; op: string; options: unknown}> = [];

mock.module("expo-secure-store", () => ({
  deleteItemAsync: async (key: string, options: unknown): Promise<void> => {
    secureCalls.push({key, op: "delete", options});
    secureValues.delete(key);
  },
  getItemAsync: async (key: string, options: unknown): Promise<string | null> => {
    secureCalls.push({key, op: "get", options});
    return secureValues.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string, options: unknown): Promise<void> => {
    secureCalls.push({key, op: "set", options});
    secureValues.set(key, value);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

const {createRememberedAccountsStore} = await import("../auth/rememberedAccounts");

describe("createRememberedAccountsStore on native", () => {
  it("hydrates from and writes to SecureStore, kept on this device only", async () => {
    const key = "terreno_remembered_accounts";
    secureValues.set(
      key,
      JSON.stringify({
        accounts: [{lastUsedAt: "2026-10-01T00:00:00.000Z", method: "passkey", userId: "u1"}],
        v: 1,
      })
    );

    const store = createRememberedAccountsStore({rememberIdentity: false});
    expect(store.isHydrated()).toBe(false);
    await store.ready;
    expect(store.isHydrated()).toBe(true);
    expect(store.lastUsedMethod()).toBe("passkey");

    await store.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "google", userId: "u2"});
    expect(
      JSON.parse(secureValues.get(key) ?? "{}").accounts.map((a: {userId: string}) => a.userId)
    ).toEqual(["u2", "u1"]);

    await store.clear();
    expect(secureValues.has(key)).toBe(false);

    // Hydration reads once; each change re-reads before writing.
    expect(secureCalls.map((call) => call.op)).toEqual(["get", "get", "set", "get", "delete"]);
    for (const call of secureCalls) {
      expect(call.key).toBe(key);
      expect(call.options).toEqual({keychainAccessible: "WHEN_UNLOCKED_THIS_DEVICE_ONLY"});
    }
  });
});
