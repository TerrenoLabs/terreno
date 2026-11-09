import {mock} from "bun:test";
import {DateTime} from "luxon";

import {
  type ExpoTestPlatform,
  hostComponent,
  type MockComponent,
  type ModuleExports,
  type ModuleMockMap,
  passthroughComponent,
  stub,
  stubResolving,
  stubReturning,
  stubSubscription,
} from "./mockHelpers";

/** Options for the generated Expo module stand-ins. */
export interface ExpoModuleMockOptions {
  /** `expo-constants` `expoConfig` (an app.json `expo` block). Default `{extra: {}, name: "test", slug: "test"}`. */
  expoConfig?: Record<string, unknown>;
  /** Locale reported by `expo-localization`. Default `"en-US"`. */
  locale?: string;
  /** Platform reported through `expo-modules-core` and `expo-device`. Default `"ios"`. */
  platform?: ExpoTestPlatform;
  /** Deep-link scheme `expo-linking.createURL` builds on. Default `expoConfig.scheme` or `"exp"`. */
  scheme?: string;
  /** IANA zone `expo-localization` reports. Default `"America/New_York"`. */
  timeZone?: string;
}

/** Icon families mocked under `@expo/vector-icons` and `@expo/vector-icons/<Family>`. */
export const VECTOR_ICON_FAMILIES = [
  "AntDesign",
  "Entypo",
  "EvilIcons",
  "Feather",
  "FontAwesome",
  "FontAwesome5",
  "FontAwesome6",
  "Fontisto",
  "Foundation",
  "Ionicons",
  "MaterialCommunityIcons",
  "MaterialIcons",
  "Octicons",
  "SimpleLineIcons",
  "Zocial",
] as const;

const PERMISSION_STATUS = {
  DENIED: "denied",
  GRANTED: "granted",
  UNDETERMINED: "undetermined",
} as const;

const GRANTED_PERMISSION = {canAskAgain: true, expires: "never", granted: true, status: "granted"};

/** Event emitter stand-in for `expo-modules-core`'s `EventEmitter` and the classes built on it. */
class MockEventEmitter {
  addListener: ReturnType<typeof stubSubscription>;
  emit: ReturnType<typeof stub>;
  listenerCount: ReturnType<typeof stubReturning<number>>;
  removeAllListeners: ReturnType<typeof stub>;
  removeListener: ReturnType<typeof stub>;
  removeSubscription: ReturnType<typeof stub>;

  constructor() {
    this.addListener = stubSubscription();
    this.emit = stub();
    this.listenerCount = stubReturning(0);
    this.removeAllListeners = stub();
    this.removeListener = stub();
    this.removeSubscription = stub();
  }
}

class MockNativeModule extends MockEventEmitter {}

class MockSharedObject extends MockEventEmitter {}

class MockSharedRef extends MockSharedObject {}

/** The `globalThis.expo` object `expo-modules-core` reads when it loads. */
export const createExpoGlobal = (): Record<string, unknown> => ({
  EventEmitter: MockEventEmitter,
  modules: {},
  NativeModule: MockNativeModule,
  SharedObject: MockSharedObject,
  SharedRef: MockSharedRef,
});

class CodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class UnavailabilityError extends CodedError {
  constructor(moduleName: string, propertyName: string) {
    super("ERR_UNAVAILABLE", `${moduleName}.${propertyName} is not available in tests`);
  }
}

/** A `createPermissionHook` stand-in: the hook reports a granted permission. */
const createPermissionHook = mock(() =>
  mock(() => [
    GRANTED_PERMISSION,
    stubResolving(GRANTED_PERMISSION),
    stubResolving(GRANTED_PERMISSION),
  ])
);

/** Exports `expo` and `expo-modules-core` share: native module loaders return empty objects. */
const createNativeModuleCore = (platform: ExpoTestPlatform): ModuleExports => ({
  CodedError,
  createPermissionHook,
  EventEmitter: MockEventEmitter,
  LegacyEventEmitter: MockEventEmitter,
  NativeModule: MockNativeModule,
  NativeModulesProxy: {},
  PermissionStatus: PERMISSION_STATUS,
  Platform: {
    OS: platform,
    select: <T>(spec: Partial<Record<string, T>>): T | undefined => spec[platform] ?? spec.default,
  },
  registerWebModule: mock(<T>(moduleClass: T): T => moduleClass),
  reloadAppAsync: stubResolving(undefined),
  requireNativeModule: stubReturning({}),
  requireNativeViewManager: stubReturning(hostComponent("NativeView")),
  requireOptionalNativeModule: stubReturning(null),
  SharedObject: MockSharedObject,
  SharedRef: MockSharedRef,
  UnavailabilityError,
  useReleasingSharedObject: mock(<T>(factory: () => T): T => factory()),
  uuid: {v4: stubReturning("00000000-0000-4000-8000-000000000000")},
});

