import {describe, it, mock} from "bun:test";
import {render} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {renderToString} from "react-dom/server";
import {View} from "react-native";

import {
  createNativeResponsiveBreakpointStore,
  createResponsiveBreakpointStore,
  getBreakpointForWidth,
  isBreakpointAtLeast,
  isSupportedDesktopViewport,
  isSupportedDesktopWidth,
  type ResponsiveBreakpointStore,
  useResponsiveBreakpoint,
} from "./ResponsiveBreakpoint";

interface BreakpointConsumerProps {
  enabled?: boolean;
  store: ResponsiveBreakpointStore;
}

const BreakpointConsumer: React.FC<BreakpointConsumerProps> = ({
  enabled = true,
  store,
}): React.ReactElement => {
  const breakpoint = useResponsiveBreakpoint({enabled, store});
  return <span>{breakpoint}</span>;
};

const BreakpointSubscriber: React.FC<BreakpointConsumerProps> = ({enabled = true, store}): null => {
  useResponsiveBreakpoint({enabled, store});
  return null;
};

describe("ResponsiveBreakpoint", () => {
  it("keeps native mobile breakpoint boundaries", () => {
    assert.equal(getBreakpointForWidth(319, "native"), "xs");
    assert.equal(getBreakpointForWidth(320, "native"), "sm");
    assert.equal(getBreakpointForWidth(374, "native"), "sm");
    assert.equal(getBreakpointForWidth(375, "native"), "md");
    assert.equal(getBreakpointForWidth(599, "native"), "md");
    assert.equal(getBreakpointForWidth(600, "native"), "lg");
    assert.equal(getBreakpointForWidth(1023, "native"), "lg");
    assert.equal(getBreakpointForWidth(1024, "native"), "xl");
  });

  it("keeps web desktop breakpoint boundaries", () => {
    assert.equal(getBreakpointForWidth(319, "web"), "xs");
    assert.equal(getBreakpointForWidth(320, "web"), "sm");
    assert.equal(getBreakpointForWidth(374, "web"), "sm");
    assert.equal(getBreakpointForWidth(375, "web"), "md");
    assert.equal(getBreakpointForWidth(1023, "web"), "md");
    assert.equal(getBreakpointForWidth(1024, "web"), "lg");
    assert.equal(getBreakpointForWidth(1279, "web"), "lg");
    assert.equal(getBreakpointForWidth(1280, "web"), "xl");
  });

  it("treats native xl and web lg as the supported desktop floor", () => {
    assert.isFalse(isSupportedDesktopViewport({breakpoint: "lg", surface: "native"}));
    assert.isTrue(isSupportedDesktopViewport({breakpoint: "xl", surface: "native"}));
    assert.isFalse(isSupportedDesktopViewport({breakpoint: "md", surface: "web"}));
    assert.isTrue(isSupportedDesktopViewport({breakpoint: "lg", surface: "web"}));
    assert.isFalse(isSupportedDesktopWidth({surface: "web", width: 768}));
    assert.isFalse(isSupportedDesktopWidth({surface: "native", width: 768}));
    assert.isFalse(isSupportedDesktopWidth({surface: "web", width: 1023}));
    assert.isTrue(isSupportedDesktopWidth({surface: "web", width: 1024}));
    assert.isFalse(isSupportedDesktopWidth({surface: "native", width: 1023}));
    assert.isTrue(isSupportedDesktopWidth({surface: "native", width: 1024}));
  });

  it("compares breakpoints without reading Dimensions", () => {
    assert.isFalse(isBreakpointAtLeast({breakpoint: "xs", minimum: "sm"}));
    assert.isTrue(isBreakpointAtLeast({breakpoint: "sm", minimum: "sm"}));
    assert.isTrue(isBreakpointAtLeast({breakpoint: "lg", minimum: "md"}));
    assert.isTrue(isBreakpointAtLeast({breakpoint: "xl", minimum: "lg"}));
  });

  it("maps native resize and rotation events into shared breakpoint updates", () => {
    let dimensionListener: ((event: {window: {width: number}}) => void) | undefined;
    const removeListener = mock((): void => {});
    const subscriber = mock((): void => {});
    const store = createNativeResponsiveBreakpointStore({
      addEventListener: (_eventType, listener): {remove: () => void} => {
        dimensionListener = listener;
        return {remove: removeListener};
      },
      get: (): {width: number} => ({width: 319}),
    });
    const unsubscribe = store.subscribe(subscriber);

    assert.equal(store.getSnapshot(), "xs");
    dimensionListener?.({window: {width: 375}});
    assert.equal(store.getSnapshot(), "md");
    assert.lengthOf(subscriber.mock.calls, 1);

    unsubscribe();
    assert.lengthOf(removeListener.mock.calls, 1);
  });

  it("uses the xs server snapshot before client hydration", () => {
    const store = createResponsiveBreakpointStore({
      getSurface: (): "native" => "native",
      getWindowWidth: (): number => 1024,
      subscribeToDimensions: (): {remove: () => void} => ({remove: (): void => {}}),
    });

    const html = renderToString(<BreakpointConsumer store={store} />);

    assert.include(html, ">xs<");
    assert.equal(store.getSnapshot(), "xl");
  });

  it("shares one dimensions listener across a responsive tree", () => {
    let dimensionReadCount = 0;
    let listenerCount = 0;
    let removeCount = 0;
    const store = createResponsiveBreakpointStore({
      getWindowWidth: (): number => {
        dimensionReadCount += 1;
        return 375;
      },
      subscribeToDimensions: (): {remove: () => void} => {
        listenerCount += 1;
        return {
          remove: (): void => {
            removeCount += 1;
          },
        };
      },
    });
    const result = render(
      <View>
        {Array.from(
          {length: 100},
          (_, index): React.ReactElement => (
            <BreakpointSubscriber key={index} store={store} />
          )
        )}
      </View>
    );

    assert.equal(dimensionReadCount, 2);
    assert.equal(listenerCount, 1);

    result.unmount();
    assert.equal(removeCount, 1);
  });

  it("does not subscribe when responsive behavior is disabled", () => {
    let listenerCount = 0;
    const store = createResponsiveBreakpointStore({
      getWindowWidth: (): number => 375,
      subscribeToDimensions: (): {remove: () => void} => {
        listenerCount += 1;
        return {remove: (): void => {}};
      },
    });
    const result = render(
      <View>
        {Array.from(
          {length: 100},
          (_, index): React.ReactElement => (
            <BreakpointSubscriber enabled={false} key={index} store={store} />
          )
        )}
      </View>
    );

    assert.equal(listenerCount, 0);
    result.unmount();
  });

  it("notifies on remount after a resize while no Boxes were subscribed", () => {
    let windowWidth = 375;
    const store = createResponsiveBreakpointStore({
      getSurface: (): "native" => "native",
      getWindowWidth: (): number => windowWidth,
      subscribeToDimensions: (): {remove: () => void} => ({remove: (): void => {}}),
    });
    const first = render(<BreakpointConsumer store={store} />);
    assert.equal(first.UNSAFE_root.findByType("span").props.children, "md");
    first.unmount();

    windowWidth = 1024;
    const second = render(<BreakpointConsumer store={store} />);
    assert.equal(second.UNSAFE_root.findByType("span").props.children, "xl");
    second.unmount();
  });
});
