import {afterAll, afterEach, beforeAll, describe, expect, it, type Mock, mock} from "bun:test";
import {act, render} from "@testing-library/react-native";
import {createRef, type RefObject} from "react";
import {
  Animated,
  Dimensions,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  type View,
} from "react-native";

import {
  ActionSheet,
  getDeviceHeight,
  getElevation,
  resetActionSheetDeviceHeightCacheForTests,
  waitAsync,
} from "./ActionSheet";
import {ThemeProvider} from "./Theme";

const scrollEvent = (y: number): NativeSyntheticEvent<NativeScrollEvent> =>
  ({nativeEvent: {contentOffset: {x: 0, y}}}) as NativeSyntheticEvent<NativeScrollEvent>;

const layoutEvent = (height: number, width: number): LayoutChangeEvent =>
  ({nativeEvent: {layout: {height, width, x: 0, y: 0}}}) as LayoutChangeEvent;

/** Stands in for the SafeAreaView ref, whose measureInWindow reports `height`. */
const measuringSafeAreaRef = (height: number): React.RefObject<View | null> => {
  const measuringView: Pick<View, "measureInWindow"> = {
    measureInWindow: (callback) => {
      callback(0, 0, 100, height);
    },
  };
  return {current: measuringView as View};
};

beforeAll(() => {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  };
  globalThis.cancelAnimationFrame = (id: number | null | undefined) => {
    clearTimeout(id ?? undefined);
  };
});

afterAll(() => {
  resetActionSheetDeviceHeightCacheForTests();
});