const createRouterMock = (): ModuleExports => {
  const createRouterHandle = (): Record<string, unknown> => ({
    back: stub(),
    canDismiss: stubReturning(false),
    canGoBack: stubReturning(true),
    dismiss: stub(),
    dismissAll: stub(),
    dismissTo: stub(),
    navigate: stub(),
    prefetch: stub(),
    push: stub(),
    replace: stub(),
    setParams: stub(),
  });
  const navigatorWithScreen = (name: string): MockComponent =>
    Object.assign(hostComponent(name), {Screen: hostComponent(`${name}.Screen`)});
  const Navigator = Object.assign(hostComponent("Navigator"), {
    Slot: hostComponent("Slot"),
    useContext: stubReturning({
      descriptors: {},
      navigation: {},
      router: {},
      state: {index: 0, routes: []},
    }),
  });
  const navigationFonts = {
    bold: {fontFamily: "System", fontWeight: "600"},
    heavy: {fontFamily: "System", fontWeight: "700"},
    medium: {fontFamily: "System", fontWeight: "500"},
    regular: {fontFamily: "System", fontWeight: "400"},
  };
  return {
    DarkTheme: {
      colors: {
        background: "#010101",
        border: "#272729",
        card: "#121212",
        notification: "#ff453a",
        primary: "#0a84ff",
        text: "#e5e5e7",
      },
      dark: true,
      fonts: navigationFonts,
    },
    DefaultTheme: {
      colors: {
        background: "#f2f2f2",
        border: "#d8d8d8",
        card: "#ffffff",
        notification: "#ff3b30",
        primary: "#007aff",
        text: "#1c1c1e",
      },
      dark: false,
      fonts: navigationFonts,
    },
    Link: hostComponent("Link"),
    Navigator,
    Redirect: hostComponent("Redirect"),
    router: createRouterHandle(),
    Slot: hostComponent("Slot"),
    Stack: navigatorWithScreen("Stack"),
    Tabs: navigatorWithScreen("Tabs"),
    ThemeProvider: passthroughComponent,
    useFocusEffect: mock((effect?: () => unknown): void => {
      effect?.();
    }),
    useGlobalSearchParams: stubReturning({}),
    useLocalSearchParams: stubReturning({}),
    useNavigation: mock(() => ({
      addListener: stubReturning(stub()),
      canGoBack: stubReturning(true),
      dispatch: stub(),
      getParent: stubReturning(undefined),
      goBack: stub(),
      isFocused: stubReturning(true),
      navigate: stub(),
      setOptions: stub(),
    })),
    useNavigationContainerRef: stubReturning({current: null}),
    usePathname: stubReturning("/"),
    useRootNavigationState: stubReturning({key: "root"}),
    useRouter: mock(createRouterHandle),
    useSearchParams: stubReturning({}),
    useSegments: stubReturning([]),
  };
};

const createVectorIconsMocks = (): ModuleMockMap => {
  const mocks: ModuleMockMap = {};
  const root: ModuleExports = {};
  for (const family of VECTOR_ICON_FAMILIES) {
    const Icon = Object.assign(hostComponent(family), {
      getImageSource: stubResolving(null),
      glyphMap: {},
      loadFont: stubResolving(undefined),
    });
    root[family] = Icon;
    mocks[`@expo/vector-icons/${family}`] = (): ModuleExports => ({default: Icon});
  }
  mocks["@expo/vector-icons"] = (): ModuleExports => ({
    ...root,
    createIconSet: stubReturning(hostComponent("Icon")),
  });
  return mocks;
};

/**
 * Builds stand-ins for the Expo SDK modules most apps import: the `expo` / `expo-modules-core`
 * native bridge, `expo-router`, `expo-constants`, `expo-linking`, `expo-font`, and the common
 * device APIs. `expo-secure-store` lives in `authTokenStorage.ts`.
 */
