import {mock} from "bun:test";
import {
  createContext,
  createElement,
  forwardRef,
  type ReactElement,
  type ReactNode,
  useImperativeHandle,
  useState,
} from "react";

import {
  hostComponent,
  hostComponents,
  type MockComponentProps,
  type ModuleExports,
  type ModuleMockMap,
  passthroughComponent,
  stub,
  stubIdentity,
  stubResolving,
  stubReturning,
} from "./mockHelpers";

/** Safe-area insets every safe-area hook and context reports. */
const MOCK_SAFE_AREA_INSETS = {bottom: 0, left: 0, right: 0, top: 0} as const;

/** Safe-area frame every safe-area hook and context reports. */
const MOCK_SAFE_AREA_FRAME = {height: 812, width: 375, x: 0, y: 0} as const;

/** Network state `@react-native-community/netinfo` reports: online over Wi-Fi. */
export const MOCK_NET_INFO_STATE = {
  details: {},
  isConnected: true,
  isInternetReachable: true,
  isWifiEnabled: true,
  type: "wifi",
} as const;

/** A shared value: `.value` plus the `get`/`set`/`modify` API Reanimated 3+ exposes. */
interface MockSharedValue<T> {
  get: () => T;
  modify: (modifier: (value: T) => T) => T;
  set: (value: T) => void;
  value: T;
}

/** Gesture builder whose every configuration method returns the gesture itself. */
type ChainableGesture = Record<string, (...args: unknown[]) => ChainableGesture>;

const GESTURE_METHODS = [
  "activeOffsetX",
  "activeOffsetY",
  "averageTouches",
  "blocksExternalGesture",
  "cancelsTouchesInView",
  "direction",
  "enabled",
  "failOffsetX",
  "failOffsetY",
  "hitSlop",
  "manualActivation",
  "maxDelay",
  "maxDist",
  "maxDuration",
  "maxPointers",
  "minDistance",
  "minDuration",
  "minPointers",
  "minVelocity",
  "minVelocityX",
  "minVelocityY",
  "numberOfPointers",
  "numberOfTaps",
  "onBegin",
  "onChange",
  "onEnd",
  "onFinalize",
  "onStart",
  "onTouchesCancelled",
  "onTouchesDown",
  "onTouchesMove",
  "onTouchesUp",
  "onUpdate",
  "requireExternalGestureToFail",
  "runOnJS",
  "shouldCancelWhenOutside",
  "simultaneousWithExternalGesture",
  "withRef",
  "withTestId",
];

const createChainableGesture = (): ChainableGesture => {
  const gesture: ChainableGesture = {};
  for (const method of GESTURE_METHODS) {
    gesture[method] = mock((): ChainableGesture => gesture);
  }
  return gesture;
};

const createSharedValue = <T>(initialValue: T): MockSharedValue<T> => {
  const shared: MockSharedValue<T> = {
    get: (): T => shared.value,
    modify: (modifier: (value: T) => T): T => {
      shared.value = modifier(shared.value);
      return shared.value;
    },
    set: (value: T): void => {
      shared.value = value;
    },
    value: initialValue,
  };
  return shared;
};

/** Linear interpolation clamped to the first/last range entries, like Reanimated's default. */
export const interpolate = (
  value: number,
  inputRange: readonly number[],
  outputRange: readonly number[]
): number => {
  const inMin = inputRange[0] ?? 0;
  const inMax = inputRange[inputRange.length - 1] ?? inMin;
  const outMin = outputRange[0] ?? 0;
  const outMax = outputRange[outputRange.length - 1] ?? outMin;
  if (inMax === inMin) {
    return outMin;
  }
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
};