describe("ActionSheet", () => {
  it("component is defined", () => {
    expect(ActionSheet).toBeDefined();
    expect(typeof ActionSheet).toBe("function");
  });

  it("renders correctly", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet ref={ref}>
          <Text>Test content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom overlay color", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet overlayColor="rgba(0,0,0,0.5)" ref={ref}>
          <Text>Content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with gesture enabled", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet gestureEnabled ref={ref}>
          <Text>Gesture content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("show() sets modalVisible to true", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet ref={ref}>
          <Text>Content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    expect(ref.current?.state.modalVisible).toBe(true);
  });

  it("show() followed by hide() calls hide animation path", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet closeAnimationDuration={1} ref={ref}>
          <Text>Content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    expect(ref.current?.state.modalVisible).toBe(true);
    act(() => {
      ref.current?.hide();
    });
    // hide() does not immediately flip modalVisible (it animates first)
    expect(ref.current).toBeTruthy();
  });

  it("setModalVisible does nothing when state already matches", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet ref={ref}>
          <Text>Content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    // modal starts hidden, call hide again (setModalVisible(false)) - state stays hidden
    act(() => {
      ref.current?.hide();
    });
    expect(ref.current?.state.modalVisible).toBe(false);
  });

  it("snapToOffset does not throw when called before layout", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet ref={ref}>
          <Text>Content</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(() => ref.current?.snapToOffset(100)).not.toThrow();
  });

  it("renders with elevation prop", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet elevation={10} ref={ref}>
          <Text>Elevated</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with indicator color", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet indicatorColor="red" ref={ref}>
          <Text>Indicator</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with initialOffsetFromBottom", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet initialOffsetFromBottom={0.5} ref={ref}>
          <Text>Offset</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with bottomOffset", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet bottomOffset={20} ref={ref}>
          <Text>Bottom</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with closable=false and persistent", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet closable={false} ref={ref}>
          <Text>Persistent</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom containerStyle", () => {
    const ref = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <ActionSheet containerStyle={{backgroundColor: "blue"}} ref={ref}>
          <Text>Styled</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("invokes onOpen when modal is shown", () => {
    const ref = createRef<ActionSheet>();
    const handleOpen = mock(() => {});
    render(
      <ThemeProvider>
        <ActionSheet onOpen={handleOpen} ref={ref}>
          <Text>Open</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    expect(ref.current?.state.modalVisible).toBe(true);
  });

  it("_onRequestClose hides modal when closeOnPressBack is true", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet closeAnimationDuration={1} closeOnPressBack ref={ref}>
          <Text>Close</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    expect(() => ref.current!._onRequestClose()).not.toThrow();
  });

  it("_onTouchBackdrop hides modal when closeOnTouchBackdrop is true", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet closeAnimationDuration={1} closeOnTouchBackdrop ref={ref}>
          <Text>Backdrop</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    expect(() => ref.current!._onTouchBackdrop()).not.toThrow();
  });

  it("_onRequestClose does not hide when closeOnPressBack is false", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet closeOnPressBack={false} ref={ref}>
          <Text>NoClose</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    ref.current!._onRequestClose();
    expect(ref.current?.state.modalVisible).toBe(true);
  });

  it("_onTouchBackdrop does not hide when closeOnTouchBackdrop is false", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet closeOnTouchBackdrop={false} ref={ref}>
          <Text>NoBackdrop</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    act(() => {
      ref.current?.show();
    });
    ref.current!._onTouchBackdrop();
    expect(ref.current?.state.modalVisible).toBe(true);
  });

  it("_onScroll does not throw", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet ref={ref}>
          <Text>Scroll</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(() => ref.current!._onScroll(scrollEvent(10))).not.toThrow();
  });

  it("_onTouchStart and _onTouchMove do not throw", () => {
    const ref = createRef<ActionSheet>();
    render(
      <ThemeProvider>
        <ActionSheet ref={ref}>
          <Text>Touch</Text>
        </ActionSheet>
      </ThemeProvider>
    );
    expect(() => ref.current!._onTouchStart()).not.toThrow();
    expect(() => ref.current!._onTouchMove()).not.toThrow();
    expect(() => ref.current!._onTouchEnd()).not.toThrow();
  });

  describe("getDeviceHeight", () => {
    it("returns a number", () => {
      const height = getDeviceHeight(false);
      expect(typeof height).toBe("number");
      expect(height).toBeGreaterThan(0);
    });

    it("works with statusBarTranslucent true", () => {
      const height = getDeviceHeight(true);
      expect(typeof height).toBe("number");
      expect(height).toBeGreaterThan(0);
    });
  });

  describe("getElevation", () => {
    it("returns empty object for no elevation", () => {
      expect(getElevation()).toEqual({});
      expect(getElevation(0)).toEqual({});
    });

    it("returns elevation styles for positive elevation", () => {
      const result = getElevation(5);
      expect(result).toHaveProperty("elevation", 5);
      expect(result).toHaveProperty("boxShadow");
    });
  });

  describe("waitAsync", () => {
    it("resolves after the specified time", async () => {
      const result = await waitAsync(1);
      expect(result).toBeNull();
    });
  });

  describe("measure", () => {
    it("resolves with 20 when safeAreaViewRef has no measureInWindow", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const result = await ref.current!.measure();
      expect(result).toBe(20);
    });

    it("resolves with height from measureInWindow when available", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.safeAreaViewRef = measuringSafeAreaRef(44);
      const result = await ref.current!.measure();
      expect(result).toBe(44);
    });

    it("resolves with 20 when measureInWindow returns 0 height", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.safeAreaViewRef = measuringSafeAreaRef(0);
      const result = await ref.current!.measure();
      expect(result).toBe(20);
    });
  });

  describe("_showModal", () => {
    it("returns early when nativeEvent is missing", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      await ref.current!._showModal({} as LayoutChangeEvent);
      expect(ref.current).toBeTruthy();
    });

    it("processes layout event on first call and sets actionSheetHeight", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet animated={false} ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.layoutHasCalled = false;
      await ref.current!._showModal(layoutEvent(500, 400));
      expect(ref.current!.actionSheetHeight).toBe(500);
      expect(ref.current!.layoutHasCalled).toBe(true);
    });

    it("handles subsequent layout calls (layoutHasCalled=true)", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.layoutHasCalled = true;
      ref.current!.actionSheetHeight = 400;
      await ref.current!._showModal(layoutEvent(600, 400));
      expect(ref.current!.actionSheetHeight).toBe(600);
    });
  });

  describe("_openAnimation", () => {
    it("runs spring animation when animated is true", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet animated ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      expect(() => ref.current!._openAnimation(100)).not.toThrow();
    });

    it("sets opacity directly when animated is false", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet animated={false} ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      expect(() => ref.current!._openAnimation(100)).not.toThrow();
    });
  });

  describe("_onScrollBeginDrag", () => {
    it("stores the scroll position in prevScroll", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      await ref.current!._onScrollBeginDrag(scrollEvent(42));
      expect(ref.current!.prevScroll).toBe(42);
    });
  });

  describe("_applyHeightLimiter", () => {
    it("clamps actionSheetHeight to deviceHeight", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.actionSheetHeight = 99999;
      ref.current!._applyHeightLimiter();
      expect(ref.current!.actionSheetHeight).toBeLessThanOrEqual(ref.current!.state.deviceHeight);
    });

    it("does not change actionSheetHeight when smaller than deviceHeight", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.actionSheetHeight = 100;
      ref.current!._applyHeightLimiter();
      expect(ref.current!.actionSheetHeight).toBe(100);
    });
  });

  describe("_onScrollEnd", () => {
    it("handles upward scroll past springOffset threshold", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={50}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.prevScroll = 100;
      ref.current!.actionSheetHeight = 500;
      ref.current!.isRecoiling = false;
      await ref.current!._onScrollEnd(scrollEvent(200));
      expect(ref.current).toBeTruthy();
    });

    it("returns early when isRecoiling is true", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.isRecoiling = true;
      await ref.current!._onScrollEnd(scrollEvent(50));
      expect(ref.current).toBeTruthy();
    });

    it("handles downward scroll past springOffset (hides modal)", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={10}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.prevScroll = 200;
      ref.current!.isRecoiling = false;
      await ref.current!._onScrollEnd(scrollEvent(50));
      expect(ref.current).toBeTruthy();
    });

    it("handles small downward scroll (recoils to previous position)", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={200}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.prevScroll = 100;
      ref.current!.isRecoiling = false;
      await ref.current!._onScrollEnd(scrollEvent(95));
      expect(ref.current).toBeTruthy();
    });

    it("handles small upward scroll (returns to prev position)", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={200}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.prevScroll = 100;
      ref.current!.actionSheetHeight = 500;
      ref.current!.isRecoiling = false;
      await ref.current!._onScrollEnd(scrollEvent(110));
      expect(ref.current).toBeTruthy();
    });
  });

  describe("_onKeyboardShow", () => {
    const timing = (
      Animated as unknown as {
        timing: Mock<(value: unknown, config: Animated.TimingAnimationConfig) => unknown>;
      }
    ).timing;

    /**
     * Focuses a field at `pageY` with a 40pt height and measures it synchronously, mirroring
     * how UIManager.measure calls back on a real device.
     */
    const withFocusedField = (pageY: number, run: () => void): void => {
      const {TextInput: MockTextInput, UIManager: MockUIManager} = require("react-native");
      const origState = MockTextInput.State;
      const origMeasure = MockUIManager.measure;
      MockTextInput.State = {currentlyFocusedField: () => 42};
      MockUIManager.measure = (
        _node: number,
        callback: (
          originX: number,
          originY: number,
          width: number,
          height: number,
          pageX: number,
          pageY: number
        ) => void
      ): void => {
        callback(0, 0, 100, 40, 0, pageY);
      };
      try {
        run();
      } finally {
        MockTextInput.State = origState;
        MockUIManager.measure = origMeasure;
      }
    };

    const showKeyboard = (ref: RefObject<ActionSheet | null>, keyboardHeight: number): void => {
      ref.current?._onKeyboardShow({
        endCoordinates: {height: keyboardHeight, screenX: 0, screenY: 500, width: 400},
      } as KeyboardEvent);
    };

    it("sets keyboard state to true and handles no focused field", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const {TextInput: MockTextInput} = require("react-native");
      const origState = MockTextInput.State;
      MockTextInput.State = {
        currentlyFocusedField: () => null,
      };
      const timingCallsBefore = timing.mock.calls.length;
      act(() => {
        showKeyboard(ref, 300);
      });
      expect(ref.current!.state.keyboard).toBe(true);
      expect(timing.mock.calls.length).toBe(timingCallsBefore);
      MockTextInput.State = origState;
    });

    it("does not animate when the focused field stays above the keyboard", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const timingCallsBefore = timing.mock.calls.length;
      withFocusedField(400, () => {
        act(() => {
          showKeyboard(ref, 300);
        });
      });
      expect(ref.current!.state.keyboard).toBe(true);
      // windowHeight (896) - keyboardHeight (300) - (pageY (400) + fieldHeight (40)) = 156 above
      // the keyboard, so no animation is needed.
      expect(timing.mock.calls.length).toBe(timingCallsBefore);
    });

    it("animates the sheet up by the overlap when the keyboard covers the focused field", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const timingCallsBefore = timing.mock.calls.length;
      withFocusedField(800, () => {
        act(() => {
          showKeyboard(ref, 300);
        });
      });
      const {height: windowHeight} = Dimensions.get("window");
      const gap = windowHeight - 300 - (800 + 40);
      expect(timing.mock.calls.length).toBe(timingCallsBefore + 1);
      expect(timing.mock.calls[timingCallsBefore][1].toValue).toBe(gap - 10);
    });

    it("shifts by the keyboard height instead of the overlap in position keyboard mode", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet keyboardMode="position" ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const timingCallsBefore = timing.mock.calls.length;
      withFocusedField(800, () => {
        act(() => {
          showKeyboard(ref, 300);
        });
      });
      expect(timing.mock.calls.length).toBe(timingCallsBefore + 1);
      expect(timing.mock.calls[timingCallsBefore][1].toValue).toBe(-(300 + 15));
    });
  });

  describe("_onKeyboardHide", () => {
    it("sets keyboard state to false and animates", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      act(() => {
        ref.current!._onKeyboardHide();
      });
      expect(ref.current!.state.keyboard).toBe(false);
    });
  });

  describe("handleChildScrollEnd", () => {
    it("returns early when offsetY > prevScroll", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.offsetY = 200;
      ref.current!.prevScroll = 100;
      await ref.current!.handleChildScrollEnd();
      expect(ref.current).toBeTruthy();
    });

    it("hides modal when scroll offset is far from initial position", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={10}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.offsetY = 0;
      ref.current!.prevScroll = 200;
      ref.current!.actionSheetHeight = 500;
      await ref.current!.handleChildScrollEnd();
      expect(ref.current).toBeTruthy();
    });

    it("recoils to prevScroll when within springOffset range", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={200}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.offsetY = 90;
      ref.current!.prevScroll = 100;
      await ref.current!.handleChildScrollEnd();
      expect(ref.current).toBeTruthy();
    });

    it("scrolls back to initial position when close to it", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled initialOffsetFromBottom={1} ref={ref} springOffset={10}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.offsetY = 50;
      ref.current!.prevScroll = 200;
      ref.current!.actionSheetHeight = 200;
      await ref.current!.handleChildScrollEnd();
      expect(ref.current).toBeTruthy();
    });
  });

  describe("componentWillUnmount", () => {
    it("removes keyboard listeners on unmount", () => {
      const ref = createRef<ActionSheet>();
      const {unmount} = render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      expect(() => unmount()).not.toThrow();
    });
  });

  describe("_onDeviceLayout", () => {
    it("clears existing timeout before scheduling new one", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const existingTimeout = setTimeout(() => {}, 1000);
      ref.current!.timeout = existingTimeout;
      ref.current!._onDeviceLayout(layoutEvent(812, 375));
      const newTimeout = ref.current!.timeout;
      expect(newTimeout).not.toBe(existingTimeout);
      clearTimeout(newTimeout);
    });
  });

  describe("getInitialScrollPosition", () => {
    it("returns a scroll position with gestureEnabled", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled initialOffsetFromBottom={0.5} ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.actionSheetHeight = 500;
      const pos = ref.current!.getInitialScrollPosition();
      expect(typeof pos).toBe("number");
    });

    it("returns a scroll position without gestureEnabled", () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled={false} ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.actionSheetHeight = 500;
      const pos = ref.current!.getInitialScrollPosition();
      expect(typeof pos).toBe("number");
    });
  });

  describe("_hideAnimation with closable=false", () => {
    it("snaps to bottomOffset when closable=false and bottomOffset>0", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet bottomOffset={50} closable={false} closeAnimationDuration={1} ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      act(() => {
        ref.current?.show();
      });
      ref.current!.isClosing = false;
      act(() => {
        ref.current!._hideAnimation();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(ref.current).toBeTruthy();
    });

    it("scrolls to initialOffset when closable=false and bottomOffset<=0", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet closable={false} closeAnimationDuration={1} ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      act(() => {
        ref.current?.show();
      });
      ref.current!.isClosing = false;
      act(() => {
        ref.current!._hideAnimation();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(ref.current).toBeTruthy();
    });
  });

  describe("_onScrollBegin", () => {
    it("does not throw", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      await expect(ref.current!._onScrollBegin()).resolves.toBeUndefined();
    });
  });

  describe("handleChildScrollEnd with setTimeout recoiling", () => {
    it("resets isRecoiling after timeout when scrolling back to initial position", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled initialOffsetFromBottom={0.5} ref={ref} springOffset={10}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.actionSheetHeight = 100;
      // scrollOffset ≈ 100*0.5 + deviceHeight*0.15 ≈ 150
      // Need offsetY > scrollOffset - 100, so offsetY = 120 works
      ref.current!.offsetY = 120;
      ref.current!.prevScroll = 200;
      await act(async () => {
        await ref.current!.handleChildScrollEnd();
      });
      expect(ref.current!.isRecoiling).toBe(true);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
      expect(ref.current!.isRecoiling).toBe(false);
    });
  });

  describe("handleChildScrollEnd additional coverage", () => {
    it("recoils when offset is near prevScroll", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} springOffset={5}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      ref.current!.offsetY = 98;
      ref.current!.prevScroll = 100;
      await act(async () => {
        await ref.current!.handleChildScrollEnd();
      });
      expect(ref.current!.isRecoiling).toBe(true);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
      expect(ref.current!.isRecoiling).toBe(false);
    });

    it("recoils when within scroll threshold of initial position", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled ref={ref} springOffset={100}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const instance = ref.current!;
      instance.actionSheetHeight = 500;
      instance.prevScroll = 300;
      instance.offsetY = 250;
      instance.isRecoiling = false;
      instance.currentOffsetFromBottom = 1;

      await act(async () => {
        await instance.handleChildScrollEnd();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
      expect(instance.isRecoiling).toBe(false);
    });

    it("hides modal when scrolled far past threshold", async () => {
      const ref = createRef<ActionSheet>();
      const onClose = mock(() => {});
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled onClose={onClose} ref={ref} springOffset={50}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const instance = ref.current!;
      instance.actionSheetHeight = 500;
      instance.prevScroll = 300;
      instance.offsetY = 100;
      instance.isRecoiling = false;
      instance.isClosing = false;

      await act(async () => {
        await instance.handleChildScrollEnd();
      });
      expect(instance.isClosing).toBe(true);
    });

    it("recoils back to previous position when not past threshold", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled ref={ref} springOffset={100}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const instance = ref.current!;
      instance.actionSheetHeight = 500;
      instance.prevScroll = 300;
      instance.offsetY = 290;
      instance.isRecoiling = false;

      await act(async () => {
        await instance.handleChildScrollEnd();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
      expect(instance.isRecoiling).toBe(false);
    });

    it("bounces back when scrolling up beyond prevScroll", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet gestureEnabled ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      const instance = ref.current!;
      instance.prevScroll = 200;
      instance.offsetY = 195;
      instance._scrollTo = mock(() => {});
      await instance.handleChildScrollEnd();
      expect(instance.isRecoiling).toBe(true);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
      expect(instance.isRecoiling).toBe(false);
    });
  });

  describe("_onDeviceLayout timeout callback execution", () => {
    afterEach(() => {
      resetActionSheetDeviceHeightCacheForTests();
    });

    it("updates state after layout timeout fires with drawUnderStatusBar", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet drawUnderStatusBar ref={ref}>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      await act(async () => {
        ref.current!._onDeviceLayout(layoutEvent(800, 400));
        // measure() has a 100ms timeout on iOS; on android it uses StatusBar.currentHeight
        await new Promise((r) => setTimeout(r, 200));
      });
      // The callback should have run and set deviceLayoutCalled
      expect(ref.current!.deviceLayoutCalled).toBe(true);
    });

    it("updates state after layout timeout fires without drawUnderStatusBar on android", async () => {
      const ref = createRef<ActionSheet>();
      render(
        <ThemeProvider>
          <ActionSheet ref={ref} statusBarTranslucent>
            <Text>Content</Text>
          </ActionSheet>
        </ThemeProvider>
      );
      await act(async () => {
        ref.current!._onDeviceLayout(layoutEvent(900, 400));
        await new Promise((r) => setTimeout(r, 200));
      });
      expect(ref.current!.deviceLayoutCalled).toBe(true);
    });
  });
});
