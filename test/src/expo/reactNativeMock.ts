import {mock} from "bun:test";
import {
  createElement,
  Fragment,
  forwardRef,
  type ReactElement,
  type ReactNode,
  useImperativeHandle,
} from "react";

import {
  type ExpoTestPlatform,
  hostComponent,
  type MockComponentProps,
  type ModuleExports,
  type ModuleMockMap,
  stub,
  stubIdentity,
  stubResolving,
  stubReturning,
  stubSubscription,
} from "./mockHelpers";

/** Window metrics every dimension API in the mock reports (an iPhone-sized portrait screen). */
const MOCK_WINDOW_METRICS = {fontScale: 1, height: 812, scale: 2, width: 375} as const;

/** Result passed to an `Animated` completion callback. */
interface AnimationResult {
  finished: boolean;
}

/** The `start`/`stop`/`reset` handle every `Animated` driver returns. */
export interface MockAnimation {
  reset: () => void;
  start: (callback?: (result: AnimationResult) => void) => void;
  stop: () => void;
}

interface MockFlatListProps extends MockComponentProps {
  data?: readonly unknown[] | null;
  keyExtractor?: (item: unknown, index: number) => string;
  renderItem?: (info: {
    index: number;
    item: unknown;
    separators: {highlight: () => void; unhighlight: () => void};
  }) => ReactNode;
}

interface MockSectionListProps extends MockComponentProps {
  keyExtractor?: (item: unknown, index: number) => string;
  renderItem?: (info: {index: number; item: unknown; section: unknown}) => ReactNode;
  renderSectionHeader?: (info: {section: unknown}) => ReactNode;
  sections?: readonly {data: readonly unknown[]; key?: string}[];
}

type ColorValue = string | number | null | undefined;

const SEPARATORS = {highlight: stub(), unhighlight: stub()};

const ABSOLUTE_FILL = {bottom: 0, left: 0, position: "absolute", right: 0, top: 0} as const;

/** Runs every child animation, then reports completion — matches `Animated.parallel` et al. */
const compositeAnimation = (animations?: readonly MockAnimation[]): MockAnimation => ({
  reset: stub(),
  start: mock((callback?: (result: AnimationResult) => void): void => {
    for (const animation of animations ?? []) {
      animation?.start?.();
    }
    callback?.({finished: true});
  }),
  stop: stub(),
});

/** A driver (`timing`, `spring`, ...) that completes as soon as it starts. */
const immediateAnimation = (): MockAnimation => compositeAnimation([]);

/** Mirrors `StyleSheet.flatten` for the plain objects and arrays tests pass. */
export const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  if (style && typeof style === "object") {
    return style as Record<string, unknown>;
  }
  return {};
};

/** Mirrors `processColor`: numbers pass through, strings become an opaque ARGB number. */
export const processColor = (color: ColorValue): number | null => {
  if (color === null || color === undefined) {
    return null;
  }
  if (typeof color === "number") {
    return color;
  }
  return 0xff000000;
};

class AnimatedValue {
  _value: number;
  constructor(value = 0) {
    this._value = value;
  }
  setValue = mock((value: number): void => {
    this._value = value;
  });
  setOffset = stub();
  flattenOffset = stub();
  extractOffset = stub();
  addListener = stubReturning("listener-id");
  removeListener = stub();
  removeAllListeners = stub();
  stopAnimation = mock((callback?: (value: number) => void): void => callback?.(this._value));
  resetAnimation = mock((callback?: (value: number) => void): void => callback?.(this._value));
  interpolate = mock((): AnimatedValue => new AnimatedValue(0));
  animate = stub();
  stopTracking = stub();
  track = stub();
}

