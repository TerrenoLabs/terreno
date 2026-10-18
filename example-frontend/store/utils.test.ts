import {beforeEach, describe, expect, it, mock} from "bun:test";

(globalThis as {__DEV__?: boolean}).__DEV__ = false;

const reactNative = await import("react-native");
const platform = {
  OS: "web",
  select: <T>(specifics: {default?: T; web?: T}): T | undefined => {
    return specifics[platform.OS as keyof typeof specifics] ?? specifics.default;
  },
};
const constants = {
  default: {
    expoConfig: {
      extra: {APP_ENV: "staging" as string | undefined, eas: {projectId: "prod-id"}},
      version: "1.2.3" as string | undefined,
    },
    manifest2: {metadata: {channel: "staging"}} as {metadata?: {channel?: string}},
  },
};

mock.module("expo-constants", () => constants);
mock.module("expo-updates", () => ({
  channel: null,
  manifest: {version: "9.9.9"},
}));
mock.module("react-native", () => ({
  ...reactNative,
  Platform: platform,
}));

const getExpoPushTokenAsync = mock(async ({projectId}: {projectId?: string}) => ({
  data: `token-${projectId ?? "none"}`,
  type: "expo",
}));
const requestPermissionsAsync = mock(async () => ({status: "granted"}));

mock.module("expo-notifications", () => ({
  getExpoPushTokenAsync,
  requestPermissionsAsync,
}));

const {buildVersionInfo, getCurrentExpoToken, versionInfo} = await import("./utils");

describe("buildVersionInfo", () => {
  it("reads environment, channel, and version from provided inputs", () => {
    expect(
      buildVersionInfo({
        appEnv: "staging",
        configVersion: "1.2.3",
        isDev: false,
        manifestChannel: "staging",
        updatesChannel: null,
        updatesVersion: "9.9.9",
      })
    ).toEqual({
      dev: false,
      environment: "staging",
      updateChannel: "staging",
      version: "9.9.9",
    });
  });

  it("prefers updates channel and falls back to config version", () => {
    expect(
      buildVersionInfo({
        configVersion: "1.2.3",
        isDev: true,
        updatesChannel: "preview",
      })
    ).toEqual({
      dev: true,
      environment: "dev",
      updateChannel: "preview",
      version: "1.2.3",
    });
  });

  it("falls back to unknown channel and version", () => {
    expect(
      buildVersionInfo({
        isDev: false,
      })
    ).toEqual({
      dev: false,
      environment: "unknown",
      updateChannel: "unknown",
      version: "Unknown",
    });
  });
});

describe("versionInfo", () => {
  it("reads Expo config through buildVersionInfo", () => {
    const info = versionInfo();
    expect(info.environment).toBe("staging");
    expect(info.updateChannel).toBe("staging");
    expect(info.version).toBe("9.9.9");
    expect(info.dev).toBe(false);
  });
});

describe("getCurrentExpoToken", () => {
  beforeEach(() => {
    getExpoPushTokenAsync.mockClear();
    requestPermissionsAsync.mockClear();
    requestPermissionsAsync.mockImplementation(async () => ({status: "granted"}));
    platform.OS = "web";
    (globalThis as {__DEV__?: boolean}).__DEV__ = false;
  });

  it("returns an empty expo token on web", async () => {
    const token = await getCurrentExpoToken();
    expect(token).toEqual({data: "", type: "expo"});
    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("does not fetch a push token when notification permission is denied", async () => {
    platform.OS = "ios";
    requestPermissionsAsync.mockImplementation(async () => ({status: "denied"}));
    const token = await getCurrentExpoToken();
    expect(token).toEqual({data: "", type: "expo"});
    expect(requestPermissionsAsync).toHaveBeenCalled();
    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("loads expo-notifications on native production", async () => {
    platform.OS = "ios";
    const token = await getCurrentExpoToken();
    expect(token).toEqual({data: "token-prod-id", type: "expo"});
  });

  it("uses app.json projectId in native development", async () => {
    platform.OS = "ios";
    (globalThis as {__DEV__?: boolean}).__DEV__ = true;
    const token = await getCurrentExpoToken();
    expect(token.type).toBe("expo");
    expect(getExpoPushTokenAsync).toHaveBeenCalled();
  });
});
