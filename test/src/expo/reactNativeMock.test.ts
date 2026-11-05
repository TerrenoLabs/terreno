import {describe, expect, it, mock} from "bun:test";

import {
  createReactNativeInternalMocks,
  createReactNativeMock,
  createReactNativeModuleMocks,
  flattenStyle,
  type MockAnimation,
  processColor,
} from "./reactNativeMock";
import {registerExpoTestEnvironment} from "./registerExpoTestEnvironment";

registerExpoTestEnvironment({setProcessEnv: false});

// Required, not imported, so react-native resolves to the mock the environment registers.
const {createElement, createRef} = require("react") as typeof import("react");
const {render} =
  require("@testing-library/react-native") as typeof import("@testing-library/react-native");
// The mock also exposes itself as `default`, which the CommonJS typings do not declare.
const ReactNative = require("react-native") as typeof import("react-native") & {
  default: typeof import("react-native");
};

interface AnimatedNode {
  _value: number;
  interpolate: () => AnimatedNode;
  resetAnimation: (callback: (value: number) => void) => void;
  setValue: (value: number) => void;
  stopAnimation: (callback: (value: number) => void) => void;
}

describe("react-native mock", () => {
  it("is what `react-native` resolves to", () => {
    expect(ReactNative.Platform.OS).toBe("ios");
    expect(ReactNative.default.View).toBe(ReactNative.View);
  });

  it("selects platform values like React Native", () => {
    const ios = createReactNativeMock({platform: "ios"}).Platform as typeof ReactNative.Platform;
    const web = createReactNativeMock({platform: "web"}).Platform as typeof ReactNative.Platform;
    const android = createReactNativeMock({platform: "android"})
      .Platform as typeof ReactNative.Platform;
    expect(ios.select({default: "d", ios: "i"})).toBe("i");
    expect(ios.select({default: "d", native: "n"})).toBe("n");
    expect(web.select({default: "d", native: "n"})).toBe("d");
    expect(android.select({android: "a", default: "d"})).toBe("a");
    expect(android.Version).toBe(34);
  });

  it("flattens styles and processes colors", () => {
    expect(flattenStyle([{margin: 1}, [{padding: 2}], null])).toEqual({margin: 1, padding: 2});
    expect(flattenStyle(undefined)).toEqual({});
    expect(ReactNative.StyleSheet.compose({margin: 1}, {padding: 2})).toEqual([
      {margin: 1},
      {padding: 2},
    ]);
    expect(ReactNative.StyleSheet.compose(undefined, {padding: 2})).toEqual({padding: 2});
    expect(ReactNative.StyleSheet.create({box: {flex: 1}})).toEqual({box: {flex: 1}});
    expect(processColor(null)).toBeNull();
    expect(processColor(0x112233)).toBe(0x112233);
    expect(processColor("red")).toBe(0xff000000);
    expect<unknown>(ReactNative.DynamicColorIOS({dark: "black", light: "white"})).toBe("white");
    expect<unknown>(ReactNative.PlatformColor("systemBlue", "blue")).toBe("systemBlue");
  });

  it("completes composite animations and runs their children", () => {
    const child = ReactNative.Animated.timing(new ReactNative.Animated.Value(0), {
      duration: 1,
      toValue: 1,
      useNativeDriver: false,
    }) as unknown as MockAnimation;
    const done = mock(() => {});
    ReactNative.Animated.parallel([child as never]).start(done);
    ReactNative.Animated.sequence([child as never]).start();
    ReactNative.Animated.stagger(10, [child as never]).start();
    ReactNative.Animated.loop(child as never).start();
    ReactNative.Animated.loop(undefined as never).start();
    expect(done).toHaveBeenCalledWith({finished: true});
    expect(ReactNative.Animated.add(1 as never, 2 as never)).toBeInstanceOf(
      ReactNative.Animated.Value
    );
  });

  it("tracks animated values", () => {
    const value = new ReactNative.Animated.Value(3) as unknown as AnimatedNode;
    value.setValue(5);
    const seen: number[] = [];
    value.stopAnimation((current) => seen.push(current));
    value.resetAnimation((current) => seen.push(current));
    expect(seen).toEqual([5, 5]);
    expect(value.interpolate()._value).toBe(0);
    const xy = new ReactNative.Animated.ValueXY({x: 1, y: 2});
    expect(xy.getLayout()).toEqual({left: xy.x, top: xy.y});
    expect(xy.getTranslateTransform()).toEqual([{translateX: xy.x}, {translateY: xy.y}]);
    expect(new ReactNative.Animated.ValueXY().x).toBeInstanceOf(ReactNative.Animated.Value);
  });

  it("renders every FlatList and SectionList row", () => {
    const ref = createRef<{scrollToOffset: () => void}>();
    const {getByText, getByTestId} = render(
      createElement(
        ReactNative.View,
        null,
        createElement(ReactNative.FlatList<string>, {
          data: ["a", "b"],
          keyExtractor: (item: string) => item,
          ref: ref as never,
          renderItem: ({item}: {item: string}) =>
            createElement(ReactNative.Text, null, `row ${item}`),
          testID: "list",
        }),
        createElement(ReactNative.FlatList<string>, {data: ["c"], renderItem: () => null}),
        createElement(ReactNative.SectionList<string>, {
          renderItem: ({item}: {item: string}) =>
            createElement(ReactNative.Text, null, `item ${item}`),
          renderSectionHeader: ({section}) => createElement(ReactNative.Text, null, section.title),
          sections: [{data: ["x"], title: "Section"}] as never,
        }),
        createElement(ReactNative.SectionList<string>, {
          keyExtractor: (item: string) => item,
          renderItem: () => null,
          sections: [{data: ["y"], key: "keyed"}] as never,
        })
      )
    );
    expect(getByTestId("list")).toBeTruthy();
    expect(getByText("row a")).toBeTruthy();
    expect(getByText("row b")).toBeTruthy();
    expect(getByText("Section")).toBeTruthy();
    expect(getByText("item x")).toBeTruthy();
    ref.current?.scrollToOffset();
  });

  it("stubs native APIs", async () => {
    expect(ReactNative.Dimensions.get("window").width).toBe(375);
    expect(ReactNative.PixelRatio.getPixelSizeForLayoutSize(10)).toBe(20);
    expect(ReactNative.findNodeHandle(7 as never)).toBe(7);
    expect(ReactNative.findNodeHandle(null)).toBeNull();
    expect(await ReactNative.Linking.canOpenURL("https://example.com")).toBe(true);
    const task = mock(() => {});
    ReactNative.InteractionManager.runAfterInteractions(task);
    ReactNative.InteractionManager.runAfterInteractions();
    expect(task).toHaveBeenCalled();
    const emitter = new ReactNative.NativeEventEmitter();
    emitter.addListener("event", () => {}).remove();
    expect(ReactNative.PanResponder.create({}).panHandlers).toEqual({});
  });
});