class AnimatedValueXY {
  x: AnimatedValue;
  y: AnimatedValue;
  constructor(value?: {x?: number; y?: number}) {
    this.x = new AnimatedValue(value?.x ?? 0);
    this.y = new AnimatedValue(value?.y ?? 0);
  }
  setValue = stub();
  setOffset = stub();
  flattenOffset = stub();
  extractOffset = stub();
  stopAnimation = stub();
  resetAnimation = stub();
  addListener = stubReturning("listener-id");
  removeListener = stub();
  removeAllListeners = stub();
  getLayout = mock((): {left: AnimatedValue; top: AnimatedValue} => ({left: this.x, top: this.y}));
  getTranslateTransform = mock((): {translateX?: AnimatedValue; translateY?: AnimatedValue}[] => [
    {translateX: this.x},
    {translateY: this.y},
  ]);
}

const animatedNode = (): AnimatedValue => new AnimatedValue(0);

/**
 * Renders every `data` row through `renderItem`. Exposes the scroll methods tests usually
 * reach for through a ref (`scrollToOffset`, `scrollToIndex`, `scrollToEnd`).
 */
const FlatList = forwardRef<unknown, MockFlatListProps>((flatListProps, ref): ReactElement => {
  const {data, keyExtractor, renderItem, ...props} = flatListProps as MockFlatListProps;
  useImperativeHandle(ref, () => ({
    scrollTo: stub(),
    scrollToEnd: stub(),
    scrollToIndex: stub(),
    scrollToOffset: stub(),
  }));
  const rows = (data ?? []).map((item, index) =>
    createElement(
      Fragment,
      {key: keyExtractor?.(item, index) ?? String(index)},
      renderItem?.({index, item, separators: SEPARATORS})
    )
  );
  return createElement("FlatList", props, rows);
});

/** Renders each section header followed by its rows. */
const SectionList = ({
  keyExtractor,
  renderItem,
  renderSectionHeader,
  sections,
  ...props
}: MockSectionListProps): ReactElement => {
  const children = (sections ?? []).map((section, sectionIndex) =>
    createElement(
      Fragment,
      {key: section.key ?? String(sectionIndex)},
      renderSectionHeader?.({section}),
      section.data.map((item, index) =>
        createElement(
          Fragment,
          {key: keyExtractor?.(item, index) ?? String(index)},
          renderItem?.({index, item, section})
        )
      )
    )
  );
  return createElement("SectionList", props, children);
};

/**
 * Builds the `react-native` module stand-in: host-element components, no-op native APIs, and
 * `Platform.OS` set to `platform`. Bun cannot parse React Native's Flow sources, so every test
 * that renders React Native code needs this (or an equivalent) registered before the first import.
 */
