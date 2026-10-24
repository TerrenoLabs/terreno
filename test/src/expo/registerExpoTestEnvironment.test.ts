import {afterAll, describe, expect, it, mock, spyOn} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DateTime} from "luxon";

import {asyncStorage, secureStore} from "./authTokenStorage";
import {
  ASSET_FILE_PATTERN,
  createDefaultExpoModuleMocks,
  registerExpoTestEnvironment,
} from "./registerExpoTestEnvironment";

// Bun runs this package's backend suites in the same process; put their env back afterwards.
const originalEnv = {EXPO_OS: process.env.EXPO_OS, TZ: process.env.TZ};
afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

const appRoot = mkdtempSync(join(tmpdir(), "terreno-expo-env-"));
const nestedPackageFile = join(appRoot, "node_modules/terreno-nested-only/index.js");
mkdirSync(join(nestedPackageFile, ".."), {recursive: true});
writeFileSync(nestedPackageFile, "module.exports = {source: 'real'};\n");
afterAll(() => {
  rmSync(appRoot, {force: true, recursive: true});
});

const hapticsOverride = mock(() => Promise.resolve());

// Nested describe blocks register again at collection time, so they share these options.
const sharedOptions = {
  expoConfig: {extra: {AUTH_DEBUG: true}, scheme: "terrenotest"},
  overrides: {
    "expo-haptics": () => ({impactAsync: hapticsOverride}),
    "terreno-nested-only": () => ({source: "mock"}),
  },
  skip: ["expo-updates"],
};

const environment = registerExpoTestEnvironment({
  ...sharedOptions,
  cleanup: {restoreModules: ["expo-clipboard"]},
  resolveFrom: appRoot,
});
// The backend preload this package runs under resets TZ in its own hooks, so read it now.
const envAtRegistration = {EXPO_OS: process.env.EXPO_OS, TZ: process.env.TZ};

const testGlobals = globalThis as typeof globalThis & {
  __DEV__?: boolean;
  expo?: {EventEmitter: new () => {addListener: () => {remove: () => void}}};
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("registerExpoTestEnvironment", () => {
  it("lists every mocked module except skipped ones", () => {
    expect(environment.mockedModules).toContain("react-native");
    expect(environment.mockedModules).toContain("expo-router");
    expect(environment.mockedModules).toContain("expo-secure-store");
    expect(environment.mockedModules).toContain("terreno-nested-only");
    expect(environment.mockedModules).not.toContain("expo-updates");
  });

  it("sets the React Native globals and process env", () => {
    expect(envAtRegistration).toEqual({EXPO_OS: "ios", TZ: "America/New_York"});
    expect(testGlobals.__DEV__).toBe(true);
    expect(testGlobals.IS_REACT_ACT_ENVIRONMENT).toBe(true);
    const emitter = new (testGlobals.expo as NonNullable<typeof testGlobals.expo>).EventEmitter();
    expect(typeof emitter.addListener().remove).toBe("function");
  });

  it("uses overrides in place of the defaults", async () => {
    const haptics = await import("expo-haptics");
    await haptics.impactAsync(haptics.ImpactFeedbackStyle?.Light);
    expect(hapticsOverride).toHaveBeenCalled();
  });

  it("registers mocks under the path the app resolves", async () => {
    const nested = (await import(nestedPackageFile)) as {source: string};
    expect(nested.source).toBe("mock");
  });

  it("passes expoConfig and scheme to expo-constants and expo-linking", async () => {
    const constants = (await import("expo-constants")).default;
    expect(constants.expoConfig?.extra).toEqual({AUTH_DEBUG: true});
    const linking = await import("expo-linking");
    expect(linking.createURL("/todos", {queryParams: {id: "1"}})).toBe("terrenotest://todos?id=1");
    expect(linking.createURL("")).toBe("terrenotest://");
  });

  it("serves image and font imports as asset stubs", async () => {
    const imageFile = join(appRoot, "icon.png");
    writeFileSync(imageFile, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(((await import(imageFile)) as {default: unknown}).default).toEqual({
      height: 1,
      uri: "test-asset",
      width: 1,
    });
    expect(ASSET_FILE_PATTERN.test("icon.png")).toBe(true);
    expect(ASSET_FILE_PATTERN.test("Nunito.ttf")).toBe(true);
    expect(ASSET_FILE_PATTERN.test("module.ts")).toBe(false);
  });

  it("re-registers a default mock with restoreModuleMock", async () => {
    mock.module("expo-splash-screen", () => ({hideAsync: (): string => "suite mock"}));
    expect((await import("expo-splash-screen")).hideAsync()).toBe("suite mock");
    environment.restoreModuleMock("expo-splash-screen");
    expect(await (await import("expo-splash-screen")).hideAsync()).toBe(true);
  });

  it("refuses to restore a module it does not mock", () => {
    expect(() => environment.restoreModuleMock("expo-updates")).toThrow(
      /does not mock "expo-updates"/u
    );
    expect(() => environment.restoreModuleMock("left-pad")).toThrow(/does not mock "left-pad"/u);
  });

  describe("afterEach cleanup", () => {
    const target = {read: (): string => "real"};

    it("lets a test change state", async () => {
      spyOn(target, "read").mockReturnValue("spied");
      secureStore.AUTH_TOKEN = "token";
      asyncStorage.key = "value";
      testGlobals.__DEV__ = false;
      mock.module("expo-clipboard", () => ({getStringAsync: (): string => "suite mock"}));
      expect(target.read()).toBe("spied");
      expect((await import("expo-clipboard")).getStringAsync()).toBe("suite mock");
    });

    it("puts it back before the next test", async () => {
      expect(target.read()).toBe("real");
      expect(secureStore).toEqual({});
      expect(asyncStorage).toEqual({});
      expect(testGlobals.__DEV__).toBe(true);
      expect(await (await import("expo-clipboard")).getStringAsync()).toBe("");
    });
  });

  describe("fixedNow", () => {
    registerExpoTestEnvironment({
      ...sharedOptions,
      cleanup: false,
      fixedNow: "2024-06-01T10:30:00.000Z",
      setProcessEnv: false,
      stubAssets: false,
    });

    it("freezes the clock before each test", () => {
      expect(DateTime.now().toUTC().toISO()).toBe("2024-06-01T10:30:00.000Z");
    });

    it("rejects a timestamp that is not ISO", () => {
      expect(() => registerExpoTestEnvironment({cleanup: false, fixedNow: "not a date"})).toThrow(
        /not an ISO timestamp/u
      );
    });
  });

  describe("cleanup: false and resolveFrom: false", () => {
    registerExpoTestEnvironment({
      ...sharedOptions,
      cleanup: false,
      resolveFrom: false,
      setProcessEnv: false,
    });

    it("leaves state from a previous test alone", () => {
      secureStore.kept = "yes";
    });

    it("still runs the outer cleanup", () => {
      expect(secureStore).toEqual({});
    });
  });
});

describe("createDefaultExpoModuleMocks", () => {
  it("adds react-native mocks for nested package copies", () => {
    const mocks = createDefaultExpoModuleMocks({
      nestedPackagePrefixes: ["@terreno/ui/node_modules/"],
    });
    expect(mocks["@terreno/ui/node_modules/react-native"]?.()).toBe(mocks["react-native"]?.());
    expect(
      mocks["@terreno/ui/node_modules/react-native/Libraries/Utilities/Platform"]
    ).toBeDefined();
  });
});
