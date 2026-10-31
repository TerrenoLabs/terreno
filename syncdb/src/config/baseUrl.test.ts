import {afterEach, beforeAll, describe, expect, it, spyOn} from "bun:test";
import Constants from "expo-constants";

type ConfigModule = typeof import("./baseUrl");

let config: ConfigModule;

// The module reads env at import, so clear the dev overrides a shell may export first.
beforeAll(async () => {
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_DEV_API_PORT;
  config = await import("./baseUrl");
});

// test-preload.ts mocks expo-constants with an empty `extra` and version "1.0.0".
describe("@terreno/syncdb/config", () => {
  it("resolves to the localhost dev API when nothing is configured", () => {
    expect(config.baseUrl).toBe("http://localhost:4000");
    expect(config.baseWebsocketsUrl).toBe("ws://localhost:4000/");
    expect(config.baseTasksUrl).toBe("http://localhost:4000/tasks");
  });

  it("builds App-Version and App-Platform headers", () => {
    expect(config.isWeb).toBe(false);
    expect(config.appHeaders()).toEqual({"App-Platform": "mobile", "App-Version": "1.0.0"});
  });
});

describe("Expo tunnel detection", () => {
  const constants = Constants as unknown as {expoGoConfig?: {debuggerHost?: string}};

  afterEach(() => {
    delete constants.expoGoConfig;
  });

  it("logs that tunnels are unsupported when the debugger host is an exp.direct tunnel", async () => {
    constants.expoGoConfig = {debuggerHost: "abc-anonymous-8081.exp.direct"};
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      // A query suffix gives a fresh module instance, so the import-time check runs again.
      const freshSpecifier = "./baseUrl?tunnel";
      const tunnelled = (await import(freshSpecifier)) as ConfigModule;

      expect(tunnelled.appHeaders()).toEqual(config.appHeaders());

      expect(errorSpy).toHaveBeenCalledWith(
        "Expo Tunnel is not currently supported for connecting to the API, please use LAN or Local mode."
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
