import {afterEach, beforeEach, mock, setSystemTime} from "bun:test";
import {DateTime} from "luxon";

import {
  clearAuthTokenStorage,
  createAuthTokenStorageModuleMocks,
  resetAuthTokenStorageMocks,
} from "./authTokenStorage";
import {
  createExpoGlobal,
  createExpoModuleMocks,
  type ExpoModuleMockOptions,
} from "./expoModuleMocks";
import {createLibraryModuleMocks} from "./libraryModuleMocks";
import type {ModuleFactory, ModuleMockMap} from "./mockHelpers";
import {createReactNativeModuleMocks} from "./reactNativeMock";

/** What the `afterEach` hook the registrar installs resets. Every flag defaults to `true`. */
export interface ExpoTestCleanupOptions {
  /** Empty the in-memory SecureStore/AsyncStorage and reset their mocks. */
  clearStorage?: boolean;
  /** `mock.restore()`: put every `spyOn` spy back. Does not undo `mock.module`. */
  restoreMocks?: boolean;
  /**
   * Specifiers whose environment mock is re-registered after each test, undoing a suite's own
   * `mock.module` for them (which `mock.restore()` cannot). Default `[]`.
   */
  restoreModules?: readonly string[];
  /** Set `__DEV__` back to `true`. */
  resetDevFlag?: boolean;
}

/** Options for `registerExpoTestEnvironment`. Every field is optional. */
export interface ExpoTestEnvironmentOptions extends ExpoModuleMockOptions {
  /** Install the `afterEach` reset (`true`), skip it (`false`), or pick its steps. Default `true`. */
  cleanup?: boolean | ExpoTestCleanupOptions;
  /** ISO timestamp the clock is frozen at before each test (`setSystemTime`). Default: real clock. */
  fixedNow?: string;
  /**
   * Package prefixes that hold their own `react-native` copy, e.g. `"@terreno/ui/node_modules/"`.
   * Bun loads a nested copy as a separate module, so it needs its own mock.
   */
  nestedPackagePrefixes?: readonly string[];
  /** Factories that replace a default mock, or add a module the defaults do not cover. */
  overrides?: ModuleMockMap;
  /**
   * Directory the app resolves packages from. Each mock is also registered under the file path a
   * specifier resolves to from here, so it still applies when the app and `@terreno/test` resolve
   * a package to different copies. `false` registers bare specifiers only. Default `process.cwd()`.
   */
  resolveFrom?: string | false;
  /** Write `TZ` and `EXPO_OS` into `process.env`. Default `true`. */
  setProcessEnv?: boolean;
  /** Specifiers to leave unmocked (the real module loads). */
  skip?: readonly string[];
  /** Serve image, font, and media imports as Metro-style asset stubs. Default `true`. */
  stubAssets?: boolean;
}

/** Handle returned by `registerExpoTestEnvironment`. */
export interface ExpoTestEnvironment {
  /** The specifiers mocked, in registration order. */
  mockedModules: string[];
  /** Re-registers this environment's mock for `specifier`, undoing a suite's own `mock.module`. */
  restoreModuleMock: (specifier: string) => void;
}

/** File extensions served as `{uri, width, height}` stubs instead of being parsed as code. */
export const ASSET_FILE_PATTERN =
  /\.(png|jpe?g|gif|webp|bmp|svg|ttf|otf|woff2?|mp3|mp4|wav|m4a|mov)$/u;

interface ExpoTestGlobals {
  __DEV__?: boolean;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  expo?: unknown;
}

let isAssetPluginInstalled = false;

const installAssetPlugin = (): void => {
  if (isAssetPluginInstalled) {
    return;
  }
  isAssetPluginInstalled = true;
  // Metro turns asset imports into descriptors; Bun would try to parse the bytes as JavaScript.
  Bun.plugin({
    name: "terreno-expo-asset-stub",
    setup(build) {
      build.onLoad({filter: ASSET_FILE_PATTERN}, () => ({
        exports: {default: {height: 1, uri: "test-asset", width: 1}},
        loader: "object",
      }));
    },
  });
};

const installGlobals = (): void => {
  const globals = globalThis as typeof globalThis & ExpoTestGlobals;
  globals.__DEV__ = true;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  if (globals.expo !== undefined) {
    return;
  }
  // expo-modules-core reads `globalThis.expo` when it loads, before any native module call.
  globals.expo = createExpoGlobal();
};

const tryResolve = (specifier: string, fromDirectory: string): string | undefined => {
  try {
    return Bun.resolveSync(specifier, fromDirectory);
  } catch {
    return undefined;
  }
};