export const createReactNativeMock = ({
  platform = "ios",
}: {
  platform?: ExpoTestPlatform;
} = {}): ModuleExports => {
  const View = hostComponent("View");
  const Text = hostComponent("Text");
  const Image = hostComponent("Image");
  const ScrollView = hostComponent("ScrollView");

  const Animated = {
    add: mock(animatedNode),
    createAnimatedComponent: stubIdentity(),
    decay: mock(immediateAnimation),
    delay: mock(immediateAnimation),
    diffClamp: mock(animatedNode),
    divide: mock(animatedNode),
    event: stubReturning(stub()),
    FlatList,
    Image,
    loop: mock((animation?: MockAnimation) => compositeAnimation(animation ? [animation] : [])),
    modulo: mock(animatedNode),
    multiply: mock(animatedNode),
    parallel: mock(compositeAnimation),
    ScrollView,
    sequence: mock(compositeAnimation),
    spring: mock(immediateAnimation),
    stagger: mock((_delay: number, animations?: readonly MockAnimation[]) =>
      compositeAnimation(animations)
    ),
    subtract: mock(animatedNode),
    Text,
    timing: mock(immediateAnimation),
    Value: AnimatedValue,
    ValueXY: AnimatedValueXY,
    View,
  };

  const Platform = {
    constants: {reactNativeVersion: {major: 0, minor: 0, patch: 0}},
    isPad: false,
    isTV: false,
    OS: platform,
    select: <T>(spec: Partial<Record<ExpoTestPlatform | "native" | "default", T>>): T | undefined =>
      spec[platform] ?? (platform === "web" ? undefined : spec.native) ?? spec.default,
    Version: platform === "android" ? 34 : "17.0",
  };

  const StyleSheet = {
    absoluteFill: ABSOLUTE_FILL,
    absoluteFillObject: ABSOLUTE_FILL,
    compose: (a: unknown, b: unknown): unknown => (a && b ? [a, b] : (a ?? b)),
    create: <T>(styles: T): T => styles,
    flatten: flattenStyle,
    hairlineWidth: 1,
  };

  const exports: ModuleExports = {
    AccessibilityInfo: {
      addEventListener: stubSubscription(),
      announceForAccessibility: stub(),
      isAccessibilityServiceEnabled: stubResolving(false),
      isBoldTextEnabled: stubResolving(false),
      isGrayscaleEnabled: stubResolving(false),
      isInvertColorsEnabled: stubResolving(false),
      isReduceMotionEnabled: stubResolving(false),
      isReduceTransparencyEnabled: stubResolving(false),
      isScreenReaderEnabled: stubResolving(false),
      setAccessibilityFocus: stub(),
    },
    ActivityIndicator: hostComponent("ActivityIndicator"),
    Alert: {alert: stub(), prompt: stub()},
    Animated,
    Appearance: {
      addChangeListener: stubSubscription(),
      getColorScheme: stubReturning("light"),
      setColorScheme: stub(),
    },
    AppRegistry: {
      getAppKeys: stubReturning([]),
      registerComponent: stub(),
      registerRunnable: stub(),
      runApplication: stub(),
    },
    AppState: {addEventListener: stubSubscription(), currentState: "active"},
    BackHandler: {addEventListener: stubSubscription(), exitApp: stub()},
    Button: hostComponent("Button"),
    DeviceEventEmitter: {
      addListener: stubSubscription(),
      emit: stub(),
      removeAllListeners: stub(),
    },
    Dimensions: {addEventListener: stubSubscription(), get: stubReturning(MOCK_WINDOW_METRICS)},
    DynamicColorIOS: (colors: {light: string}): string => colors.light,
    Easing: {
      back: stubReturning(stubIdentity()),
      bezier: stubReturning(stubIdentity()),
      bounce: stubIdentity(),
      circle: stubIdentity(),
      cubic: stubIdentity(),
      ease: stubIdentity(),
      elastic: stubReturning(stubIdentity()),
      exp: stubIdentity(),
      in: stubIdentity(),
      inOut: stubIdentity(),
      linear: stubIdentity(),
      out: stubIdentity(),
      poly: stubReturning(stubIdentity()),
      quad: stubIdentity(),
      sin: stubIdentity(),
    },
    FlatList,
    findNodeHandle: mock((node: unknown): number | null =>
      typeof node === "number" ? node : null
    ),
    I18nManager: {
      allowRTL: stub(),
      doLeftAndRightSwapInRTL: true,
      forceRTL: stub(),
      isRTL: false,
      swapLeftAndRightInRTL: stub(),
    },
    Image,
    ImageBackground: hostComponent("ImageBackground"),
    InteractionManager: {
      clearInteractionHandle: stub(),
      createInteractionHandle: stubReturning(1),
      runAfterInteractions: mock((task?: () => void) => {
        task?.();
        return {cancel: stub(), done: Promise.resolve()};
      }),
    },
    Keyboard: {
      addListener: stubSubscription(),
      dismiss: stub(),
      isVisible: stubReturning(false),
      metrics: stubReturning(undefined),
    },
    KeyboardAvoidingView: hostComponent("KeyboardAvoidingView"),
    LayoutAnimation: {
      configureNext: stub(),
      create: stubReturning({}),
      easeInEaseOut: stub(),
      linear: stub(),
      Presets: {},
      Properties: {},
      spring: stub(),
      Types: {},
    },
    Linking: {
      addEventListener: stubSubscription(),
      canOpenURL: stubResolving(true),
      getInitialURL: stubResolving(null),
      openSettings: stubResolving(undefined),
      openURL: stubResolving(undefined),
    },
    LogBox: {ignoreAllLogs: stub(), ignoreLogs: stub(), install: stub(), uninstall: stub()},
    Modal: hostComponent("Modal"),
    NativeEventEmitter: class NativeEventEmitter {
      addListener = stubSubscription();
      emit = stub();
      listenerCount = stubReturning(0);
      removeAllListeners = stub();
      removeSubscription = stub();
    },
    NativeModules: {},
    PanResponder: {
      create: mock(() => ({getInteractionHandle: stubReturning(null), panHandlers: {}})),
    },
    PixelRatio: {
      get: stubReturning(MOCK_WINDOW_METRICS.scale),
      getFontScale: stubReturning(MOCK_WINDOW_METRICS.fontScale),
      getPixelSizeForLayoutSize: mock((size: number): number => size * MOCK_WINDOW_METRICS.scale),
      roundToNearestPixel: stubIdentity(),
    },
    Platform,
    PlatformColor: (...names: string[]): string | undefined => names[0],
    Pressable: hostComponent("Pressable"),
    processColor,
    RefreshControl: hostComponent("RefreshControl"),
    requireNativeComponent: stubIdentity(),
    SafeAreaView: hostComponent("SafeAreaView"),
    ScrollView,
    SectionList,
    Share: {
      dismissedAction: "dismissedAction",
      share: stubResolving({action: "sharedAction"}),
      sharedAction: "sharedAction",
    },
    StatusBar: Object.assign(hostComponent("StatusBar"), {
      currentHeight: 0,
      setBackgroundColor: stub(),
      setBarStyle: stub(),
      setHidden: stub(),
      setNetworkActivityIndicatorVisible: stub(),
      setTranslucent: stub(),
    }),
    StyleSheet,
    Switch: hostComponent("Switch"),
    Text,
    TextInput: Object.assign(hostComponent("TextInput"), {
      State: {
        blurTextInput: stub(),
        currentlyFocusedInput: stubReturning(null),
        focusTextInput: stub(),
      },
    }),
    TouchableHighlight: hostComponent("TouchableHighlight"),
    TouchableNativeFeedback: hostComponent("TouchableNativeFeedback"),
    TouchableOpacity: hostComponent("TouchableOpacity"),
    TouchableWithoutFeedback: hostComponent("TouchableWithoutFeedback"),
    TurboModuleRegistry: {get: stubReturning(null), getEnforcing: stubReturning({})},
    UIManager: {
      getViewManagerConfig: stubReturning({}),
      measure: stub(),
      setLayoutAnimationEnabledExperimental: stub(),
    },
    useColorScheme: stubReturning("light"),
    useWindowDimensions: stubReturning(MOCK_WINDOW_METRICS),
    Vibration: {cancel: stub(), vibrate: stub()},
    View,
    VirtualizedList: FlatList,
  };
  return {...exports, default: exports};
};

