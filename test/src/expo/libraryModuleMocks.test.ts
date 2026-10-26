import {describe, expect, it, mock} from "bun:test";

import {createLibraryModuleMocks, interpolate, MOCK_NET_INFO_STATE} from "./libraryModuleMocks";
import {hostComponent, passthroughComponent, stubResolving, stubSubscription} from "./mockHelpers";
import {registerExpoTestEnvironment} from "./registerExpoTestEnvironment";

registerExpoTestEnvironment({setProcessEnv: false});

const {createElement, createRef} = await import("react");
const {act, fireEvent, render} = await import("@testing-library/react-native");

type AnyModule = Record<string, unknown> & {default?: unknown};

const load = async (specifier: string): Promise<AnyModule> =>
  (await import(specifier)) as AnyModule;

interface SharedValue<T> {
  get: () => T;
  modify: (modifier: (value: T) => T) => T;
  set: (value: T) => void;
  value: T;
}

describe("react-native-reanimated mock", () => {
  it("keeps shared values readable and writable", async () => {
    const reanimated = await load("react-native-reanimated");
    const shared = (reanimated.useSharedValue as (value: number) => SharedValue<number>)(1);
    shared.set(2);
    expect(shared.modify((value) => value + 1)).toBe(3);
    expect(shared.get()).toBe(3);
    const derived = (reanimated.useDerivedValue as (fn: () => number) => SharedValue<number>)(
      () => 4
    );
    expect(derived.value).toBe(4);
    expect(
      (reanimated.useAnimatedProps as (fn: () => object) => object)(() => ({width: 1}))
    ).toEqual({width: 1});
    expect(
      (reanimated.useAnimatedStyle as (fn: () => object) => object)(() => ({opacity: 1}))
    ).toEqual({opacity: 1});
    expect((reanimated.withDelay as (delay: number, value: number) => number)(10, 5)).toBe(5);
    expect((reanimated.withSequence as (...values: number[]) => number)(7, 8)).toBe(7);
    const fadeIn = reanimated.FadeIn as {duration: (ms: number) => unknown};
    expect(fadeIn.duration(100)).toBe(fadeIn);
    expect(
      (reanimated.interpolateColor as (v: number, i: number[], o: string[]) => string)(
        0,
        [0, 1],
        ["red", "blue"]
      )
    ).toBe("red");
  });

  it("interpolates linearly", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(5, [1, 1], [3, 4])).toBe(3);
    expect(interpolate(5, [], [])).toBe(0);
  });
});

describe("react-native-gesture-handler mock", () => {
  it("chains gesture configuration", async () => {
    const handler = await load("react-native-gesture-handler");
    const Gesture = handler.Gesture as Record<
      string,
      () => Record<string, (...args: unknown[]) => unknown>
    >;
    const pan = Gesture.Pan?.();
    expect(pan?.onStart?.(() => {})).toBe(pan);
    const {getByTestId} = render(
      createElement(handler.GestureDetector as never, {gesture: pan, testID: "detector"})
    );
    expect(getByTestId("detector")).toBeTruthy();
  });
});

describe("other native library mocks", () => {
  it("reports an online network and calls listeners immediately", async () => {
    const netInfo = (await load("@react-native-community/netinfo")).default as {
      addEventListener: (listener?: (state: unknown) => void) => () => void;
      fetch: () => Promise<unknown>;
    };
    const listener = mock(() => {});
    netInfo.addEventListener(listener)();
    netInfo.addEventListener();
    expect(listener).toHaveBeenCalledWith(MOCK_NET_INFO_STATE);
    expect(await netInfo.fetch()).toEqual(MOCK_NET_INFO_STATE);
  });

  it("opens and closes the action sheet through its ref", async () => {
    const {default: ActionSheet} = await load("react-native-actions-sheet");
    const ref = createRef<{
      hide: () => void;
      setModalVisible: (visible?: boolean) => void;
      show: () => void;
    }>();
    const ReactNative = await import("react-native");
    const {queryByText} = render(
      createElement(
        ActionSheet as never,
        {ref},
        createElement(ReactNative.Text, null, "Sheet body")
      )
    );
    expect(queryByText("Sheet body")).toBeNull();
    act(() => ref.current?.show());
    expect(queryByText("Sheet body")).toBeTruthy();
    act(() => ref.current?.hide());
    expect(queryByText("Sheet body")).toBeNull();
    act(() => ref.current?.setModalVisible(true));
    expect(queryByText("Sheet body")).toBeTruthy();
    act(() => ref.current?.setModalVisible());
    expect(queryByText("Sheet body")).toBeNull();
  });

  it("disables pressto pressables when enabled is false", async () => {
    const pressto = await load("pressto");
    const onPress = mock(() => {});
    const {getByTestId} = render(
      createElement(
        passthroughComponent as never,
        null,
        createElement(pressto.PressableScale as never, {onPress, testID: "on"}),
        createElement(pressto.PressableOpacity as never, {enabled: false, onPress, testID: "off"})
      )
    );
    fireEvent.press(getByTestId("on"));
    expect(getByTestId("off").props.onPress).toBeUndefined();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("provides zero safe-area insets and Sentry no-ops", async () => {
    const safeArea = await load("react-native-safe-area-context");
    expect((safeArea.useSafeAreaInsets as () => object)()).toEqual({
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    });
    const sentry = await load("@sentry/react-native");
    const scopeCallback = mock((_scope: unknown) => {});
    (sentry.withScope as (callback: (scope: unknown) => void) => void)(scopeCallback);
    expect(scopeCallback).toHaveBeenCalled();
    expect((sentry.captureException as (error: Error) => string)(new Error("x"))).toBe(
      "test-event-id"
    );
  });

  it("builds a factory for every module", () => {
    for (const [specifier, factory] of Object.entries(createLibraryModuleMocks())) {
      expect(factory(), specifier).toBeDefined();
    }
  });
});

describe("mock helpers", () => {
  it("names host components and returns subscriptions", async () => {
    expect(hostComponent("Thing").name).toBe("Thing");
    stubSubscription()().remove();
    expect(await stubResolving(3)()).toBe(3);
  });
});