/** Every module the environment mocks by default, keyed by specifier. */
export const createDefaultExpoModuleMocks = ({
  nestedPackagePrefixes = [],
  platform = "ios",
  ...expoOptions
}: Pick<ExpoTestEnvironmentOptions, "nestedPackagePrefixes"> &
  ExpoModuleMockOptions = {}): ModuleMockMap => ({
  ...createReactNativeModuleMocks({packagePrefixes: ["", ...nestedPackagePrefixes], platform}),
  ...createExpoModuleMocks({...expoOptions, platform}),
  ...createLibraryModuleMocks(),
  ...createAuthTokenStorageModuleMocks(),
});

const resolveCleanup = (
  cleanup: ExpoTestEnvironmentOptions["cleanup"]
): Required<ExpoTestCleanupOptions> | undefined => {
  if (cleanup === false) {
    return undefined;
  }
  const options = cleanup === true || cleanup === undefined ? {} : cleanup;
  return {
    clearStorage: options.clearStorage ?? true,
    resetDevFlag: options.resetDevFlag ?? true,
    restoreMocks: options.restoreMocks ?? true,
    restoreModules: options.restoreModules ?? [],
  };
};

/**
 * Prepares Bun to run Expo / React Native component tests. Call it from a `bunfig.toml` preload
 * (or at the top of a test file, then `await import()` what the test renders) before anything
 * imports `react-native`:
 *
 * - mocks `react-native` and its Flow-only internals, the common `expo-*` modules,
 *   `expo-router`, `@expo/vector-icons`, and common native libraries (Reanimated, Gesture
 *   Handler, SVG, safe-area-context, NetInfo, SecureStore, AsyncStorage, ...);
 * - sets `__DEV__`, `IS_REACT_ACT_ENVIRONMENT`, `globalThis.expo`, `TZ`, and `EXPO_OS`;
 * - stubs image / font / media imports;
 * - installs an `afterEach` that restores spies, empties the in-memory storage, and resets
 *   `__DEV__`.
 *
 * `skip` leaves a module real; `overrides` replaces or adds a factory.
 */
export const registerExpoTestEnvironment = (
  options: ExpoTestEnvironmentOptions = {}
): ExpoTestEnvironment => {
  const {
    cleanup,
    fixedNow,
    overrides = {},
    platform = "ios",
    resolveFrom = process.cwd(),
    setProcessEnv = true,
    skip = [],
    stubAssets = true,
    timeZone = "America/New_York",
  } = options;

  const frozenAt = fixedNow ? DateTime.fromISO(fixedNow, {setZone: true}) : undefined;
  if (frozenAt && !frozenAt.isValid) {
    throw new Error(`registerExpoTestEnvironment: fixedNow "${fixedNow}" is not an ISO timestamp`);
  }

  if (setProcessEnv) {
    process.env.TZ = timeZone;
    process.env.EXPO_OS = platform;
  }
  installGlobals();
  if (stubAssets) {
    installAssetPlugin();
  }

  const skipped = new Set(skip);
  const defaults = createDefaultExpoModuleMocks({
    expoConfig: options.expoConfig,
    locale: options.locale,
    nestedPackagePrefixes: options.nestedPackagePrefixes,
    platform,
    scheme: options.scheme,
    timeZone,
  });
  const factories: ModuleMockMap = {...defaults, ...overrides};

  const register = (specifier: string, factory: ModuleFactory): void => {
    mock.module(specifier, factory);
    if (resolveFrom === false) {
      return;
    }
    const appPath = tryResolve(specifier, resolveFrom);
    if (appPath && appPath !== tryResolve(specifier, __dirname)) {
      mock.module(appPath, factory);
    }
  };

  const mockedModules: string[] = [];
  for (const [specifier, factory] of Object.entries(factories)) {
    if (skipped.has(specifier)) {
      continue;
    }
    register(specifier, factory);
    mockedModules.push(specifier);
  }

  const restoreModuleMock = (specifier: string): void => {
    const factory = factories[specifier];
    if (!factory || skipped.has(specifier)) {
      throw new Error(`registerExpoTestEnvironment does not mock "${specifier}"`);
    }
    register(specifier, factory);
  };

  if (frozenAt) {
    beforeEach(() => {
      setSystemTime(frozenAt.toJSDate());
    });
  }

  const cleanupSteps = resolveCleanup(cleanup);
  const isStorageMocked = !skipped.has("expo-secure-store") && !("expo-secure-store" in overrides);
  if (cleanupSteps || frozenAt) {
    afterEach(() => {
      if (frozenAt) {
        setSystemTime();
      }
      if (!cleanupSteps) {
        return;
      }
      if (cleanupSteps.restoreMocks) {
        mock.restore();
      }
      if (cleanupSteps.clearStorage && isStorageMocked) {
        clearAuthTokenStorage();
        resetAuthTokenStorageMocks();
      }
      if (cleanupSteps.resetDevFlag) {
        (globalThis as typeof globalThis & ExpoTestGlobals).__DEV__ = true;
      }
      for (const specifier of cleanupSteps.restoreModules) {
        restoreModuleMock(specifier);
      }
    });
  }

  return {mockedModules, restoreModuleMock};
};
