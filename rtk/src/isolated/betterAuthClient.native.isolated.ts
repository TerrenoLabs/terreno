/**
 * Isolated test for createBetterAuthClient on native. It mocks the platform as native, which
 * would leak into the web suites in betterAuthClient.test.ts if it shared their process.
 */
import {afterEach, describe, expect, it, mock} from "bun:test";

mock.module("../platform", () => ({IsWeb: false}));

let capturedOptions: Record<string, unknown> | null = null;
const fetchCalls: unknown[] = [];
// Order in which the mocked expo plugin's hook and onTwoFactorRedirect ran.
const hookOrder: string[] = [];
// When set, createAuthClient returns this instead of the stub.
let buildClient: ((options: Record<string, unknown>) => unknown) | null = null;

mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({
    fetchPlugins: [
      {
        hooks: {
          onSuccess: async (): Promise<void> => {
            hookOrder.push("expo");
          },
        },
        id: "expo",
        name: "Expo",
      },
    ],
    name: "expo-plugin",
  }),
}));

mock.module("better-auth/react", () => ({
  createAuthClient: (options: Record<string, unknown>) => {
    capturedOptions = options;
    if (buildClient) {
      return buildClient(options);
    }
    return {
      $fetch: async (...args: unknown[]): Promise<{data: null; error: null}> => {
        fetchCalls.push(args);
        return {data: null, error: null};
      },
    };
  },
}));

const {completeBetterAuthOAuthHandoff, createBetterAuthClient, signInSocialWithHandoff} =
  await import("../betterAuthClient");
// The real, unmocked vanilla client, so plugin hooks run through better-fetch's own pipeline.
const {createAuthClient: createRealAuthClient} = await import("better-auth/client");

describe("createBetterAuthClient on native", () => {
  it("passes only baseURL and plugins even with webAuth bearer", () => {
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      webAuth: "bearer",
    });

    expect(Object.keys(capturedOptions ?? {}).sort()).toEqual(["baseURL", "plugins"]);
    expect(capturedOptions?.baseURL).toBe("http://localhost:3000");
  });
});

describe("createBetterAuthClient features on native", () => {
  it("registers the feature plugins after the expo plugin", () => {
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      features: {
        lastLoginMethod: true,
        multiSession: true,
        oneTimeToken: true,
        passkey: true,
        twoFactor: true,
      },
      scheme: "terreno",
    });

    // The expo plugin must run first: better-fetch runs plugin hooks in order, so it stores the
    // 2FA challenge cookie before the two-factor plugin calls onTwoFactorRedirect.
    const plugins = (capturedOptions?.plugins ?? []) as Array<{id?: string; name?: string}>;
    expect(plugins.map((plugin) => plugin.id ?? plugin.name)).toEqual([
      "expo-plugin",
      "two-factor",
      "passkey",
      "multi-session",
      "last-login-method-client",
      "one-time-token",
    ]);
  });
});

describe("createBetterAuthClient two-factor redirect on native", () => {
  afterEach(() => {
    buildClient = null;
  });

  it("runs the expo plugin's hook before onTwoFactorRedirect", async () => {
    buildClient = (options: Record<string, unknown>): unknown =>
      createRealAuthClient({
        baseURL: options.baseURL as string,
        fetchOptions: {
          customFetchImpl: async (): Promise<Response> =>
            new Response(JSON.stringify({twoFactorMethods: ["totp"], twoFactorRedirect: true}), {
              headers: {"content-type": "application/json"},
            }),
        },
        plugins: options.plugins as never,
      });
    const client = createBetterAuthClient({
      baseURL: "http://localhost:3000",
      features: {
        twoFactor: {
          onTwoFactorRedirect: (): void => {
            hookOrder.push("onTwoFactorRedirect");
          },
        },
      },
      scheme: "terreno",
    });

    await client.signIn.email({email: "a@example.com", password: "secret"});

    expect(hookOrder).toEqual(["expo", "onTwoFactorRedirect"]);
  });
});

describe("OAuth handoff on native", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const hadWindow = "window" in globalWithWindow;
  const originalWindow = globalWithWindow.window;

  afterEach(() => {
    if (hadWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      delete globalWithWindow.window;
    }
  });

  it("makes no request for a matching handoff URL and refuses to start one", async () => {
    // React Native defines `window`; a handoff-shaped URL there must still be ignored.
    const nonce = "a".repeat(64);
    const replaced: string[] = [];
    globalWithWindow.window = {
      history: {
        replaceState: (_state: unknown, _title: string, url: string): void => {
          replaced.push(url);
        },
        state: null,
      },
      location: {href: `http://localhost:8082/?handoff=${nonce}#ott=abc`},
      sessionStorage: {
        getItem: (): string => nonce,
        removeItem: (): void => {},
        setItem: (): void => {},
      },
    };
    const client = createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      webAuth: "bearer",
    });

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(fetchCalls).toEqual([]);
    expect(replaced).toEqual([]);
    expect(() => signInSocialWithHandoff({client, provider: "google"})).toThrow(
      "authClient.signIn.social"
    );
  });
});