export const createExpoModuleMocks = ({
  expoConfig = {extra: {}, name: "test", slug: "test"},
  locale = "en-US",
  platform = "ios",
  scheme,
  timeZone = "America/New_York",
}: ExpoModuleMockOptions = {}): ModuleMockMap => {
  const linkingScheme =
    scheme ?? (typeof expoConfig.scheme === "string" ? expoConfig.scheme : "exp");
  const [languageCode = "en", regionCode = "US"] = locale.split("-");
  const core = createNativeModuleCore(platform);
  const noopModule = (): ModuleExports => ({});

  return {
    ...createVectorIconsMocks(),
    expo: () => ({
      ...core,
      isRunningInExpoGo: stubReturning(false),
      registerRootComponent: stub(),
      useEvent: stubReturning(undefined),
      useEventListener: stub(),
    }),
    "expo-application": () => ({
      applicationId: "com.terreno.test",
      applicationName: "test",
      getInstallationTimeAsync: stubResolving(DateTime.fromMillis(0).toJSDate()),
      nativeApplicationVersion: "1.0.0",
      nativeBuildVersion: "1",
    }),
    "expo-asset": () => ({
      Asset: {
        fromModule: stubReturning({
          downloadAsync: stubResolving(undefined),
          localUri: "test-asset",
          uri: "test-asset",
        }),
        loadAsync: stubResolving([]),
      },
      useAssets: stubReturning([[], undefined]),
    }),
    "expo-clipboard": () => ({
      getStringAsync: stubResolving(""),
      hasStringAsync: stubResolving(false),
      setImageAsync: stubResolving(undefined),
      setString: stub(),
      setStringAsync: stubResolving(true),
    }),
    "expo-constants": () => {
      const constants = {
        appOwnership: null,
        executionEnvironment: "bare",
        expoConfig,
        manifest: expoConfig,
        platform: {[platform]: {}},
        sessionId: "test-session",
        statusBarHeight: 0,
      };
      return {
        AppOwnership: {Expo: "expo"},
        default: constants,
        ExecutionEnvironment: {Bare: "bare", Standalone: "standalone", StoreClient: "storeClient"},
        UserInterfaceIdiom: {
          Desktop: "desktop",
          Handset: "handset",
          Tablet: "tablet",
          TV: "tv",
          Unsupported: "unsupported",
        },
      };
    },
    "expo-device": () => ({
      brand: "Test",
      DeviceType: {DESKTOP: 3, PHONE: 1, TABLET: 2, TV: 4, UNKNOWN: 0},
      deviceType: 1,
      getDeviceTypeAsync: stubResolving(1),
      isDevice: false,
      manufacturer: "Test",
      modelName: "Test Device",
      osName: platform === "android" ? "Android" : platform === "web" ? "Web" : "iOS",
      osVersion: "1.0",
    }),
    "expo-file-system": () => ({
      cacheDirectory: "file:///cache/",
      deleteAsync: stubResolving(undefined),
      documentDirectory: "file:///documents/",
      File: class File {
        bytes = stubResolving(new Uint8Array());
        exists = false;
        text = stubResolving("");
        uri: string;
        constructor(...parts: unknown[]) {
          this.uri = parts.map(String).join("/");
        }
      },
      getInfoAsync: stubResolving({exists: false, isDirectory: false}),
      readAsStringAsync: stubResolving(""),
      writeAsStringAsync: stubResolving(undefined),
    }),
    "expo-font": () => ({
      isLoaded: stubReturning(true),
      isLoading: stubReturning(false),
      loadAsync: stubResolving(undefined),
      useFonts: stubReturning([true, null]),
    }),
    "expo-haptics": () => ({
      ImpactFeedbackStyle: {
        Heavy: "heavy",
        Light: "light",
        Medium: "medium",
        Rigid: "rigid",
        Soft: "soft",
      },
      impactAsync: stubResolving(undefined),
      NotificationFeedbackType: {Error: "error", Success: "success", Warning: "warning"},
      notificationAsync: stubResolving(undefined),
      selectionAsync: stubResolving(undefined),
    }),
    "expo-image-manipulator": () => ({
      ImageManipulator: {
        manipulate: stubReturning({
          renderAsync: stubResolving({saveAsync: stubResolving({height: 0, uri: "", width: 0})}),
        }),
      },
      manipulateAsync: stubResolving({height: 0, uri: "", width: 0}),
      SaveFormat: {JPEG: "jpeg", PNG: "png", WEBP: "webp"},
    }),
    "expo-image-picker": () => ({
      launchCameraAsync: stubResolving({assets: null, canceled: true}),
      launchImageLibraryAsync: stubResolving({assets: null, canceled: true}),
      MediaTypeOptions: {All: "All", Images: "Images", Videos: "Videos"},
      PermissionStatus: PERMISSION_STATUS,
      requestCameraPermissionsAsync: stubResolving(GRANTED_PERMISSION),
      requestMediaLibraryPermissionsAsync: stubResolving(GRANTED_PERMISSION),
      useCameraPermissions: createPermissionHook(),
      useMediaLibraryPermissions: createPermissionHook(),
    }),
    "expo-linear-gradient": () => ({LinearGradient: hostComponent("LinearGradient")}),
    "expo-linking": () => {
      const createURL = mock(
        (path = "", options?: {queryParams?: Record<string, string>}): string => {
          const query = new URLSearchParams(options?.queryParams ?? {}).toString();
          return `${linkingScheme}://${path.replace(/^\//u, "")}${query ? `?${query}` : ""}`;
        }
      );
      return {
        addEventListener: stubSubscription(),
        canOpenURL: stubResolving(true),
        createURL,
        getInitialURL: stubResolving(null),
        getLinkingURL: stubReturning(null),
        openSettings: stubResolving(undefined),
        openURL: stubResolving(true),
        parse: mock((url: string) => ({
          hostname: null,
          path: url,
          queryParams: {},
          scheme: linkingScheme,
        })),
        parseInitialURLAsync: stubResolving({
          hostname: null,
          path: null,
          queryParams: {},
          scheme: null,
        }),
        resolveScheme: stubReturning(linkingScheme),
        useLinkingURL: stubReturning(null),
        useURL: stubReturning(null),
      };
    },
    "expo-localization": () => ({
      getCalendars: stubReturning([
        {calendar: "gregorian", firstWeekday: 1, timeZone, uses24hourClock: false},
      ]),
      getLocales: stubReturning([
        {
          currencyCode: "USD",
          decimalSeparator: ".",
          digitGroupingSeparator: ",",
          languageCode,
          languageTag: locale,
          measurementSystem: "us",
          regionCode,
          temperatureUnit: "fahrenheit",
          textDirection: "ltr",
        },
      ]),
      locale,
      locales: [locale],
      timezone: timeZone,
      useCalendars: stubReturning([
        {calendar: "gregorian", firstWeekday: 1, timeZone, uses24hourClock: false},
      ]),
      useLocales: stubReturning([{languageCode, languageTag: locale, regionCode}]),
    }),
    "expo-modules-core": () => core,
    "expo-modules-core/src/Refs": () => ({createRef: stubReturning({current: null})}),
    "expo-modules-core/src/uuid/uuid.web": () => ({
      uuid4: stubReturning("00000000-0000-4000-8000-000000000000"),
    }),
    "expo-modules-core/src/web/index.web": () => ({EventEmitter: MockEventEmitter}),
    "expo-network": () => ({
      addNetworkStateListener: stubSubscription(),
      getNetworkStateAsync: stubResolving({
        isConnected: true,
        isInternetReachable: true,
        type: "WIFI",
      }),
      NetworkStateType: {CELLULAR: "CELLULAR", NONE: "NONE", UNKNOWN: "UNKNOWN", WIFI: "WIFI"},
      useNetworkState: stubReturning({isConnected: true, isInternetReachable: true, type: "WIFI"}),
    }),
    "expo-router": createRouterMock,
    "expo-splash-screen": () => ({
      hide: stub(),
      hideAsync: stubResolving(true),
      preventAutoHideAsync: stubResolving(true),
      setOptions: stub(),
    }),
    "expo-status-bar": () => ({
      StatusBar: hostComponent("ExpoStatusBar"),
      setStatusBarStyle: stub(),
    }),
    "expo-updates": () => ({
      channel: "test",
      checkForUpdateAsync: stubResolving({isAvailable: false}),
      fetchUpdateAsync: stubResolving({isNew: false}),
      isEnabled: false,
      reloadAsync: stubResolving(undefined),
      updateId: null,
      useUpdates: stubReturning({isUpdateAvailable: false, isUpdatePending: false}),
    }),
    "expo-web-browser": () => ({
      dismissBrowser: stub(),
      maybeCompleteAuthSession: stubReturning({type: "failed"}),
      openAuthSessionAsync: stubResolving({type: "cancel"}),
      openBrowserAsync: stubResolving({type: "opened"}),
      WebBrowserResultType: {
        CANCEL: "cancel",
        DISMISS: "dismiss",
        LOCKED: "locked",
        OPENED: "opened",
      },
    }),
    "expo/src/async-require/hmr": () => ({
      default: {disable: stub(), enable: stub(), log: stub(), setup: stub()},
    }),
    "expo/src/async-require/messageSocket": noopModule,
    "expo/src/async-require/setupHMR": noopModule,
    // Expo's dev-only HMR client touches `window`/`document` when it loads.
    "expo/src/Expo.fx": noopModule,
    "expo/src/Expo.fx.tsx": noopModule,
  };
};
