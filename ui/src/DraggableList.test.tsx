import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, render} from "@testing-library/react-native";
import React from "react";
import {Platform, Text as RNText, View} from "react-native";
import {Gesture} from "react-native-gesture-handler";
import * as Reanimated from "react-native-reanimated";

import {DraggableList, DragItem} from "./DraggableList";

interface PanEvent {
  translationY: number;
}

interface CapturedGesture {
  onBegin?: () => void;
  onChange?: (event: PanEvent) => void;
  onFinalize?: () => void;
}

let capturedGestures: CapturedGesture[] = [];

/** Replaces Gesture.Pan with a chainable stub that records the registered handlers. */
const capturePanGestures = () => {
  return spyOn(Gesture, "Pan").mockImplementation(() => {
    const captured: CapturedGesture = {};
    capturedGestures.push(captured);
    const chainable = {
      onBegin: (handler: () => void) => {
        captured.onBegin = handler;
        return chainable;
      },
      onChange: (handler: (event: PanEvent) => void) => {
        captured.onChange = handler;
        return chainable;
      },
      onFinalize: (handler: () => void) => {
        captured.onFinalize = handler;
        return chainable;
      },
    };
    return chainable as unknown as ReturnType<typeof Gesture.Pan>;
  });
};

const renderItem = ({item}: {item: string}): React.ReactElement => <RNText>{item}</RNText>;

