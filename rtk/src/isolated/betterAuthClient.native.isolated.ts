/**
 * Isolated test for createBetterAuthClient on native. It mocks the platform as native, which
 * would leak into the web suites in betterAuthClient.test.ts if it shared their process.
 */
import {describe, expect, it, mock} from "bun:test";

mock.module("../platform", () => ({IsWeb: false}));

let capturedOptions: Record<string, unknown> | null = null;

mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({name: "expo-plugin"}),
}));

mock.module("better-auth/react", () => ({
  createAuthClient: (options: Record<string, unknown>) => {
    capturedOptions = options;
    return {};
  },
}));

const {createBetterAuthClient} = await import("../betterAuthClient");

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
