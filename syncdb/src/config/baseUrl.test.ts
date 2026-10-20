import {beforeAll, describe, expect, it} from "bun:test";

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