describe("DraggableList", () => {
  let panSpy: ReturnType<typeof capturePanGestures>;

  beforeEach(() => {
    capturedGestures = [];
    panSpy = capturePanGestures();
  });

  afterEach(() => {
    panSpy.mockRestore();
  });

  it("renders one draggable item per id", () => {
    const {getByText} = render(
      <DraggableList
        callbackNewDataIds={() => {}}
        dataIDs={["a", "b", "c"]}
        renderItem={renderItem}
      />
    );

    expect(getByText("a")).toBeTruthy();
    expect(getByText("b")).toBeTruthy();
    expect(getByText("c")).toBeTruthy();
  });

  it("falls back to the deprecated data prop", () => {
    const {getByText} = render(
      <DraggableList callbackNewDataIds={() => {}} data={["one", "two"]} renderItem={renderItem} />
    );

    expect(getByText("one")).toBeTruthy();
    expect(getByText("two")).toBeTruthy();
  });

  it("renders an empty list when no ids are provided", () => {
    const {toJSON} = render(
      <DraggableList callbackNewDataIds={() => {}} renderItem={renderItem} />
    );

    expect(toJSON()).toBeTruthy();
    expect(capturedGestures).toHaveLength(0);
  });

  it("renders a custom grip element", () => {
    const {getByText} = render(
      <DraggableList
        callbackNewDataIds={() => {}}
        dataIDs={["a"]}
        renderGrip={<RNText>grip</RNText>}
        renderItem={renderItem}
      />
    );

    expect(getByText("grip")).toBeTruthy();
  });

  it("renders a grip render function", () => {
    const {getByText} = render(
      <DraggableList
        callbackNewDataIds={() => {}}
        dataIDs={["a"]}
        renderGrip={() => <RNText>grip-fn</RNText>}
        renderItem={renderItem}
      />
    );

    expect(getByText("grip-fn")).toBeTruthy();
  });

  it("throws when the data prop is not an array", () => {
    expect(() =>
      render(
        <DraggableList
          callbackNewDataIds={() => {}}
          dataIDs={"nope" as unknown as string[]}
          renderItem={renderItem}
        />
      )
    ).toThrow(/should be \[\]/);
  });

  it("throws when renderItem is missing", () => {
    expect(() =>
      render(
        <DraggableList
          callbackNewDataIds={() => {}}
          dataIDs={["a"]}
          renderItem={undefined as unknown as typeof renderItem}
        />
      )
    ).toThrow(/"renderItem" prop is missing/);
  });

  it("throws when callbackNewDataIds is missing", () => {
    expect(() =>
      render(
        <DraggableList
          callbackNewDataIds={undefined as unknown as (ids: string[]) => void}
          dataIDs={["a"]}
          renderItem={renderItem}
        />
      )
    ).toThrow(/"callbackNewDataIds" prop is missing/);
  });

  it("throws when callbackNewDataIds is not a function", () => {
    expect(() =>
      render(
        <DraggableList
          callbackNewDataIds={"nope" as unknown as (ids: string[]) => void}
          dataIDs={["a"]}
          renderItem={renderItem}
        />
      )
    ).toThrow(/should be function type/);
  });

  it("updates positions when the ids change", () => {
    const {getByText, rerender} = render(
      <DraggableList callbackNewDataIds={() => {}} dataIDs={["a", "b"]} renderItem={renderItem} />
    );

    rerender(
      <DraggableList callbackNewDataIds={() => {}} dataIDs={["b", "a"]} renderItem={renderItem} />
    );

    expect(getByText("a")).toBeTruthy();
    expect(getByText("b")).toBeTruthy();
  });

  describe("drag gestures", () => {
    it("vibrates when the drag begins", () => {
      const passVibration = mock(() => {});
      render(
        <DraggableList
          callbackNewDataIds={() => {}}
          dataIDs={["a", "b"]}
          passVibration={passVibration}
          renderItem={renderItem}
        />
      );

      act(() => {
        capturedGestures[0]?.onBegin?.();
      });

      expect(passVibration).toHaveBeenCalled();
    });

    it("begins the drag without a vibration callback", () => {
      render(
        <DraggableList callbackNewDataIds={() => {}} dataIDs={["a", "b"]} renderItem={renderItem} />
      );

      expect(() =>
        act(() => {
          capturedGestures[0]?.onBegin?.();
        })
      ).not.toThrow();
    });

    it("reorders items and vibrates when dragged past another item", () => {
      const passVibration = mock(() => {});
      render(
        <DraggableList
          callbackNewDataIds={() => {}}
          dataIDs={["a", "b", "c"]}
          itemHeight={50}
          itemsGap={5}
          passVibration={passVibration}
          renderItem={renderItem}
        />
      );

      act(() => {
        capturedGestures[0]?.onBegin?.();
        capturedGestures[0]?.onChange?.({translationY: 120});
      });

      // Once for the drag start, once for crossing into a new position.
      expect(passVibration.mock.calls.length).toBeGreaterThan(1);
    });

    it("does not reorder when the item stays in place", () => {
      const passVibration = mock(() => {});
      render(
        <DraggableList
          callbackNewDataIds={() => {}}
          dataIDs={["a", "b", "c"]}
          passVibration={passVibration}
          renderItem={renderItem}
        />
      );

      act(() => {
        capturedGestures[0]?.onChange?.({translationY: 1});
      });

      expect(passVibration).not.toHaveBeenCalled();
    });

    it("clamps the new position to the end of the list", () => {
      const callbackNewDataIds = mock(() => {});
      render(
        <DraggableList
          callbackNewDataIds={callbackNewDataIds}
          dataIDs={["a", "b", "c"]}
          renderItem={renderItem}
        />
      );

      act(() => {
        capturedGestures[0]?.onChange?.({translationY: 10000});
        capturedGestures[0]?.onFinalize?.();
      });

      expect(callbackNewDataIds).toHaveBeenCalledWith(["c", "b", "a"]);
    });

    it("reports the new order once per unique arrangement", () => {
      const callbackNewDataIds = mock(() => {});
      render(
        <DraggableList
          callbackNewDataIds={callbackNewDataIds}
          dataIDs={["a", "b"]}
          renderItem={renderItem}
        />
      );

      act(() => {
        capturedGestures[0]?.onFinalize?.();
        capturedGestures[0]?.onFinalize?.();
      });

      expect(callbackNewDataIds).toHaveBeenCalledTimes(1);
      expect(callbackNewDataIds).toHaveBeenCalledWith(["a", "b"]);
    });
  });

  describe("animated styles", () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Platform.OS = originalOS;
    });

    it("omits shadows on Android", () => {
      Platform.OS = "android";
      const {getByText} = render(
        <DraggableList callbackNewDataIds={() => {}} dataIDs={["a"]} renderItem={renderItem} />
      );

      expect(getByText("a")).toBeTruthy();
    });

    it("adds shadow styles on iOS", () => {
      Platform.OS = "ios";
      const {getByText} = render(
        <DraggableList callbackNewDataIds={() => {}} dataIDs={["a"]} renderItem={renderItem} />
      );

      expect(getByText("a")).toBeTruthy();
    });
  });

  it("mirrors the shared positions into state", () => {
    let invocations = 0;
    const reactionSpy = spyOn(Reanimated, "useAnimatedReaction").mockImplementation(((
      prepare: () => unknown,
      react: (current: unknown, previous: unknown) => void
    ) => {
      invocations += 1;
      // Only run the first registered reaction (the list-level one) so the
      // render-phase state update settles instead of looping.
      if (invocations === 1) {
        react(prepare(), undefined);
      }
    }) as unknown as typeof Reanimated.useAnimatedReaction);

    const {getByText} = render(
      <DraggableList callbackNewDataIds={() => {}} dataIDs={["a", "b"]} renderItem={renderItem} />
    );

    expect(getByText("a")).toBeTruthy();
    reactionSpy.mockRestore();
  });

  describe("variableHeight", () => {
    const layout = (
      height: number
    ): {nativeEvent: {layout: {height: number; width: number; x: number; y: number}}} => ({
      nativeEvent: {layout: {height, width: 100, x: 0, y: 0}},
    });

    it("stacks rows in normal flow instead of a fixed-height absolute slot", () => {
      const {getByTestId, toJSON} = render(
        <DraggableList
          callbackNewDataIds={() => {}}
          dataIDs={["a", "b"]}
          itemHeight={50}
          itemsGap={10}
          renderItem={renderItem}
          variableHeight
        />
      );

      const listStyle = getByTestId("draggable-list").props.style as {
        gap?: number;
        minHeight?: number;
      };
      expect(listStyle.gap).toBe(10);
      expect(listStyle.minHeight).toBeUndefined();
      expect(JSON.stringify(toJSON())).not.toContain('"position":"absolute"');
    });

    it("drops a short row using the measured height of the row under it", () => {
      const callbackNewDataIds = mock(() => {});
      const {getByTestId} = render(
        <DraggableList
          callbackNewDataIds={callbackNewDataIds}
          dataIDs={["a", "b"]}
          itemHeight={50}
          itemsGap={10}
          renderItem={renderItem}
          variableHeight
        />
      );

      act(() => {
        fireEvent(getByTestId("draggable-item-a"), "layout", layout(40));
        fireEvent(getByTestId("draggable-item-b"), "layout", layout(300));
      });

      const dragA = capturedGestures.at(-2);
      act(() => {
        dragA?.onBegin?.();
        dragA?.onChange?.({translationY: 90});
        dragA?.onFinalize?.();
      });

      expect(callbackNewDataIds).not.toHaveBeenCalled();

      const dragAAgain = capturedGestures.at(-2);
      act(() => {
        dragAAgain?.onBegin?.();
        dragAAgain?.onChange?.({translationY: 200});
        dragAAgain?.onFinalize?.();
      });

      expect(callbackNewDataIds).toHaveBeenCalledWith(["b", "a"]);
    });
  });

  describe("DragItem", () => {
    const baseProps = {
      index: 0,
      item: "a",
      itemBorderRadius: 8,
      itemHeight: 50,
      itemsCount: 1,
      itemsGap: 5,
      plainPosition: 0,
      positions: {value: {a: 0}},
      renderItem,
      scrollY: {value: 0},
    };

    it("syncs its offset when the shared positions change", () => {
      const reactionSpy = spyOn(Reanimated, "useAnimatedReaction").mockImplementation(((
        prepare: () => unknown,
        react: (current: unknown, previous: unknown) => void
      ) => {
        react(prepare(), undefined);
      }) as unknown as typeof Reanimated.useAnimatedReaction);

      const {getByText} = render(
        <View>
          <DragItem {...baseProps} item="b" itemsCount={2} positions={{value: {a: 0, b: 1}}} />
        </View>
      );

      expect(getByText("b")).toBeTruthy();
      reactionSpy.mockRestore();
    });

    it("falls back to a zero offset when the computed offset is not a number", () => {
      const {getByText} = render(
        <View>
          <DragItem {...baseProps} itemHeight={Number.NaN} />
        </View>
      );

      expect(getByText("a")).toBeTruthy();
    });
  });
});
