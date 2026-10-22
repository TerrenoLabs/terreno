/**
 * Isolated test for createBetterAuthClient on native. It mocks the platform as native, which
 * would leak into the web suites in betterAuthClient.test.ts if it shared their process.
 */
import {afterEach, describe, expect, it, mock} from "bun:test";

mock.module("../auth/platform", () => ({IsWeb: false}));

let capturedOptions: Record<string, unknown> | null = null;
const fetchCalls: unknown[] = [];

mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({name: "expo-plugin"}),
}));

mock.module("better-auth/react", () => ({
  createAuthClient: (options: Record<string, unknown>) => {
    capturedOptions = options;
    return {
      $fetch: async (...args: unknown[]): Promise<{data: null; error: null}> => {
        fetchCalls.push(args);
        return {data: null, error: null};
      },
    };
  },
}));

const {completeBetterAuthOAuthHandoff, createBetterAuthClient, signInSocialWithHandoff} =
  await import("../auth/betterAuthClient");

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