const createReanimatedMock = (): ModuleExports => {
  const Animated = {
    createAnimatedComponent: stubIdentity(),
    FlatList: hostComponent("FlatList"),
    Image: hostComponent("Image"),
    ScrollView: hostComponent("ScrollView"),
    Text: hostComponent("Text"),
    View: hostComponent("View"),
  };
  const layoutAnimation = (): Record<string, unknown> => {
    const animation: Record<string, unknown> = {};
    for (const method of ["delay", "duration", "easing", "springify", "damping", "withCallback"]) {
      animation[method] = mock(() => animation);
    }
    return animation;
  };
  return {
    ...Animated,
    cancelAnimation: stub(),
    default: Animated,
    Easing: {
      bezier: stubReturning(stubIdentity()),
      cubic: stubIdentity(),
      ease: stubIdentity(),
      in: stubIdentity(),
      inOut: stubIdentity(),
      linear: stubIdentity(),
      out: stubIdentity(),
      quad: stubIdentity(),
    },
    Extrapolation: {CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity"},
    FadeIn: layoutAnimation(),
    FadeOut: layoutAnimation(),
    interpolate: mock(interpolate),
    interpolateColor: mock(
      (_value: number, _input: readonly number[], output: readonly string[]) => output[0]
    ),
    Layout: layoutAnimation(),
    LinearTransition: layoutAnimation(),
    makeMutable: mock(createSharedValue),
    ReduceMotion: {Always: "always", Never: "never", System: "system"},
    runOnJS: stubIdentity(),
    runOnUI: stubIdentity(),
    SlideInDown: layoutAnimation(),
    SlideOutDown: layoutAnimation(),
    useAnimatedGestureHandler: stubReturning({}),
    useAnimatedProps: mock((updater: () => unknown) => updater()),
    useAnimatedReaction: stub(),
    useAnimatedRef: stubReturning({current: null}),
    useAnimatedScrollHandler: stubReturning(stub()),
    useAnimatedStyle: mock((updater: () => unknown) => updater()),
    useDerivedValue: mock((updater: () => unknown) => createSharedValue(updater())),
    useReducedMotion: stubReturning(false),
    useSharedValue: mock(createSharedValue),
    withDecay: stubIdentity(),
    withDelay: mock(<T>(_delay: number, value: T): T => value),
    withRepeat: stubIdentity(),
    withSequence: mock((...values: unknown[]): unknown => values[0]),
    withSpring: stubIdentity(),
    withTiming: stubIdentity(),
    ZoomIn: layoutAnimation(),
    ZoomOut: layoutAnimation(),
  };
};

const createGestureHandlerMock = (): ModuleExports => {
  const gesture = mock(createChainableGesture);
  return {
    ...hostComponents([
      "BaseButton",
      "BorderlessButton",
      "DrawerLayout",
      "FlatList",
      "GestureDetector",
      "LongPressGestureHandler",
      "PanGestureHandler",
      "PinchGestureHandler",
      "RectButton",
      "ScrollView",
      "Swipeable",
      "TapGestureHandler",
      "TouchableHighlight",
      "TouchableOpacity",
      "TouchableWithoutFeedback",
    ]),
    createNativeWrapper: stubIdentity(),
    Directions: {DOWN: 8, LEFT: 2, RIGHT: 1, UP: 4},
    Gesture: {
      Exclusive: gesture,
      Fling: gesture,
      Hover: gesture,
      LongPress: gesture,
      Manual: gesture,
      Native: gesture,
      Pan: gesture,
      Pinch: gesture,
      Race: gesture,
      Rotation: gesture,
      Simultaneous: gesture,
      Tap: gesture,
    },
    GestureHandlerRootView: hostComponent("GestureHandlerRootView"),
    gestureHandlerRootHOC: stubIdentity(),
    State: {ACTIVE: 4, BEGAN: 2, CANCELLED: 3, END: 5, FAILED: 1, UNDETERMINED: 0},
  };
};

const SVG_ELEMENTS = [
  "Circle",
  "ClipPath",
  "Defs",
  "Ellipse",
  "ForeignObject",
  "G",
  "Line",
  "LinearGradient",
  "Marker",
  "Mask",
  "Path",
  "Pattern",
  "Polygon",
  "Polyline",
  "RadialGradient",
  "Rect",
  "Stop",
  "Svg",
  "Symbol",
  "TextPath",
  "TSpan",
  "Use",
];

const createSvgMock = (): ModuleExports => {
  const elements = hostComponents(SVG_ELEMENTS);
  return {
    ...elements,
    default: elements.Svg,
    Image: hostComponent("SvgImage"),
    SvgXml: hostComponent("SvgXml"),
    Text: hostComponent("SvgText"),
  };
};

const createSafeAreaMock = (): ModuleExports => {
  const metrics = {frame: MOCK_SAFE_AREA_FRAME, insets: MOCK_SAFE_AREA_INSETS};
  const SafeAreaInsetsContext = createContext<typeof MOCK_SAFE_AREA_INSETS>(MOCK_SAFE_AREA_INSETS);
  const SafeAreaFrameContext = createContext<typeof MOCK_SAFE_AREA_FRAME>(MOCK_SAFE_AREA_FRAME);
  return {
    initialWindowMetrics: metrics,
    initialWindowSafeAreaInsets: MOCK_SAFE_AREA_INSETS,
    SafeAreaFrameContext,
    SafeAreaInsetsContext,
    SafeAreaProvider: passthroughComponent,
    SafeAreaView: hostComponent("SafeAreaView"),
    useSafeAreaFrame: stubReturning(MOCK_SAFE_AREA_FRAME),
    useSafeAreaInsets: stubReturning(MOCK_SAFE_AREA_INSETS),
    withSafeAreaInsets: stubIdentity(),
  };
};

const createNetInfoMock = (): ModuleExports => {
  const netInfo = {
    addEventListener: mock((listener?: (state: typeof MOCK_NET_INFO_STATE) => void) => {
      listener?.(MOCK_NET_INFO_STATE);
      return stub();
    }),
    configure: stub(),
    fetch: stubResolving(MOCK_NET_INFO_STATE),
    refresh: stubResolving(MOCK_NET_INFO_STATE),
    useNetInfo: stubReturning(MOCK_NET_INFO_STATE),
  };
  return {
    ...netInfo,
    default: netInfo,
    NetInfoStateType: {cellular: "cellular", none: "none", unknown: "unknown", wifi: "wifi"},
  };
};

/**
 * `react-native-actions-sheet` renders nothing until a native animation opens it. This stand-in
 * tracks the imperative `show` / `hide` / `setModalVisible` calls instead, so opened content is
 * assertable and closed content is absent.
 */
const ActionSheet = forwardRef<unknown, {children?: ReactNode}>(
  ({children}, ref): ReactElement | null => {
    const [isVisible, setIsVisible] = useState(false);
    useImperativeHandle(ref, () => ({
      hide: (): void => setIsVisible(false),
      setModalVisible: (visible?: boolean): void => setIsVisible(Boolean(visible)),
      show: (): void => setIsVisible(true),
    }));
    if (!isVisible) {
      return null;
    }
    return createElement("ActionSheet", null, children);
  }
);

const createPresstoMock = (): ModuleExports => {
  const pressable =
    (name: string) =>
    ({
      enabled = true,
      onPress,
      ...props
    }: MockComponentProps & {enabled?: boolean; onPress?: unknown}): ReactElement =>
      createElement(
        name,
        {...props, disabled: !enabled, onPress: enabled ? onPress : undefined},
        props.children
      );
  return {
    PressableOpacity: pressable("PressableOpacity"),
    PressableScale: pressable("PressableScale"),
    PressableWithoutFeedback: pressable("PressableWithoutFeedback"),
  };
};

/**
 * Builds stand-ins for the native libraries most Expo apps depend on: Reanimated, Gesture
 * Handler, SVG, safe-area-context, NetInfo, WebView, the community picker / slider /
 * date-time picker, react-native-actions-sheet, pressto, and Sentry.
 */
export const createLibraryModuleMocks = (): ModuleMockMap => {
  const safeArea = createSafeAreaMock();
  const Picker = Object.assign(hostComponent("Picker"), {Item: hostComponent("Picker.Item")});
  const sentry = (): ModuleExports => ({
    addBreadcrumb: stub(),
    captureEvent: stubReturning("test-event-id"),
    captureException: stubReturning("test-event-id"),
    captureMessage: stubReturning("test-event-id"),
    ErrorBoundary: passthroughComponent,
    flush: stubResolving(true),
    init: stub(),
    reactNavigationIntegration: stubReturning({name: "ReactNavigation"}),
    setContext: stub(),
    setTag: stub(),
    setUser: stub(),
    withScope: mock((callback: (scope: Record<string, unknown>) => void) =>
      callback({setContext: stub(), setExtra: stub(), setLevel: stub(), setTag: stub()})
    ),
    wrap: stubIdentity(),
  });

  return {
    "@react-native-community/datetimepicker": () => ({
      DateTimePickerAndroid: {
        dismiss: stubResolving(undefined),
        open: stubResolving({action: "dismissedAction"}),
      },
      default: hostComponent("DateTimePicker"),
    }),
    "@react-native-community/netinfo": createNetInfoMock,
    "@react-native-community/slider": () => ({default: hostComponent("Slider")}),
    "@react-native-picker/picker": () => ({Picker, PickerIOS: Picker}),
    "@sentry/react-native": sentry,
    pressto: createPresstoMock,
    "react-native-actions-sheet": () => ({
      __esModule: true,
      default: ActionSheet,
      SheetManager: {hide: stubResolving(undefined), show: stubResolving(undefined)},
    }),
    "react-native-gesture-handler": createGestureHandlerMock,
    "react-native-reanimated": createReanimatedMock,
    "react-native-safe-area-context": () => safeArea,
    "react-native-safe-area-context/jest/mock": () => ({default: safeArea}),
    "react-native-screens": () => ({
      enableFreeze: stub(),
      enableScreens: stub(),
      Screen: hostComponent("Screen"),
      ScreenContainer: hostComponent("ScreenContainer"),
      ScreenStack: hostComponent("ScreenStack"),
    }),
    "react-native-svg": createSvgMock,
    "react-native-webview": () => {
      const WebView = hostComponent("WebView");
      return {default: WebView, WebView};
    },
  };
};