describe("react-native internals", () => {
  it("builds a stand-in for every deep import", () => {
    const internals = createReactNativeInternalMocks(createReactNativeMock());
    for (const [path, factory] of Object.entries(internals)) {
      expect(factory(), path).toBeDefined();
    }
  });

  it("resolves sources and native component configs", async () => {
    const resolveAssetSource = (await import("react-native/Libraries/Image/resolveAssetSource"))
      .default as unknown as (source: unknown) => unknown;
    expect(resolveAssetSource({uri: "a.png"})).toEqual({
      height: 0,
      scale: 1,
      uri: "a.png",
      width: 0,
    });
    expect(resolveAssetSource({height: 2, uri: "b", width: 3})).toEqual({
      height: 2,
      scale: 1,
      uri: "b",
      width: 3,
    });
    expect(resolveAssetSource({})).toEqual({height: 0, scale: 1, uri: "", width: 0});
    expect(resolveAssetSource(null)).toBeNull();
    const {default: AssetSourceResolver} = (await import(
      "react-native/Libraries/Image/AssetSourceResolver"
    )) as unknown as {
      default: new () => {defaultAsset: () => unknown};
    };
    expect(new AssetSourceResolver().defaultAsset()).toEqual({
      height: 0,
      scale: 1,
      uri: "",
      width: 0,
    });
  });

  it("covers nested package copies with the same instance", () => {
    const mocks = createReactNativeModuleMocks({packagePrefixes: ["", "pkg/node_modules/"]});
    expect(mocks["pkg/node_modules/react-native"]?.()).toBe(mocks["react-native"]?.());
    expect(Object.keys(createReactNativeModuleMocks())).toContain(
      "react-native/Libraries/Utilities/Platform"
    );
  });
});
