import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {AccessibilityInfo, Animated, View} from "react-native";

import {
  resolveLoadingContent,
  Skeleton,
  SkeletonCard,
  SkeletonCircle,
  SkeletonGroup,
  SkeletonList,
  SkeletonText,
} from "./Skeleton";
import {getTextFontSize, Text} from "./Text";
import {renderWithTheme} from "./test-utils";

// Skeletons are hidden from assistive tech, so queries opt in to hidden elements.
const HIDDEN = {includeHiddenElements: true};

interface MockFn {
  mock: {calls: unknown[][]};
  mockClear: () => void;
}

const loopMock = Animated.loop as unknown as MockFn;

const flushReducedMotion = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("Skeleton", () => {
  beforeEach(() => {
    loopMock.mockClear();
  });

  it("renders a block with default size and is hidden from screen readers", () => {
    const {getByTestId} = renderWithTheme(<Skeleton testID="block" />);
    const block = getByTestId("block", HIDDEN);
    expect(block.props.style).toMatchObject({height: 16, width: "100%"});
    expect(block.props["aria-hidden"]).toBe(true);
    expect(block.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("applies width, height, and circle rounding", () => {
    const {getByTestId} = renderWithTheme(
      <Skeleton height={48} rounding="circle" testID="block" width={48} />
    );
    expect(getByTestId("block", HIDDEN).props.style).toMatchObject({
      borderRadius: 24,
      height: 48,
      width: 48,
    });
  });

  it("pulses by default", () => {
    renderWithTheme(<Skeleton />);
    expect(loopMock.mock.calls.length).toBe(1);
  });

  it("does not animate with animation none", () => {
    const {getByTestId} = renderWithTheme(<Skeleton animation="none" testID="block" />);
    expect(loopMock.mock.calls.length).toBe(0);
    expect(getByTestId("block", HIDDEN).props.style.opacity).toBeUndefined();
  });

  it("renders a shimmer highlight once the block has a width", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <Skeleton animation="shimmer" testID="block" />
    );
    const overlay = getByTestId("block.shimmer", HIDDEN);
    expect(overlay.children.length).toBe(0);
    fireEvent(overlay, "layout", {nativeEvent: {layout: {height: 16, width: 200}}});
    expect(queryByTestId("block.shimmer", HIDDEN)?.children.length).toBe(1);
  });

  describe("reduced motion", () => {
    let reduceMotionSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      reduceMotionSpy = spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(() =>
        Promise.resolve(true)
      );
    });

    afterEach(() => {
      reduceMotionSpy.mockImplementation(() => Promise.resolve(false));
    });

    it("stops animating when the OS asks for reduced motion", async () => {
      const {getByTestId} = renderWithTheme(<Skeleton animation="shimmer" testID="block" />);
      await flushReducedMotion();
      expect(getByTestId("block", HIDDEN).props.style.opacity).toBeUndefined();
      expect(() => getByTestId("block.shimmer", HIDDEN)).toThrow();
    });
  });
});

describe("SkeletonGroup", () => {
  beforeEach(() => {
    loopMock.mockClear();
  });

  it("drives every skeleton inside it from one timeline", () => {
    renderWithTheme(
      <SkeletonGroup>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>
    );
    expect(loopMock.mock.calls.length).toBe(1);
  });

  it("passes its animation down to skeletons that do not set one", () => {
    const {getByTestId} = renderWithTheme(
      <SkeletonGroup animation="none">
        <Skeleton testID="block" />
      </SkeletonGroup>
    );
    expect(loopMock.mock.calls.length).toBe(0);
    expect(getByTestId("block", HIDDEN).props.style.opacity).toBeUndefined();
  });

  it("lets a skeleton override the group animation", () => {
    const {getByTestId} = renderWithTheme(
      <SkeletonGroup animation="none">
        <Skeleton animation="shimmer" testID="block" />
      </SkeletonGroup>
    );
    expect(getByTestId("block.shimmer", HIDDEN)).toBeTruthy();
    expect(loopMock.mock.calls.length).toBe(1);
  });
});

describe("SkeletonText", () => {
  it("renders three lines with a shorter last line by default", () => {
    const {getByTestId} = renderWithTheme(<SkeletonText testID="text" />);
    expect(getByTestId("text.line.0", HIDDEN).props.style.width).toBe("100%");
    expect(getByTestId("text.line.1", HIDDEN).props.style.width).toBe("100%");
    expect(getByTestId("text.line.2", HIDDEN).props.style.width).toBe("60%");
  });

  it("renders a single full-width line when lines is 1", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(<SkeletonText lines={1} testID="text" />);
    expect(getByTestId("text.line.0", HIDDEN).props.style.width).toBe("100%");
    expect(queryByTestId("text.line.1", HIDDEN)).toBeNull();
  });

  it("sizes lines to the matching Text size", () => {
    const {getByTestId} = renderWithTheme(<SkeletonText lines={1} size="xl" testID="text" />);
    expect(getByTestId("text.line.0", HIDDEN).props.style.height).toBe(getTextFontSize("xl"));
  });
});

describe("SkeletonCircle", () => {
  it("renders a circle of the given size", () => {
    const {getByTestId} = renderWithTheme(<SkeletonCircle size={64} testID="avatar" />);
    expect(getByTestId("avatar", HIDDEN).props.style).toMatchObject({
      borderRadius: 32,
      height: 64,
      width: 64,
    });
  });
});

describe("SkeletonCard", () => {
  it("renders an avatar, title, and text without media by default", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(<SkeletonCard testID="card" />);
    expect(getByTestId("card.body.avatar", HIDDEN)).toBeTruthy();
    expect(getByTestId("card.body.title", HIDDEN)).toBeTruthy();
    expect(getByTestId("card.body.text.line.1", HIDDEN)).toBeTruthy();
    expect(queryByTestId("card.media", HIDDEN)).toBeNull();
  });

  it("renders a media block and hides the avatar when asked", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SkeletonCard mediaHeight={120} showAvatar={false} showMedia testID="card" />
    );
    expect(getByTestId("card.media", HIDDEN).props.style.height).toBe(120);
    expect(queryByTestId("card.body.avatar", HIDDEN)).toBeNull();
  });
});

describe("SkeletonList", () => {
  it("renders the requested number of rows", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(<SkeletonList rows={2} testID="list" />);
    expect(getByTestId("list.row.0", HIDDEN)).toBeTruthy();
    expect(getByTestId("list.row.1", HIDDEN)).toBeTruthy();
    expect(queryByTestId("list.row.2", HIDDEN)).toBeNull();
  });
});

describe("resolveLoadingContent", () => {
  it("returns children when not loading", () => {
    const {getByText} = renderWithTheme(
      <View>{resolveLoadingContent({children: <Text>Loaded</Text>, loading: false})}</View>
    );
    expect(getByText("Loaded")).toBeTruthy();
  });

  it("returns the loading component when loading", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <View>
        {resolveLoadingContent({
          children: <Text>Loaded</Text>,
          loading: true,
          loadingComponent: <Skeleton testID="placeholder" />,
        })}
      </View>
    );
    expect(getByTestId("placeholder", HIDDEN)).toBeTruthy();
    expect(queryByText("Loaded")).toBeNull();
  });

  it("prefers the caller's loading component over the container default", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <View>
        {resolveLoadingContent({
          defaultLoadingComponent: <Skeleton testID="default" />,
          loading: true,
          loadingComponent: <Skeleton testID="custom" />,
        })}
      </View>
    );
    expect(getByTestId("custom", HIDDEN)).toBeTruthy();
    expect(queryByTestId("default", HIDDEN)).toBeNull();
  });
});