/** `default` + named export module for a single value, as React Native's internal files expose. */
const defaultExport = (value: unknown): ModuleExports => ({__esModule: true, default: value});

/**
 * Stand-ins for React Native internals that libraries import by deep path. Each of these files
 * uses Flow syntax Bun cannot parse, so a library that reaches past the `react-native` entry
 * point needs the matching stub. Keys are relative to the `react-native` package.
 */
export const createReactNativeInternalMocks = (
  reactNative: ModuleExports
): Record<string, () => ModuleExports> => {
  const pick = (name: string): unknown => reactNative[name];
  return {
    "Libraries/Animated/NativeAnimatedHelper": () => ({
      default: {},
      shouldUseNativeDriver: stubReturning(false),
    }),
    "Libraries/Components/View/View": () => defaultExport(pick("View")),
    "Libraries/Core/Devtools/parseErrorStack": () => defaultExport(stubReturning([])),
    "Libraries/EventEmitter/NativeEventEmitter": () => defaultExport(pick("NativeEventEmitter")),
    "Libraries/Image/AssetSourceResolver": () =>
      defaultExport(
        class AssetSourceResolver {
          defaultAsset = stubReturning({height: 0, scale: 1, uri: "", width: 0});
          fromSource = stubReturning({height: 0, scale: 1, uri: "", width: 0});
        }
      ),
    "Libraries/Image/resolveAssetSource": () =>
      defaultExport(
        mock((source: {height?: number; uri?: string; width?: number} | null | undefined) =>
          source
            ? {
                height: source.height ?? 0,
                scale: 1,
                uri: source.uri ?? "",
                width: source.width ?? 0,
              }
            : null
        )
      ),
    "Libraries/NativeComponent/NativeComponentRegistry": () => ({
      get: stubReturning("View"),
      getWithFallback_DEPRECATED: stubReturning("View"),
      setRuntimeConfigProvider: stub(),
    }),
    "Libraries/NativeComponent/ViewConfigIgnore": () => ({
      ConditionallyIgnoredEventHandlers: stubIdentity(),
      DynamicallyInjectedByGestureHandler: stubIdentity(),
      isIgnored: stubReturning(false),
    }),
    "Libraries/Pressability/PressabilityDebug": () => ({
      isEnabled: stubReturning(false),
      PressabilityDebugView: stubReturning(null),
    }),
    "Libraries/Renderer/shims/ReactNative": () => ({
      default: {},
      findNodeHandle: pick("findNodeHandle"),
    }),
    "Libraries/Renderer/shims/ReactNativeTypes": () => ({}),
    "Libraries/Renderer/shims/ReactNativeViewConfigRegistry": () => ({
      customBubblingEventTypes: {},
      customDirectEventTypes: {},
      get: stubReturning({}),
      register: stub(),
    }),
    "Libraries/StyleSheet/normalizeColor": () => defaultExport(processColor),
    "Libraries/StyleSheet/PlatformColorValueTypes": () => ({
      DynamicColorIOS: pick("DynamicColorIOS"),
      normalizeColorObject: stubIdentity(),
      PlatformColor: pick("PlatformColor"),
      processColorObject: stubIdentity(),
    }),
    "Libraries/StyleSheet/processColor": () => defaultExport(processColor),
    "Libraries/StyleSheet/StyleSheet": () => ({
      ...(pick("StyleSheet") as ModuleExports),
      default: pick("StyleSheet"),
    }),
    "Libraries/TurboModule/TurboModuleRegistry": () => pick("TurboModuleRegistry") as ModuleExports,
    "Libraries/Utilities/codegenNativeCommands": () => defaultExport(stubReturning({})),
    "Libraries/Utilities/codegenNativeComponent": () => defaultExport(stubIdentity()),
    "Libraries/Utilities/Platform": () => ({
      ...(pick("Platform") as ModuleExports),
      default: pick("Platform"),
    }),
    "Libraries/vendor/core/ErrorUtils": () =>
      defaultExport({getGlobalHandler: stubReturning(stub()), setGlobalHandler: stub()}),
  };
};

/**
 * Registers `react-native` and its Flow-only internals under every given package prefix.
 * Pass `"@scope/pkg/node_modules/"` for a nested copy a dependency resolves on its own.
 */
export const createReactNativeModuleMocks = ({
  platform = "ios",
  packagePrefixes = [""],
}: {
  packagePrefixes?: readonly string[];
  platform?: ExpoTestPlatform;
} = {}): ModuleMockMap => {
  const reactNative = createReactNativeMock({platform});
  const internals = createReactNativeInternalMocks(reactNative);
  const mocks: ModuleMockMap = {};
  for (const prefix of packagePrefixes) {
    mocks[`${prefix}react-native`] = (): ModuleExports => reactNative;
    for (const [path, factory] of Object.entries(internals)) {
      mocks[`${prefix}react-native/${path}`] = factory;
    }
  }
  return mocks;
};
